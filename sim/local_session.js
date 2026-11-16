// 브라우저 안에서 뇌 + 월드모델 + 게임을 돌려, Python 서버(server/app.py)와 같은 형태의 프레임을 만든다.
// main.js는 서버에서 받든 여기서 받든 같은 방식으로 그린다.

import { FlyBrain, brainInputs, brainOutputs } from "./brain.js";
import { WorldModel } from "./worldmodel.js";
import { WMExplain } from "./wm_explain.js";
import { FlyArena, N_EYE, seededRng, ARENA } from "./arena.js";
import { ArenaRenderer } from "./arena_render.js";
import { rulePolicy } from "./policies.js";

const FPS = 20;
const HORIZON = 15;         // 상상 길이
const DREAM_STEPS_PER_FRAME = 3;   // 프레임마다 3스텝씩 계산 → 5프레임마다 새 궤적 완성 (보이는 상상이 아직 미래를 담도록)
const INPUT_KEYS = ["in_odor_food", "in_odor_co2", "in_looming"];
const OUTPUT_KEYS = ["out_steer", "out_forward", "out_backward", "out_escape"];

// 유령 초파리: 상상 속 행동들을 게임과 같은 이동 규칙으로 따라간 경로 (먹이·포식자 판정은 하지 않음)
function dreamPath(pose, actions) {
  let [x, y] = pose.pos, heading = pose.heading, cooldown = pose.cooldown;
  const path = [[x, y, heading]];
  for (const [forward, turn, jump] of actions) {
    heading += turn * ARENA.turnSpeed * ARENA.dt;
    let step = forward * ARENA.walkSpeed * ARENA.dt * (forward < 0 ? 0.4 : 1);
    if (jump > 0.5 && cooldown === 0) { step = ARENA.jumpDist; cooldown = ARENA.jumpCooldown; }
    cooldown = Math.max(0, cooldown - 1);
    x += step * Math.cos(heading);
    y += step * Math.sin(heading);
    const r = Math.hypot(x, y);
    if (r > ARENA.radius) { x *= ARENA.radius / r; y *= ARENA.radius / r; }
    path.push([x, y, heading]);
  }
  return path;
}

export class LocalSession {
  static async create(base, gameCanvas, onStatus = () => {}) {
    onStatus("Loading connectome brain…");
    const brain = await FlyBrain.load(base);
    let wm = null;
    try {
      onStatus("Loading world model…");
      wm = await WorldModel.load(base);
    } catch (e) {
      console.warn("world model not available", e);
    }
    // 계산 화면용 가중치 (없으면 계산 화면 대신 값만 보여 줌)
    const explain = wm ? await WMExplain.load(base) : null;
    // 3D 뇌 그림용: 뉴런별로 입력이 어느 감각에서 오는지 (flybrain/export_sense_map.py, 없으면 회색으로만 그림)
    let sense = null;
    try {
      const r = await fetch(base + "brain_sense.json");
      if (r.ok) sense = Float32Array.from((await r.json()).share, (v) => v / 1000);
    } catch { /* 파일이 없으면 생략 */ }
    const s = new LocalSession(brain, wm, gameCanvas);
    s.explain = explain;
    s.sense = sense;
    return s;
  }

  constructor(brain, wm, gameCanvas) {
    this.brain = brain;
    this.wm = wm;
    this.env = new FlyArena({ level: 0, rng: seededRng(Date.now() & 0xffff) });
    this.renderer = new ArenaRenderer(gameCanvas);
    this.mode = "brain";
    this.paused = false;
    this.speed = 1;
    this.keys = { up: 0, down: 0, left: 0, right: 0, space: 0 };
    this.episode = 0;
    this.frameCount = 0;
    this.showGhost = false;    // 게임 화면의 꿈 경로 (Show dream path로 켬)
    this.clamped = new Map();  // 뉴런 → 강제 막전위 (양수 켜기, 음수 끄기)
    this.pending = [];         // 프레임 사이에서 적용할 명령
    this.lock = Promise.resolve();   // 프레임 계산·미리보기를 한 번에 하나씩 실행
    this.gen = 0;              // reset마다 증가. 계산 도중 바뀌면 그 결과를 버림
    this.reset();
  }

  // 서버의 init 메시지와 같은 형태
  initMessage() {
    const m = this.brain.meta;
    const group = new Array(m.n).fill("");
    for (const k of [...INPUT_KEYS, ...OUTPUT_KEYS]) for (const i of m.groups[k]) group[i] = k;
    return {
      type: "init", trained: true, n: m.n, pos: m.pos,
      cell_type: m.cell_type, side: m.side, super_class: m.super_class,
      group, groups: m.groups, out_neurons: Array.from(this.brain.out_neurons), out_names: m.out_names,
      n_eye: N_EYE, worldModel: !!this.wm,
      // 하행뉴런 → 행동 읽기 가중치 (층 화면에서 뉴런별 기여도 계산용)
      readout: { neurons: Array.from(this.brain.readout_neurons), w: this.brain.readout_w, b: Array.from(this.brain.readout_b) },
      // 계산 화면용 (브라우저 실행에서만): 뇌 시뮬레이션 배열과 월드모델 가중치
      sim: this.brain, explain: this.explain || null, sense_share: this.sense || null,
    };
  }

