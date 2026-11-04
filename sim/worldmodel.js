// 월드모델 (브라우저용). worldmodel/export_onnx.py가 만든 ONNX 세 조각을 ONNX Runtime Web으로 실행한다.
// 페이지에서 먼저 onnxruntime-web 스크립트를 불러와 전역 `ort`가 있어야 한다.
//
//   observe(obs)   : 실제 감각으로 상태 (h, z) 갱신 → 복원 감각, 예측 보상, 가치, 놀람(KL) 등
//   imagine(brain) : 지금 상태에서 '예측 감각 → 뇌 → 행동 → 다음 상태'를 감각 없이 반복 (방식 A)

const ort = globalThis.ort;

export class WorldModel {
  static async load(base = "data/") {
    const meta = await fetch(base + "wm.json").then((r) => r.json());
    const opts = { executionProviders: ["wasm"] };
    const [obsStep, imgStep, heads] = await Promise.all(
      ["wm_obs_step", "wm_img_step", "wm_heads"].map((n) => ort.InferenceSession.create(base + n + ".onnx", opts)));
    return new WorldModel(meta, obsStep, imgStep, heads);
  }

  constructor(meta, obsStep, imgStep, heads) {
    Object.assign(this, { meta, obsStep, imgStep, heads });
    this.G = meta.groups;
    this.C = meta.classes;
    this.sample = false;          // true면 z를 확률대로 뽑고, false면 가장 확률 높은 칸
    this.pins = new Map();        // 사용자가 고정한 믿음: 범주 g → 칸 c (실제 갱신·상상 모두에 적용)
    this.reset();
  }

  reset() {
    this.h = new Float32Array(this.meta.deter);
    this.z = new Float32Array(this.meta.stoch);
    this.prevAction = new Float32Array(this.meta.act_dim);
    this.isFirst = 1;
    this.lastPost = null;         // 새 에피소드의 첫 관측 전에는 미리보기에 쓸 믿음이 없음
  }

  tensor(arr, dims) {
    return new ort.Tensor("float32", arr instanceof Float32Array ? arr : Float32Array.from(arr), dims);
  }

  // 범주 로그확률(G×C) → one-hot z. base: 배치에서 몇 번째 줄인지 (줄 길이 G×C)
  pickZ(logits, base = 0) {
    const z = new Float32Array(this.G * this.C);
    if (base) logits = logits.subarray(base * this.G * this.C, (base + 1) * this.G * this.C);
    for (let g = 0; g < this.G; g++) {
      const off = g * this.C;
      let k = 0;
      if (this.sample) {
        let u = Math.random();
        for (k = 0; k < this.C - 1; k++) { u -= Math.exp(logits[off + k]); if (u <= 0) break; }
      } else {
        for (let c = 1; c < this.C; c++) if (logits[off + c] > logits[off + k]) k = c;
      }
      if (this.pins.has(g)) k = this.pins.get(g);
      z[off + k] = 1;
    }
    return z;
  }

  // KL(posterior || prior): 실제로 보고 나서 예측이 얼마나 틀렸나 (= 놀람)
  kl(post, prior) {
    let s = 0;
    for (let i = 0; i < post.length; i++) s += Math.exp(post[i]) * (post[i] - prior[i]);
    return s;
  }

  async readHeads(h, z) {
    const r = await this.heads.run({ h: this.tensor(h, [1, h.length]), z: this.tensor(z, [1, z.length]) });
    return { recon: r.obs.data, reward: r.reward.data[0], cont: r.cont.data[0], value: r.value.data[0] };
  }

  async observe(obs) {
    const D = this.meta.deter, S = this.meta.stoch, A = this.meta.act_dim;
    const r = await this.obsStep.run({
      h: this.tensor(this.h, [1, D]), z: this.tensor(this.z, [1, S]),
      action: this.tensor(this.prevAction, [1, A]), obs: this.tensor(obs, [1, obs.length]),
      is_first: this.tensor([this.isFirst], [1]),
    });
    this.h = r.h_out.data.slice();
    const prior = r.prior.data, post = r.post.data;
    this.lastPost = post;
    this.z = this.pickZ(post);
    this.isFirst = 0;
    const out = await this.readHeads(this.h, this.z);
    return {
      ...out, h: this.h, z: this.z,
      postProbs: this.displayProbs(post), priorProbs: Float32Array.from(prior, Math.exp),
      surprise: this.kl(post, prior),
    };
  }

  // 화면 표시용 z 확률: 고정한 범주는 고정한 칸이 1
  displayProbs(post) {
    const p = Float32Array.from(post, Math.exp);
    for (const [g, c] of this.pins) for (let k = 0; k < this.C; k++) p[g * this.C + k] = k === c ? 1 : 0;
    return p;
  }

  // 고정을 바꾼 뒤 지금 상태를 다시 계산 (일시정지 중 미리보기용)
  async refreshBelief() {
    if (!this.lastPost) return null;
    this.z = this.pickZ(this.lastPost);
    const out = await this.readHeads(this.h, this.z);
    return { ...out, postProbs: this.displayProbs(this.lastPost) };
  }

  // 이번 스텝에 실제로 한 행동 (다음 observe에서 상태 갱신에 쓰임)
  setAction(action) {
    this.prevAction = Float32Array.from(action);
  }

  newEpisode() {
    this.reset();
  }