  reset() {
    this.gen += 1;
    this.obs = this.env.reset();
    this.brain.reset();
    this.wm?.newEpisode();
    this.total = 0;
    this.lastReward = 0;       // 지금 상태 t에 도착하며 받은 보상 (t−1 → t)
    this.lastEvents = [];      // 지금 상태 t에 도착하며 일어난 사건
    this.atTerminal = false;   // 지금 상태가 에피소드의 마지막 상태인지 (보여 준 뒤 리셋)
    this.imagined = null;      // 마지막으로 완성된 상상 궤적 (화면 표시용)
    this.imagining = null;     // 지금 계산 중인 상상
    this.shown = null;        // 마지막으로 화면에 보인 상태 t의 스냅샷 (일시정지 미리보기용)
    this.episode += 1;
  }

  // 조종 모드·일시정지·속도·키 입력은 바로 적용하고, 상태를 바꾸는 명령(리셋, 난이도, 믿음 고정,
  // 뉴런 조작 등)은 큐에 모았다가 프레임 사이에서만 적용한다. 계산 도중 상태가 바뀌어
  // 진행 중인 상상이 사라지거나 뇌 상태가 섞이는 일을 막기 위해서다.
  command(cmd, value) {
    if (cmd === "mode") this.mode = value;
    else if (cmd === "pause") this.paused = !!value;
    else if (cmd === "speed") this.speed = +value;
    else if (cmd === "keys") Object.assign(this.keys, value);
    else {
      this.pending.push([cmd, value]);
      // 일시정지 중에는 다음 프레임이 오지 않으므로 바로 (다른 계산과 겹치지 않게) 적용
      if (this.paused) this.exclusive(() => this.applyPending());
    }
  }

  applyPending() {
    const queue = this.pending;
    this.pending = [];
    for (const [cmd, value] of queue) this.applyCommand(cmd, value);
  }

  // 한 번에 하나씩 실행 (프레임 계산과 일시정지 미리보기가 같은 뇌·월드모델을 동시에 건드리지 않게)
  exclusive(fn) {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => {});
    return run;
  }

  applyCommand(cmd, value) {
    if (cmd === "reset") this.reset();
    else if (cmd === "level") { this.env.setLevel(+value); this.reset(); }
    else if (cmd === "ghost") this.showGhost = !!value;
    else if (cmd === "reflex") { this.brain.gfJump = !!value; this.imagining = null; }   // 실제·상상 모두에 적용
    else if (cmd === "pin" && this.wm) {
      // value: { g, c } 또는 { g, c: null } (해제) 또는 { clear: true }
      if (value.clear) this.wm.pins.clear();
      else if (value.c == null) this.wm.pins.delete(value.g);
      else this.wm.pins.set(value.g, value.c);
      this.imagining = null;     // 바뀐 믿음으로 상상을 새로 시작
    }
    else if (cmd === "clamp") {
      // value: { neurons: [...], v: 막전위 또는 null(해제) }
      for (const i of value.neurons) {
        if (value.v == null) { this.clamped.delete(i); this.brain.clamp[i] = NaN; }
        else { this.clamped.set(i, value.v); this.brain.clamp[i] = value.v; }
      }
    } else if (cmd === "unclamp_all") {
      this.clamped.clear();
      this.brain.clamp.fill(NaN);
    }
  }

  async worldModelInfo(obs) {
    const wm = this.wm;
    const aPrev = Array.from(wm.prevAction);      // 이번 갱신에 들어가는 직전 행동 (층 화면 표시용)
    // 계산 화면용 입력: h_{t−1}, z_{t−1}, a_{t−1} (새 에피소드 첫 스텝이면 모두 0, rssm.obs_step과 같음)
    const first = wm.isFirst;
    const hPrev = first ? new Float32Array(wm.meta.deter) : wm.h.slice();
    const zPrev = first ? new Float32Array(wm.meta.stoch) : wm.z.slice();
    const aIn = first ? [0, 0, 0] : aPrev;
    const r = await wm.observe(obs);
    // 상상은 뇌가 이번 감각을 받기 전 상태에서 시작 (서버와 같은 순서).
    // 지역 변수로 잡아 두고, 기다리는 사이 다른 상상으로 바뀌었으면 결과를 쓰지 않는다
    let im = this.imagining;
    if (!im) {
      im = this.imagining = wm.startImagination(this.brain, HORIZON);
      im.pose = { pos: [...this.env.pos], heading: this.env.heading, cooldown: this.env.cooldown };
      im.originStep = this.env.steps;      // 이 상상이 시작된 상태의 스텝 번호
    }
    for (let k = 0; k < DREAM_STEPS_PER_FRAME && !im.done; k++) await im.advance(this.brain);
    if (im === this.imagining && im.done) {
      const t = im.traj;
      this.imagined = { reward: t.reward, value: t.value, rates: t.rates, obs: t.obs, action: t.action, hz: t.hz,
                        cont: t.cont, prior: t.prior, io: t.io, path: dreamPath(im.pose, t.action), originStep: im.originStep };
      this.imagining = null;
    }
    // 첫 궤적이 완성되기 전에는 빈 값
    const imagined = this.imagined || { reward: [], value: [r.value], originStep: null };
    return {
      h: Array.from(r.h), z: Array.from(r.z), z_probs: r.postProbs, z_shape: [wm.G, wm.C],
      prior_probs: r.priorProbs, embed: r.embed, a_prev: aIn, h_prev: hPrev, z_prev: zPrev,
      reward_pred: r.reward, reward_real: this.lastReward, value: r.value, cont: r.cont,
      recon: r.recon, surprise: r.surprise, imagined, pins: [...wm.pins],
    };
  }

  // 한 프레임 = 상태 t 하나.
  //   상태 t의 감각으로 월드모델·뇌를 갱신하고 행동을 고른 뒤, 화면(게임)도 상태 t로 그린다.
  //   보상·사건은 t에 '도착하며' 받은 것 (t−1 → t), 점수·누적 보상은 t까지.
  //   고른 행동은 그다음 env.step에서 적용된다 (결과는 다음 프레임의 보상·사건으로 보임).
  //   상태 t가 마지막 상태(잡힘·시간 종료)면 행동을 적용하지 않고 보여 준 뒤 리셋한다.
  // 화면에 그릴 환경 모습 (env.step 전에 복사해 두면 상태 t 그대로 남음)
  envView() {
    const e = this.env;
    return {
      pos: [...e.pos], heading: e.heading, food: [...e.food], co2: [...e.co2],
      predator: e.predator ? [...e.predator] : null, score: e.score, steps: e.steps,
      cooldown: e.cooldown, lastEyes: [...(e.lastEyes || [])],
    };
  }

  async step() {
    this.applyPending();
    const gen = this.gen;
    const obs = this.obs;
    const t = this.env.steps;
    const wmInfo = this.wm ? await this.worldModelInfo(obs) : null;
    if (gen !== this.gen) return null;      // 계산 도중 리셋됨 → 이 프레임은 버림
    const brainBefore = this.brain.getState();   // 상태 t의 감각을 처리하기 전 뇌 (미리보기 상상의 시작점)
    const ioBefore = brainInputs(this.brain);
    const { rate } = this.brain.step(obs);
    const brainIO = brainOutputs(this.brain, ioBefore);
    const brainAction = this.brain.action();
    let action;
    if (this.mode === "brain") action = brainAction;
    else if (this.mode === "rule") action = rulePolicy(obs);
    else {
      const k = this.keys;
      action = [k.up - k.down, k.left - k.right, k.space ? 1 : -1];
    }
    // 화면은 상태 t (뇌·월드모델이 감각을 받은 순간)
    const im = this.imagined;
    const view = this.envView();
    this.renderer.draw(view, {
      ghost: this.showGhost ? im?.path : null,
      ghostAge: im?.originStep != null ? t - im.originStep : null,
    });
    // 일시정지 미리보기는 환경·뇌의 '지금'(이미 t+1로 넘어감) 대신 이 스냅샷을 쓴다.
    // 월드모델은 상태 t를 관측한 상태 그대로라 따로 보관할 필요가 없다.
    this.shown = { step: t, view, brainBefore };
    const shown = { step: t, reward: this.lastReward, events: this.lastEvents, total: this.total, score: this.env.score };
    const terminal = this.atTerminal;
    if (!terminal) {
      const res = this.env.step(action);
      this.wm?.setAction(action);
      this.total += res.reward;
      this.lastReward = res.reward;
      this.lastEvents = res.events;
      this.obs = res.obs;
      this.atTerminal = res.terminated || res.truncated;
    }
    this.frameCount += 1;

    const rates = new Uint8Array(rate.length);
    for (let i = 0; i < rate.length; i++) rates[i] = Math.min(255, rate[i] * 255);
    const frame = {
      type: "frame", episode: this.episode, step: shown.step, mode: this.mode, level: this.env.level,
      rates, obs: Array.from(obs), action, brain_action: brainAction, actionApplied: !terminal, cooldown: view.cooldown,
      reward: shown.reward, total: shown.total, score: shown.score, events: shown.events,
      done: terminal, wm: wmInfo, brain_io: brainIO,
      clamped: [...this.clamped],
    };
    // 꿈 재생: 마지막으로 완성된 상상 궤적의 뇌 활동을 한 스텝씩 돌려 보여 줌
    if (im?.rates?.length) {
      const k = this.frameCount % im.rates.length;
      // 상상 k스텝: 상태 k의 복원 감각(obs) → 뇌 → 행동 → 다음 상태 k+1 (h, z, prior) → 보상·계속·가치
      frame.dream = { rates: im.rates[k], step: k + 1, of: im.rates.length, obs: im.obs[k], action: im.action[k],
                      originStep: im.originStep, age: t - im.originStep,
                      h: im.hz?.[k + 1]?.[0], z: im.hz?.[k + 1]?.[1], prior: im.prior?.[k],
                      h_prev: im.hz?.[k]?.[0], z_prev: im.hz?.[k]?.[1], io: im.io?.[k],
                      reward: im.reward?.[k], cont: im.cont?.[k], value: im.value?.[k + 1] };
    }
    if (terminal) this.reset();
    return frame;
  }

  // 프레임마다 onFrame 호출. 계산이 늦어도 프레임이 겹치지 않게 순차 실행
  // 일시정지 중 믿음(z 고정)을 바꿨을 때: 게임은 멈춘 채 복원 감각과 상상(뇌 포함)을 바로 다시 계산
  preview() {
    return this.exclusive(() => this.previewNow());
  }

  // 화면에 보인 상태 t 기준: 월드모델 (h, z)는 t를 관측한 상태, 뇌는 t의 감각을 처리하기 전 상태,
  // 초파리 위치·화면도 t. 새 에피소드에서 아직 한 프레임도 안 보였으면 미리보기 없음.
  async previewNow() {
    this.applyPending();
    const wm = this.wm;
    const shown = this.shown;
    if (!wm || !shown) return null;
    const r = await wm.refreshBelief();
    if (!r) return null;
    const im = wm.startImagination(this.brain, HORIZON, shown.brainBefore);
    im.pose = { pos: [...shown.view.pos], heading: shown.view.heading, cooldown: shown.view.cooldown };
    im.originStep = shown.step;
    while (!im.done) await im.advance(this.brain);
    const t = im.traj;
    this.imagined = { reward: t.reward, value: t.value, rates: t.rates, obs: t.obs, action: t.action, hz: t.hz,
                      cont: t.cont, prior: t.prior, io: t.io, path: dreamPath(im.pose, t.action), originStep: im.originStep };
    this.imagining = null;
    this.renderer.draw(shown.view, { ghost: this.showGhost ? this.imagined.path : null, ghostAge: 0 });
    return {
      recon: r.recon, reward_pred: r.reward, value: r.value, cont: r.cont, h: Array.from(wm.h), z: Array.from(wm.z),
      z_probs: r.postProbs, z_shape: [wm.G, wm.C], pins: [...wm.pins],
      imagined: this.imagined,
      dream: { rates: t.rates.at(-1), step: t.rates.length, of: t.rates.length, action: t.action.at(-1),
               originStep: im.originStep, age: 0 },
    };
  }

  // timing: 시뮬레이션·그리기 시간과 실제 초당 스텝 (상단에 표시)
  run(onFrame, onTiming = () => {}) {
    const recent = [];
    let next = performance.now();
    const loop = async () => {
      const t0 = performance.now();
      if (!this.paused) {
        // 한 프레임에서 오류가 나도 기록만 하고 다음 프레임은 계속 예약한다
        try {
          const frame = await this.exclusive(() => this.step());
          if (frame) {
            const t1 = performance.now();
            onFrame(frame);
            recent.push({ t: t0, sim: t1 - t0, draw: performance.now() - t1 });
            while (recent.length > 40) recent.shift();
            if (recent.length > 1) {
              const avg = (k) => recent.reduce((s, r) => s + r[k], 0) / recent.length;
              const fps = (recent.length - 1) / ((recent.at(-1).t - recent[0].t) / 1000);
              onTiming({ fps, sim: avg("sim"), draw: avg("draw") });
            }
          }
        } catch (e) {
          console.error("frame failed", e);
        }
      }
      // 목표 시각 기준으로 다음 프레임 예약 (대기 오차가 누적되지 않게). 많이 밀리면 따라잡지 않고 다시 맞춤
      next += 1000 / (FPS * this.speed);
      const now = performance.now();
      if (next < now - 100) next = now;
      setTimeout(loop, Math.max(0, next - now));
    };
    loop();
  }
}