  // 행동 지도 (what-if): 지금 상태 (h, z)에서 후보 행동마다 steps 동안 그 행동을 유지했다고 상상해
  // 예상 보상을 더한다. Q(s, a) ≈ Σ γ^k r̂_{t+k+1}. 후보 전체를 배치 하나로 계산하고, 지금 상태는 건드리지 않는다.
  async whatIf(actions, steps = 4, gamma = 0.99) {
    const N = actions.length, D = this.meta.deter, S = this.meta.stoch, A = this.meta.act_dim;
    let h = new Float32Array(N * D), z = new Float32Array(N * S);
    for (let i = 0; i < N; i++) { h.set(this.h, i * D); z.set(this.z, i * S); }
    const action = this.tensor(actions.flat(), [N, A]);
    const q = new Float32Array(N);
    for (let k = 0; k < steps; k++) {
      const r = await this.imgStep.run({ h: this.tensor(h, [N, D]), z: this.tensor(z, [N, S]), action });
      h = r.h_out.data.slice();
      for (let i = 0; i < N; i++) z.set(this.pickZ(r.prior.data, i), i * S);
      const out = await this.heads.run({ h: this.tensor(h, [N, D]), z: this.tensor(z, [N, S]) });
      for (let i = 0; i < N; i++) q[i] += gamma ** k * out.reward.data[i];
    }
    return q;
  }

  // 상상을 한 번에 몰아서 하지 않고 프레임마다 한 스텝씩 진행한다 (화면이 끊기지 않게).
  //   const im = wm.startImagination(brain);  매 프레임 await im.advance(brain);  im.done이면 im.traj 완성
  // 뇌 상태는 상상 전용 복사본을 따로 들고 다니고, 실제 뇌 상태는 매번 원래대로 돌려놓는다.
  // brainState: 상상을 시작할 뇌 상태 (생략하면 지금 뇌 상태). 미리보기는 '화면에 보인 상태 t의
  // 감각을 처리하기 전' 뇌 상태를 넘긴다 (실행 중 상상과 같은 시작점).
  startImagination(brain, steps = 15, brainState = null) {
    const wm = this;
    const im = {
      h: this.h, z: this.z, brainState: brainState ?? brain.getState(), heads: null, k: 0, steps, done: false,
      traj: { reward: [], value: [], cont: [], obs: [], action: [], rates: [], hz: [[this.h, this.z]] },
      async advance(realBrain) {
        if (im.done) return;
        if (!im.heads) {
          im.heads = await wm.readHeads(im.h, im.z);
          im.traj.value.push(im.heads.value);
        }
        const saved = realBrain.getState();
        realBrain.setState(im.brainState);
        realBrain.step(im.heads.recon);
        const action = realBrain.action();
        im.brainState = realBrain.getState();
        // 꿈속 뇌 활동 (0~255로 저장, 화면 재생용)
        const r8 = new Uint8Array(realBrain.n);
        for (let i = 0; i < realBrain.n; i++) r8[i] = Math.min(255, realBrain.rate[i] * 255);
        im.traj.rates.push(r8);
        realBrain.setState(saved);
        const D = wm.meta.deter, S = wm.meta.stoch, A = wm.meta.act_dim;
        const r = await wm.imgStep.run({
          h: wm.tensor(im.h, [1, D]), z: wm.tensor(im.z, [1, S]), action: wm.tensor(action, [1, A]),
        });
        im.h = r.h_out.data.slice();
        im.z = wm.pickZ(r.prior.data);
        im.traj.hz.push([im.h, im.z]);       // 상태 지도에 상상 경로를 그리기 위해
        im.traj.obs.push(im.heads.recon);
        im.traj.action.push(action);
        im.heads = await wm.readHeads(im.h, im.z);
        im.traj.reward.push(im.heads.reward);
        im.traj.cont.push(im.heads.cont);
        im.traj.value.push(im.heads.value);
        if (++im.k >= im.steps) im.done = true;
      },
    };
    return im;
  }

  // 상상: 지금 (h, z)와 뇌 상태에서 감각 없이 steps번 앞으로.
  // 뇌에는 월드모델이 복원한 '예측 감각'이 들어간다. 실제 뇌 상태는 건드리지 않는다.
  async imagine(brain, steps = 15, { recordRates = false } = {}) {
    const D = this.meta.deter, S = this.meta.stoch, A = this.meta.act_dim;
    const saved = brain.getState();
    let h = this.h, z = this.z;
    let heads = await this.readHeads(h, z);
    const traj = { reward: [], value: [heads.value], cont: [], obs: [], action: [], rates: [] };
    for (let k = 0; k < steps; k++) {
      brain.step(heads.recon);
      const action = brain.action();
      traj.obs.push(heads.recon);
      traj.action.push(action);
      if (recordRates) traj.rates.push(brain.rate.slice());
      const r = await this.imgStep.run({
        h: this.tensor(h, [1, D]), z: this.tensor(z, [1, S]), action: this.tensor(action, [1, A]),
      });
      h = r.h_out.data.slice();
      z = this.pickZ(r.prior.data);
      heads = await this.readHeads(h, z);
      traj.reward.push(heads.reward);
      traj.cont.push(heads.cont);
      traj.value.push(heads.value);
    }
    brain.setState(saved);
    return traj;
  }
}
