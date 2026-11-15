// 왼쪽 2/3 화면: 왼쪽 세로 칸에 월드모델(위)과 초파리 뇌(아래)의 층 구조를 하나의 그림으로 그리고,
// 칸을 누르면 오른쪽 상세 화면(위: 월드모델, 아래: 뇌)에 그 층의 실제 값(또는 State map · 3D 뇌 지도 · 행동 궤적)을 그린다.
// 화면 위 "Real play / Imagination" 전환으로 실제 플레이 값과 상상 속 값을 오간다.
//
// main.js가 setupExplorer(init)와 explorerFrame(frame, rates)를 부른다. app.html에만 있는 요소를 쓰므로
// 해당 요소가 없으면(legacy.html) 아무것도 하지 않는다.

import { PAL, rgb, shade } from "./palette.js";
import { drawCompute, hitCompute, plain, parse } from "./compute_view.js";

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

const SUPER_NAMES = {
  ascending: "Ascending (body → brain)", central: "Central brain", endocrine: "Endocrine", optic: "Optic lobe",
  sensory: "Other sensory", sensory_ascending: "Sensory ascending", visual_centrifugal: "Visual centrifugal",
  visual_projection: "Visual projection", "": "Unknown",
};
const TEAL = { f: "#EAF7F2", s: "#0F6E56", t: "#085041", u: "#2f7d68", in: "#ffffff" };
const PUR = { f: "#F1F0FD", s: "#534AB7", t: "#3C3489", u: "#5d55b8", in: "#ffffff" };
// 색 규칙은 palette.js: 실제 = 검정, 월드모델이 만든 것(상상) = 파랑, 감각 = 초록·노랑·빨강, 걷기 = 주황, 점프 = 자홍.
// 값의 크기만 나타내는 칸은 색 없이 회색 농도로 그린다. 보라(월드모델)·청록(뇌)은 틀과 상자에만 쓴다.
const DIM = "#aab0bc", INK = rgb(PAL.real), SUB = "#646b7a", EDGE = "#cfd4dc";
const flowColor = () => (mode === "real" ? INK : rgb(PAL.dream));     // 지금 흐르는 화살표·막대: 실제 = 검정, 상상 = 파랑
const f2 = (x) => (x < 0 ? "−" : "") + Math.abs(x).toFixed(2);

let init = null, mode = "real", wmSel = "statemap", brSel = "brainmap", last = null;
let groups = null, onModeChange = () => {};
const W = {}, B = {}, G = {};   // 그림 요소 참조 (월드모델, 뇌, 게임)

// ---------- SVG 도우미 ----------
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}
function text(parent, x, y, s, o = {}) {
  const e = el("text", { x, y, "text-anchor": o.a || "middle", "font-size": o.size || 11, "font-weight": o.w || 400, fill: o.fill || INK }, parent);
  setText(e, s);
  return e;
}
// "h_t", "ẑ_{t+1}" 같은 첨자를 tspan으로
function setText(e, s) {
  e.textContent = "";
  if (!/[_^]/.test(s)) { e.textContent = s; return; }
  for (const p of parse(s)) {
    const t = document.createElementNS(NS, "tspan");
    if (p.mode !== "base") { t.setAttribute("baseline-shift", p.mode === "sub" ? "sub" : "super"); t.setAttribute("font-size", "72%"); }
    t.textContent = p.t;
    e.appendChild(t);
  }
}
function defs(svg) {
  el("defs", {}, svg).innerHTML = `<marker id="${svg.id}-ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>`;
}
function arrow(svg, d, color = DIM) {
  return el("path", { d, fill: "none", stroke: color, "stroke-width": 1.2, "marker-end": `url(#${svg.id}-ar)` }, svg);
}
// 층 상자: 제목, 부제, 값. 모두 가운데 정렬
function box(svg, { x, y, w, h, c, title, sub }, onClick) {
  const g = el("g", { style: "cursor:pointer" }, svg);
  const rect = el("rect", { x, y, width: w, height: h, rx: 7, fill: c.in, stroke: c.s, "stroke-width": 0.8 }, g);
  text(g, x + w / 2, y + 18, title, { size: 12.5, w: 600, fill: c.t });
  text(g, x + w / 2, y + 33, sub, { size: 10, fill: c.u });
  const val = text(g, x + w / 2, y + 49, "", { size: 10.5, fill: c.t });
  g.addEventListener("click", onClick);
  return { g, rect, val, w, c };
}
function tile(svg, { x, y, w, h, title, sub }, onClick) {
  const g = el("g", { style: "cursor:pointer" }, svg);
  const rect = el("rect", { x, y, width: w, height: h, rx: 7, fill: "#f7f8fa", stroke: EDGE, "stroke-width": 0.9 }, g);
  text(g, x + 10, y + 16, title, { a: "start", size: 12, w: 600 });
  text(g, x + 10, y + 30, sub, { a: "start", size: 10, fill: SUB });
  g.addEventListener("click", onClick);
  return { g, rect, tile: true };
}
// 여러 줄 글자 (하나의 <g>로 묶어 투명도를 함께 바꿈)
function lines(svg, x, y, rows, anchor) {
  const g = el("g", {}, svg);
  rows.forEach((r, i) => text(g, x, y + i * 11, r, { a: anchor, size: 9.5, fill: SUB }));
  return g;
}
function setPort(p, on, ghost = false) {
  p.path.setAttribute("stroke", on ? flowColor() : DIM);
  p.path.setAttribute("stroke-width", on ? 1.8 : 1.1);
  p.path.setAttribute("stroke-dasharray", on ? "" : "4 3");
  const op = on ? 1 : ghost ? 0.9 : 0.35;
  p.path.setAttribute("opacity", op);
  if (p.label) p.label.setAttribute("opacity", op);
}

// ---------- 그림: 월드모델(위)과 뇌(아래)를 하나의 SVG에, 사이에 게임 ----------
// 화살표: 게임 감각 → 인코더, 게임 감각 → 감각뉴런, 하행뉴런 → 게임(행동), 하행뉴런 → 기억 h(행동),
//         출력 → 감각뉴런(복원 감각, 상상일 때만 실제로 쓰임)
function buildFlow() {
  const svg = $("flow-svg");
  svg.innerHTML = "";
  defs(svg);
  const pw = (k) => () => selectWM(k), pb = (k) => () => selectBrain(k);
  el("rect", { x: 4, y: 4, width: 352, height: 290, rx: 12, fill: PUR.f, stroke: PUR.s, "stroke-width": 0.6 }, svg);
  text(svg, 16, 24, "World model", { a: "start", size: 13, w: 700, fill: PUR.t });
  el("rect", { x: 4, y: 362, width: 352, height: 228, rx: 12, fill: TEAL.f, stroke: TEAL.s, "stroke-width": 0.6 }, svg);
  text(svg, 74, 384, "Fly brain", { a: "start", size: 13, w: 700, fill: TEAL.t });   // 화살표(x=64, 180, 262, 296)와 겹치지 않는 자리

  // 화살표를 먼저 그려 상자 아래에 깔리게
  W.pGame = { path: arrow(svg, "M180 306 V254"), label: text(svg, 186, 271, "o_t", { a: "start", size: 10.5, fill: SUB }) };
  W.pRecon = { path: arrow(svg, "M64 252 V440 H128"), label: lines(svg, 70, 270, ["reconstruction", "ô_t → brain"], "start"),
               note: text(svg, 70, 292, "", { a: "start", size: 9.5, fill: SUB }) };
  W.pAct = { path: arrow(svg, "M296 410 V254"), label: lines(svg, 302, 300, ["action a_t", "→ h_{t+1}"], "start") };
  B.pActG = { path: arrow(svg, "M262 410 V326 H232"), label: text(svg, 247, 321, "a_t", { size: 10.5, fill: SUB }) };
  B.pGame = { path: arrow(svg, "M180 346 V408"), label: text(svg, 186, 384, "o_t", { a: "start", size: 10.5, fill: SUB }) };
  // 월드모델 안: 인코더 → 사후 z, h → 사전·사후 z, (h, z) → 출력, z와 h는 다음 스텝의 h로
  arrow(svg, "M180 196 V150", PUR.s);
  text(svg, 185, 177, "e_t", { a: "start", size: 10, fill: PUR.u });
  arrow(svg, "M276 196 L232 150", PUR.s);
  text(svg, 256, 186, "h_t", { a: "end", size: 10, fill: PUR.u });
  arrow(svg, "M128 150 L86 194", PUR.s);
  text(svg, 100, 166, "(h_t, z_t)", { a: "end", size: 10, fill: PUR.u });
  arrow(svg, "M240 112 H306 V194", PUR.s);
  text(svg, 250, 106, "z_t → h_{t+1}", { a: "start", size: 10, fill: PUR.u });
  // 뇌 안: 발화율 ρ가 연결 W를 타고 감각 → 중간 → 하행으로
  arrow(svg, "M180 454 V476", TEAL.s);
  text(svg, 186, 469, "ρ_t", { a: "start", size: 10, fill: TEAL.u });
  arrow(svg, "M296 478 V456", TEAL.s);
  text(svg, 302, 471, "ρ_t", { a: "start", size: 10, fill: TEAL.u });

  W.statemap = tile(svg, { x: 16, y: 34, w: 328, h: 38, title: "State map", sub: "model state (h_t, z_t) → 2-D by PCA" }, pw("statemap"));
  W.z = box(svg, { x: 120, y: 92, w: 120, h: 56, c: PUR, title: "z_t", sub: "stochastic · 16×16" }, pw("z"));
  W.out = box(svg, { x: 14, y: 196, w: 100, h: 56, c: PUR, title: "Outputs", sub: "ô_t · r̂_t · ĉ_t · v_t" }, pw("out"));
  W.enc = box(svg, { x: 130, y: 196, w: 100, h: 56, c: PUR, title: "Encoder", sub: "o_t → e_t" }, pw("enc"));
  W.gru = box(svg, { x: 246, y: 196, w: 100, h: 56, c: PUR, title: "h_t", sub: "deterministic · GRU" }, pw("gru"));
  setText(W.gru.val, "↻ h_t → h_{t+1}");   // h는 자기 자신을 다음 스텝으로 넘긴다

  G.g = el("g", {}, svg);
  el("rect", { x: 130, y: 306, width: 100, height: 40, rx: 7, fill: "#ffffff", stroke: "#8a919e", "stroke-width": 1 }, G.g);
  text(G.g, 180, 322, "Game", { size: 12, w: 600 });
  text(G.g, 180, 336, "panel on the right", { size: 9.5, fill: SUB });

  B.sens = box(svg, { x: 130, y: 410, w: 100, h: 44, c: TEAL, title: "Sensory", sub: "580 neurons" }, pb("sens"));
  B.dn = box(svg, { x: 246, y: 410, w: 100, h: 44, c: TEAL, title: "Descending", sub: "1,276 neurons" }, pb("dn"));
  B.mid = box(svg, { x: 130, y: 478, w: 216, h: 44, c: TEAL, title: "Middle", sub: "13,144 neurons · recurrent" }, pb("mid"));
  // 위 State map 칸과 같은 폭·높이
  B.brainmap = tile(svg, { x: 16, y: 540, w: 328, h: 38, title: "Brain map 3D", sub: "all 15,000 neurons at their real positions (FlyWire)" }, pb("brainmap"));
}

// ---------- 뉴런 묶음 ----------
function buildGroups() {
  const g = init.groups, side = init.side, sc = init.super_class;
  const readout = init.readout?.neurons || [...new Set(Object.keys(g).filter((k) => k.startsWith("out_")).flatMap((k) => g[k]))];
  const inSet = new Set([...g.in_odor_food, ...g.in_odor_co2, ...g.in_looming]), dnSet = new Set(readout);
  const sens = [];
  for (const [k, name, color] of [["in_odor_food", "Food odor ORN", PAL.food], ["in_odor_co2", "CO₂ ORN", PAL.co2], ["in_looming", "LPLC2 · LC4", PAL.pred]]) {
    for (const [s, sn] of [["left", "left"], ["right", "right"]]) sens.push({ name: `${name} ${sn}`, color, idx: g[k].filter((i) => side[i] === s) });
  }
  const byClass = new Map();
  for (let i = 0; i < init.n; i++) {
    if (inSet.has(i) || dnSet.has(i)) continue;
    const k = sc[i] || "";
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k).push(i);
  }
  const mid = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, idx]) => ({ name: SUPER_NAMES[k] || k, idx }));
  groups = { sens, mid, dn: [{ name: "Descending neurons", idx: readout }], readout };
  if (init.sim) groups.disp = buildDisplay(init.sim, groups);
}

// 계산 화면용: 뉴런 표시 순서(감각 → 중간 → 하행), 감각 입력 행렬, 연결 행렬(구역별 합), 읽기 행렬
function buildDisplay(sim, gr) {
  const sideL = (id) => (init.side[id] === "left" ? " L" : init.side[id] === "right" ? " R" : "");
  const all = [...gr.sens, ...gr.mid, ...gr.dn], order = all.flatMap((g) => g.idx), gname = [];
  for (const g of all) for (let k = 0; k < g.idx.length; k++) gname.push(g.name);
  const name = (k) => `${gname[k]} · ${init.cell_type[order[k]] || "neuron"}${sideL(order[k])}`;
  // 감각 입력 행렬 (580 × 36), 행은 감각 묶음 순서
  const sensOrder = gr.sens.flatMap((g) => g.idx), inRow = new Map(Array.from(sim.in_neurons, (id, k) => [id, k]));
  const U = new Float32Array(sensOrder.length * 36);
  sensOrder.forEach((id, k) => { const r = inRow.get(id) * 36; U.set(sim.in_w.subarray(r, r + 36), k * 36); });
  // 연결 행렬: 15,000 × 15,000을 200 × 200 구역으로 묶어 연결 세기 합을 칠한다 (진할수록 강함)
  const NB = 200, N = order.length, pos = new Int32Array(sim.n), bin = (k) => Math.min(NB - 1, Math.floor((k * NB) / N));
  order.forEach((id, k) => (pos[id] = k));
  const P = new Float32Array(NB * NB), Q = new Float32Array(NB * NB), C = new Uint32Array(NB * NB);
  for (let i = 0; i < sim.n; i++) {
    const rb = bin(pos[i]) * NB;
    for (let e = sim.ptr[i]; e < sim.ptr[i + 1]; e++) {
      const c = rb + bin(pos[sim.col[e]]), v = sim.val[e];
      if (v > 0) P[c] += v; else Q[c] += v;
      C[c]++;
    }
  }
  const mags = [];
  for (let c = 0; c < NB * NB; c++) if (C[c]) mags.push(P[c] - Q[c]);
  mags.sort((x, y) => x - y);
  const top = Math.log1p(mags[Math.floor(mags.length * 0.99)] || 1);
  const img = document.createElement("canvas");
  img.width = img.height = NB;
  const g2 = img.getContext("2d"), id2 = g2.createImageData(NB, NB);
  for (let c = 0; c < NB * NB; c++) {
    const t = C[c] ? Math.min(1, Math.log1p(P[c] - Q[c]) / top) * 0.92 : 0;
    for (let ch = 0; ch < 3; ch++) id2.data[4 * c + ch] = Math.round(255 + (PAL.real[ch] - 255) * t);
    id2.data[4 * c + 3] = 255;
  }
  g2.putImageData(id2, 0, 0);
  const conn = { img, rows: N, cols: N, hit: (r, c) => {
    const k = bin(r) * NB + bin(c);
    return { text: `W · to ${gname[r]} ← from ${gname[c]} · ${C[k].toLocaleString()} connections in this block (excitatory Σ ${f2(P[k])}, inhibitory Σ ${f2(Q[k])})` };
  } };
  const ro = init.readout, dnName = (j) => `${init.cell_type[ro.neurons[j]] || "DN"}${sideL(ro.neurons[j])}`;
  const B = { data: ro.w, rows: 3, cols: ro.neurons.length,
    hit: (r, c) => ({ text: `B[${["forward", "turn", "jump"][r]}, ${dnName(c)}] = ${(ro.w[r * ro.neurons.length + c] < 0 ? "−" : "") + Math.abs(ro.w[r * ro.neurons.length + c]).toFixed(3)}` }) };
  return { order, name, sensOrder, inRow, U: { data: U, rows: sensOrder.length, cols: 36 }, sensName: (k) => name(k), conn, B, dnName };
}

// ---------- 공개 함수 ----------
export function setupExplorer(msg, { onMode } = {}) {
  if (!$("flow-svg")) return false;
  init = msg;
  onModeChange = onMode || (() => {});
  buildGroups();
  buildFlow();
  document.querySelectorAll("#src-mode button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.src)));
  for (const id of ["wml-canvas", "brl-canvas"]) { $(id).addEventListener("mousemove", hover); $(id).addEventListener("mouseleave", unhover); }
  for (const [id, key] of [["wml-steps", () => wmSel], ["brl-steps", () => brSel]]) {
    $(id).addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]");
      if (!b) return;
      stepSel[key()] = +b.dataset.k;
      detailDirty = true;
      $(id === "wml-steps" ? "wml-canvas" : "brl-canvas")._hover = null;
      render();
    });
  }
  setMode("real");
  selectWM(wmSel);
  selectBrain(brSel);
  const gp = document.querySelector(".explorer > .panel.game");
  if (gp) {
    const ro = new ResizeObserver(() => fitGame());
    for (const e of [gp, $("hint"), gp.querySelector(".ghost-toggle"), gp.querySelector(".stats")]) if (e) ro.observe(e);
    window.addEventListener("resize", fitGame);
    fitGame();
  }
  return true;
}

let frames = 0;
export function explorerFrame(f, rates) {
  if (!init) return;
  last = { f, rates };
  if (++frames % 20 === 0) fitGame();   // 창 크기가 바뀐 직후 놓친 경우를 대비한 확인 (1초에 한 번)
  render();
}

function setMode(m) {
  detailDirty = true;
  mode = m;
  document.querySelectorAll("#src-mode button").forEach((b) => b.classList.toggle("on", b.dataset.src === m));
  const real = m === "real";
  setPort(W.pGame, real);
  setPort(W.pRecon, !real, real);
  setPort(W.pAct, true);
  setPort(B.pActG, real);
  setPort(B.pGame, real);
  W.pRecon.note.textContent = real ? "(display only)" : "";
  W.enc.g.setAttribute("opacity", real ? 1 : 0.4);
  G.g.setAttribute("opacity", real ? 1 : 0.4);
  onModeChange(m);
  render();
}

function selectWM(k) {
  detailDirty = true;
  wmSel = k;
  for (const key of ["statemap", "z", "enc", "out", "gru"]) highlight(W[key], key === k);
  $("wmv-statemap").hidden = k !== "statemap";
  $("wmv-layer").hidden = k === "statemap";
  render();
}
function selectBrain(k) {
  detailDirty = true;
  brSel = k;
  for (const key of ["brainmap", "sens", "mid", "dn"]) highlight(B[key], key === k);
  $("brv-map").hidden = k !== "brainmap";
  $("brv-layer").hidden = k === "brainmap";
  render();
}
function highlight(item, on) {
  if (!item) return;
  item.rect.setAttribute("stroke", on ? INK : item.tile ? EDGE : item.c.s);
  item.rect.setAttribute("stroke-width", on ? 2.4 : item.tile ? 0.9 : 0.8);
}

// ---------- 값 꺼내기 ----------
// 지금 보여 줄 값: 실제 플레이면 이번 프레임, 상상이면 재생 중인 상상 스텝
function source() {
  if (!last) return null;
  const { f, rates } = last;
  if (mode === "real") {
    const wm = f.wm;
    return {
      label: `step ${f.step}`, obs: f.obs, act: f.action, rates,
      wm: wm && { h: wm.h, z: wm.z, prior: wm.prior_probs, post: wm.z_probs, e: wm.embed, aIn: wm.a_prev, recon: wm.recon,
                  reward: wm.reward_pred, cont: wm.cont, value: wm.value, kl: wm.surprise },
      hPrev: wm?.h_prev, zPrev: wm?.z_prev, aIn: wm?.a_prev, io: f.brain_io,
    };
  }
  const d = f.dream;
  if (!d) return { waiting: true };
  return {
    label: `imagined step +${d.step}/${d.of} (from step ${d.originStep})`, obs: d.obs, act: d.action, rates: d.rates,
    wm: { h: d.h, z: d.z, prior: d.prior, recon: d.obs, aIn: d.action, reward: d.reward, cont: d.cont, value: d.value },
    hPrev: d.h_prev, zPrev: d.z_prev, aIn: d.action, io: d.io,
  };
}

// ---------- 그리기 ----------
let lastDetail = 0, detailDirty = true;
function render() {
  if (!init) return;
  const s = source();
  if (!s || s.waiting) {
    setHTML($("wml-head"), head("Waiting for the first imagined rollout…", ""));
    setHTML($("brl-head"), head("Waiting for the first imagined rollout…", ""));
    return;
  }
  // 그림 안 값
  if (s.wm) {
    setText(W.z.val, mode === "real" && s.wm.kl != null ? `KL(q‖p) ${s.wm.kl.toFixed(2)}` : "from prior ẑ_t");
    setText(W.out.val, s.wm.value != null ? `v_t ${f2(s.wm.value)}` : "");
    W.enc.val.textContent = mode === "real" ? "" : "off";
  }
  // 상세 칸(계산 그림)은 초당 10번까지만 다시 그린다. 칸·단계·모드를 바꾸면 바로 그린다
  const now = performance.now();
  if (detailDirty || now - lastDetail > 95) {
    detailDirty = false;
    lastDetail = now;
    renderWMDetail(s);
    renderBrainDetail(s);
  }
}

const head = (t, sub) => `<div class="xd-head"><span class="xd-title">${t}</span><span class="muted">${sub}</span></div>`;
const formula = (s) => `<div class="xd-formula">${s}</div>`;
const para = (a, b = "") => `<div class="xd-text">${a}</div>${b ? `<div class="xd-note">${b}</div>` : ""}`;
const sideOf = (v) => {
  const l = Math.max(...v.slice(4, 20)), r = Math.max(...v.slice(20, 36));
  return Math.max(l, r) < 0.05 ? "no predator signal" : l > r ? "predator signal on the left eye" : "predator signal on the right eye";
};
const obsText = (v) => `food odor L ${v[0].toFixed(2)} · R ${v[1].toFixed(2)} · CO₂ L ${v[2].toFixed(2)} · R ${v[3].toFixed(2)} · ${sideOf(v)}`;
const actText = (a) => `forward ${f2(a[0])} · turn ${a[1] >= 0 ? "+" : "−"}${Math.abs(a[1]).toFixed(2)} (${a[1] >= 0 ? "left" : "right"}) · jump ${f2(a[2])}${a[2] > 0.5 ? " → jump" : ""}`;
const argz = (p) => { const z = new Array(256).fill(0); for (let g = 0; g < 16; g++) { let k = 0; for (let c = 1; c < 16; c++) if (p[g * 16 + c] > p[g * 16 + k]) k = c; z[g * 16 + k] = 1; } return z; };

// 상세 화면 안에서 캔버스에 쓸 수 있는 높이: 상세 칸 높이 − (제목·감각 막대·안내·설명 높이)
// 그림을 이 높이에 맞춰 그려서 스크롤 없이 한 화면에 들어가게 한다.
function rawRoom(detailId, ids) {
  let used = 0;
  for (const id of ids) { const e = $(id); if (e && !e.hidden) used += e.offsetHeight; }
  return $(detailId).clientHeight - used - 16;
}
const room = (detailId, ids) => Math.max(30, rawRoom(detailId, ids));

// 칸이 낮으면(작은 화면) 그림이 들어갈 자리 need가 생길 때까지 단계적으로 줄인다:
// 1단계 보조 설명(xd-note) 숨김, 2단계 글자 크기 축소·감각 범례 숨김·DN 표 3줄
function tighten(detailId, ids, need) {
  const d = $(detailId);
  let lv = 0;
  d.dataset.tight = "0";
  while (lv < 3 && rawRoom(detailId, ids) < need) d.dataset.tight = String(++lv);
}

// 게임 칸: 게임 화면 크기를 칸에 남은 높이에 맞춘다 (Events 목록은 남는 자리만 쓴다)
function fitGame() {
  const p = document.querySelector(".explorer > .panel.game"), g = $("game");
  if (!p || !g) return;
  if (matchMedia("(max-width: 1100px)").matches) { g.style.width = ""; return; }
  const cs = getComputedStyle(p);
  let used = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  for (const c of p.children) {
    if (c === g || c.id === "events") continue;
    const m = getComputedStyle(c);
    if (m.display === "none") continue;
    used += c.offsetHeight + parseFloat(m.marginTop) + parseFloat(m.marginBottom);
  }
  const wMax = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  g.style.width = `${Math.floor(Math.max(160, Math.min(wMax, p.clientHeight - used - 44)))}px`;
}

// ---------- 계산 화면: 층을 누르면 단계별로 "W · x + b = y → 활성화" ----------
// 표기는 RSSM 논문을 따른다: o_t 관측, a_t 행동, h_t 결정적 상태, z_t 확률적 상태(사후), ẑ_t 사전,
// e_t 인코더 출력, ô_t 복원 관측, r̂_t 보상, ĉ_t 계속, v_t 가치. 뇌: ρ 발화율, v 막전위, I 감각 입력.
const stepSel = { enc: 0, gru: 0, z: 0, out: 0, sens: 0, mid: 0, dn: 0 };
const V = (v, label, kind = "signed", space = null, extra = {}) => ({ t: "vec", v, label, kind, space, ...extra });
const M = (m, label, rowSpace = "j", colSpace = "i", extra = {}) => ({ t: "mat", m, label, rowSpace, colSpace, ...extra });
const G16 = (v, label, kind = "unit", space = "g") => ({ t: "grid", v, label, kind, space });
const op = (s) => ({ t: "op", s });
const fn = (s) => ({ t: "fn", s });
const num = (text, label) => ({ t: "num", text, label });
const add = (a, b) => Float32Array.from(a, (v, i) => v + b[i]);
const OBS_NAME = (i) => (i < 2 ? `food odor ${i ? "right" : "left"}` : i < 4 ? `CO₂ ${i === 3 ? "right" : "left"}` : i < 20 ? `left eye cell ${i - 3}` : `right eye cell ${i - 19}`);
const ACT_NAME = (i) => ["forward", "turn (+ = left)", "jump"][i];
const ZNAME = (i) => `group ${Math.floor(i / 16) + 1}, class ${(i % 16) + 1}`;
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const check = (d) => `Recomputed in the browser from the exported weights (float16). Largest difference from the running ONNX model: ${d < 1e-3 ? d.toExponential(0) : d.toFixed(3)}.`;

// 한 층의 Linear: W · x + b = y (→ LN, SiLU → x')
function linearItems(st, W, inItem, bLab, yLab, outLab) {
  return [M(st.W, W), op("·"), inItem, op("+"), V(st.b.data, bLab, "signed", "j"), op("="),
    V(st.pre, outLab && !yLab ? outLab : yLab, "signed", "j"), ...(outLab && yLab ? [fn("LN, SiLU"), V(st.post, outLab, "signed", "j")] : [])];
}

function wmLayer(s) {
  const w = s.wm, x = init.explain, real = mode === "real", h = w.h, z = w.z;
  if (wmSel === "enc") {
    if (!real) return { title: "Encoder", sub: `${s.label} · not used`, steps: [{ chip: "off", tex: "e_t=\\mathrm{enc}(o_t)",
      body: "While imagining there is no observation o<sub>t</sub>, so the encoder is not used. z<sub>t</sub> comes from the prior ẑ<sub>t</sub> instead." }] };
    const L = x.encoder(s.obs), body = `o<sub>t</sub>: ${obsText(s.obs)}.`;
    return { title: "Encoder", sub: `${s.label} · 142,080 parameters`, steps: [
      { chip: "Linear 1", tex: "y^{(1)}_j=\\sum_{i=1}^{36}W^{(1)}_{ji}\\,o_{t,i}+b^{(1)}_j,\\qquad x^{(1)}=\\mathrm{SiLU}\\big(\\mathrm{LN}(y^{(1)})\\big)",
        items: linearItems(L[0], "W^{(1)}", V(s.obs, "o_t", "obs", "i", { names: OBS_NAME }), "b^{(1)}", "y^{(1)}", "x^{(1)}"), body },
      { chip: "Linear 2", tex: "y^{(2)}_j=\\sum_{i=1}^{256}W^{(2)}_{ji}\\,x^{(1)}_i+b^{(2)}_j,\\qquad x^{(2)}=\\mathrm{SiLU}\\big(\\mathrm{LN}(y^{(2)})\\big)",
        items: linearItems(L[1], "W^{(2)}", V(L[1].input, "x^{(1)}", "signed", "i"), "b^{(2)}", "y^{(2)}", "x^{(2)}"),
        body: "LN normalizes the 256 values (LayerNorm), then SiLU(y) = y·σ(y)." },
      { chip: "Linear 3", tex: "e_{t,j}=\\sum_{i=1}^{256}W^{(3)}_{ji}\\,x^{(2)}_i+b^{(3)}_j",
        items: linearItems(L[2], "W^{(3)}", V(L[2].input, "x^{(2)}", "signed", "i"), "b^{(3)}", null, "e_t"),
        body: "e<sub>t</sub> goes into the posterior q(z<sub>t</sub> | h<sub>t</sub>, e<sub>t</sub>).", note: w.e ? check(maxDiff(L[2].pre, w.e)) : "" },
    ] };
  }
  if (wmSel === "gru") {
    const q = x.sequence(s.hPrev, s.zPrev, s.aIn), W = x.W;
    const xt = () => V(q.x, "x_t", "signed", "i"), hp = () => V(q.hPrev, "h_{t-1}", "signed", "k");
    const gate = (g, chip, tex, body) => ({ chip, tex, body, items: [M(W[`gru.${g}_ih`], `W_{i${g}}`, "j", "i"), op("·"), xt(), op("+"),
      M(W[`gru.${g}_hh`], `W_{h${g}}`, "j", "k"), op("·"), hp(), op("+"), V(add(W[`gru.b${g}_ih`].data, W[`gru.b${g}_hh`].data), `b_${g}`, "signed", "j"),
      fn("σ"), V(q[g], `${g}_t`, "unit", "j")] });
    return { title: "Deterministic state h_t (GRU)", sub: `${s.label} · 461,824 parameters`, steps: [
      { chip: "Input x_t", tex: "x_t=\\mathrm{SiLU}\\big(\\mathrm{LN}(W_x\\,[z_{t-1};\\,a_{t-1}]+b_x)\\big)",
        items: [M(W["img_in.0.weight"], "W_x"), op("·"), V(q.inp, "[z_{t-1}; a_{t-1}]", "signed", "i", { names: (i) => (i < 256 ? `z_{t−1} ${ZNAME(i)}` : `a_{t−1} ${ACT_NAME(i - 256)}`) }),
          op("+"), V(W["img_in.0.bias"].data, "b_x", "signed", "j"), op("="), V(q.pre, "y", "signed", "j"), fn("LN, SiLU"), V(q.x, "x_t", "signed", "j")],
        body: `a<sub>t−1</sub>: ${actText(s.aIn)}. z<sub>t−1</sub> is one-hot (one class per group), so only 16 of its 256 values are 1.` },
      gate("u", "Update u_t", "u_t=\\sigma\\big(W_{iu}x_t+W_{hu}h_{t-1}+b_u\\big)",
        "How much of h<sub>t−1</sub> to keep. (PyTorch names this gate z; it is u here so it does not clash with the stochastic state z<sub>t</sub>.)"),
      gate("r", "Reset r_t", "r_t=\\sigma\\big(W_{ir}x_t+W_{hr}h_{t-1}+b_r\\big)", "How much of h<sub>t−1</sub> the candidate n<sub>t</sub> may use."),
      { chip: "Candidate n_t", tex: "n_t=\\tanh\\big(W_{in}x_t+b_{in}+r_t\\odot(W_{hn}h_{t-1}+b_{hn})\\big)",
        items: [M(W["gru.n_ih"], "W_{in}"), op("·"), xt(), op("+"), V(W["gru.bn_ih"].data, "b_{in}", "signed", "j"), op("+"),
          V(q.r, "r_t", "unit", "j"), op("⊙"), V(q.hn, "W_{hn}h_{t-1}+b", "signed", "j"), fn("tanh"), V(q.n, "n_t", "signed", "j")],
        body: "The new content proposed for the memory." },
      { chip: "h_t", tex: "h_t=(1-u_t)\\odot n_t+u_t\\odot h_{t-1}",
        items: [V(q.oneMinusU, "1−u_t", "unit", "j"), op("⊙"), V(q.n, "n_t", "signed", "j"), op("+"), V(q.u, "u_t", "unit", "j"), op("⊙"),
          V(q.hPrev, "h_{t-1}", "signed", "j"), op("="), V(q.h, "h_t", "signed", "j")],
        body: "Deterministic: the same h<sub>t−1</sub>, z<sub>t−1</sub>, a<sub>t−1</sub> always give the same h<sub>t</sub>.", note: check(maxDiff(q.h, h)) },
    ] };
  }
  if (wmSel === "z") {
    const pr = x.prior(h), p0 = pr.steps[0], p1 = pr.steps[1];
    const steps = [
      { chip: "Prior 1", tex: "x^{p}=\\mathrm{SiLU}\\big(\\mathrm{LN}(W^{p}_1h_t+b^{p}_1)\\big)",
        items: linearItems(p0, "W^p_1", V(h, "h_t", "signed", "i"), "b^p_1", "y", "x^p"),
        body: "The prior guesses z<sub>t</sub> from h<sub>t</sub> alone, without the observation." },
      { chip: "Prior 2", tex: "p(\\hat z_t\\mid h_t)=\\mathrm{softmax}_{16}\\big(W^{p}_2x^{p}+b^{p}_2\\big)" + (real ? "" : ",\\quad z_t=\\arg\\max"),
        items: [M(p1.W, "W^p_2", "g", "i"), op("·"), V(p1.input, "x^p", "signed", "i"), fn("+ b, softmax"), G16(pr.probs, "p(ẑ_t)"),
          ...(real ? [] : [fn("argmax"), G16(pr.z, "z_t", "onehot")])],
        body: real ? "16 groups × 16 classes; softmax within each group, mixed with 1% uniform." : "While imagining, the prior's most likely class in each group becomes z<sub>t</sub>.",
        note: w.prior ? check(maxDiff(pr.probs, w.prior)) : "" },
    ];
    if (real) {
      const e = w.e || x.encoder(s.obs)[2].pre, po = x.posterior(h, e), q0 = po.steps[0], q1 = po.steps[1];
      steps.push(
        { chip: "Posterior 1", tex: "x^{q}=\\mathrm{SiLU}\\big(\\mathrm{LN}(W^{q}_1[h_t;\\,e_t]+b^{q}_1)\\big)",
          items: linearItems(q0, "W^q_1", V(q0.input, "[h_t; e_t]", "signed", "i", { names: (i) => (i < 256 ? `h_t #${i + 1}` : `e_t #${i - 255}`) }), "b^q_1", "y", "x^q"),
          body: "The posterior also sees the observation, through e<sub>t</sub>." },
        { chip: "Posterior 2", tex: "q(z_t\\mid h_t,e_t)=\\mathrm{softmax}_{16}\\big(W^{q}_2x^{q}+b^{q}_2\\big),\\quad z_t=\\arg\\max",
          items: [M(q1.W, "W^q_2", "g", "i"), op("·"), V(q1.input, "x^q", "signed", "i"), fn("+ b, softmax"), G16(po.probs, "q(z_t)"), fn("argmax"), G16(po.z, "z_t", "onehot")],
          body: `Surprise KL(q ‖ p) = ${w.kl.toFixed(2)}: how much the observation changed the prior's guess.`,
          note: `Same z<sub>t</sub> as the running model: ${maxDiff(po.z, z) === 0 ? "yes" : "no"}.` },
      );
    }
    return { title: "Stochastic state z_t", sub: `${s.label} · prior 132,096${real ? " + posterior 197,632" : ""} parameters`, steps };
  }
  // 출력: 복원 관측 ô_t, 보상 r̂_t (ĉ_t, v_t는 값만)
  const dec = x.decoder(h, z), rw = x.reward(h, z), d0 = dec.steps[0], d1 = dec.steps[1], d2 = dec.steps[2], r2 = rw.steps[2];
  const hz = V(d0.input, "[h_t; z_t]", "signed", "i", { names: (i) => (i < 256 ? `h_t #${i + 1}` : `z_t ${ZNAME(i - 256)}`) });
  return { title: "Outputs", sub: `${s.label} · 471,075 parameters`, steps: [
    { chip: "Decoder 1", tex: "x^{(1)}=\\mathrm{SiLU}\\big(\\mathrm{LN}(W^{(1)}[h_t;\\,z_t]+b^{(1)})\\big)",
      items: linearItems(d0, "W^{(1)}", hz, "b^{(1)}", "y^{(1)}", "x^{(1)}"), body: "The decoder turns the model state (h<sub>t</sub>, z<sub>t</sub>) back into an observation." },
    { chip: "Decoder 2", tex: "x^{(2)}=\\mathrm{SiLU}\\big(\\mathrm{LN}(W^{(2)}x^{(1)}+b^{(2)})\\big)",
      items: linearItems(d1, "W^{(2)}", V(d1.input, "x^{(1)}", "signed", "i"), "b^{(2)}", "y^{(2)}", "x^{(2)}"), body: "Second hidden layer." },
    { chip: "Decoder 3", tex: "\\hat o_{t,j}=\\mathrm{clip}_{[0,1]}\\Big(\\sum_{i=1}^{256}W^{(3)}_{ji}\\,x^{(2)}_i+b^{(3)}_j\\Big)",
      items: [M(d2.W, "W^{(3)}"), op("·"), V(d2.input, "x^{(2)}", "signed", "i"), op("+"), V(d2.b.data, "b^{(3)}", "signed", "j"), op("="),
        V(dec.recon, "ô_t", "obs", "j", { names: OBS_NAME }), ...(real ? [op("vs"), V(s.obs, "o_t", "obs", "j", { names: OBS_NAME })] : [])],
      body: real ? `In real play ô<sub>t</sub> is only displayed; compare it with the real o<sub>t</sub>.` : "ô<sub>t</sub> stands in for o<sub>t</sub>: the brain's sensory neurons get it at the next imagined step.",
      note: real ? check(maxDiff(dec.recon, w.recon)) : "" },
    { chip: "Reward head", tex: "\\hat r_t=\\mathrm{symexp}\\Big(\\sum_{k=1}^{255}\\mathrm{softmax}(\\ell)_k\\,b_k\\Big),\\quad \\ell=W^{r}_3x^{r}+b^{r}_3",
      items: [M(r2.W, "W^r_3"), op("·"), V(r2.input, "x^r", "signed", "i"), fn("+ b, softmax"),
        V(rw.probs, "p", "unit", "j", { names: (k) => `bin ${k + 1} (symlog reward ${x.bins[k].toFixed(2)})` }), fn("symexp(Σ p_k b_k)"), num(f2(rw.value), "r̂_t")],
      body: `x<sup>r</sup> comes from two hidden layers shaped like the decoder's. Continue ĉ<sub>t</sub> = ${Math.round((w.cont ?? 1) * 100)}%, value v<sub>t</sub> = ${f2(w.value ?? 0)} (critic).`,
      note: w.reward != null ? check(Math.abs(rw.value - w.reward)) : "" },
  ] };
}

function brainLayer(s) {
  const io = s.io, sim = init.sim, r = s.rates, real = mode === "real", oLab = real ? "o_t" : "ô_t";
  if (!io || !sim) return { title: "Fly brain", sub: s.label, steps: [{ chip: "", tex: "", body: "Waiting for the brain's first step…" }] };
  if (brSel === "sens") {
    const D = groups.disp, n = D.sensOrder.length;
    const I = Float32Array.from(D.sensOrder, (id) => io.I[D.inRow.get(id)]), rho = Float32Array.from(D.sensOrder, (id) => r[id] / 255);
    return { title: "Sensory neurons · 580", sub: `${s.label} · input: ${real ? "real observation o<sub>t</sub>" : "reconstruction ô<sub>t</sub>"}`, steps: [
      { chip: "Adaptation", tex: "s_t=\\max\\big(0,\\;o_t+8\\,m\\odot(o_t-c_{t-1})\\big),\\qquad c_t=c_{t-1}+0.3\\,(o_t-c_{t-1})",
        items: [V(s.obs, oLab, "obs", "i", { names: OBS_NAME }), op("−"), V(io.c, "c_{t-1}", "obs", "i", { names: OBS_NAME }), fn("×8m, +" + oLab + ", max(0, ·)"), V(io.s, "s_t", "obs", "i", { names: OBS_NAME })],
        body: "m = 1 only on the 4 odor channels, so smell responds to change like real olfactory receptor neurons; c is the recent average." },
      { chip: "Input weights", tex: "I_{t,k}=\\sum_{j=1}^{36}\\mathrm{softplus}(U_{kj})\\,M_{kj}\\,s_{t,j}",
        items: [M(D.U, "softplus(U)⊙M", "k", "i"), op("·"), V(io.s, "s_t", "obs", "i", { names: OBS_NAME }), op("="),
          V(I, "I_t", "signed", "k", { names: D.sensName }), fn("dynamics"), V(rho, "ρ_t", "unit", "k", { names: D.sensName })],
        body: "M lets each sense reach only neurons of its own type and side (5,290 learned weights). I<sub>t</sub> then drives v (see Middle)." },
    ] };
  }
  if (brSel === "mid") {
    const D = groups.disp, N = D.order.length, prev = new Float32Array(sim.n);
    for (let i = 0; i < sim.n; i++) prev[i] = io.rPrev[i] / 255;
    const wr = new Float32Array(N), Iall = new Float32Array(sim.n);
    sim.in_neurons.forEach((id, k) => (Iall[id] = io.I[k]));
    D.order.forEach((id, k) => { let a = 0; for (let e = sim.ptr[id]; e < sim.ptr[id + 1]; e++) a += sim.val[e] * prev[sim.col[e]]; wr[k] = a; });
    const dv = (arr, sc = 1) => Float32Array.from(D.order, (id) => arr[id] * sc);
    return { title: "Middle neurons · 13,144", sub: `${s.label} · all 15,000 neurons, recurrent`, steps: [
      { chip: "Recurrent step", tex: "v_i\\leftarrow v_i+\\alpha_i\\Big(-v_i+\\sum_jW_{ij}\\,\\rho_j+I_i+b_i\\Big),\\qquad\\rho_i=\\tanh(\\max(v_i,0))\\quad(\\times3)",
        items: [M(D.conn, "W", "i", "j"), op("·"), V(dv(prev), "ρ_{t-1}", "unit", "j", { names: D.name }), op("="), V(wr, "Wρ_{t-1}", "signed", "i", { names: D.name }),
          op("+"), V(dv(Iall), "I_t", "signed", "i", { names: D.name }), op("+"), V(dv(sim.bias), "b", "signed", "i", { names: D.name }),
          fn("leak α, ×3"), V(dv(r, 1 / 255), "ρ_t", "unit", "i", { names: D.name })],
        body: "W is the FlyWire wiring: 382,539 connections, rows = receiving neuron, columns = sending neuron, ordered sensory → middle → descending. Darker = stronger total connection.",
        note: "Fixed: which connections exist and their sign. Learned: a scale per cell-type pair (164,355), and α and b per cell type (4,198)." },
    ] };
  }
  // 하행뉴런 → 행동
  const ro = init.readout, rho = Float32Array.from(ro.neurons, (id) => r[id] / 255);
  const y = Float32Array.from(io.y), a = y.map(Math.tanh);
  return { title: "Descending neurons · 1,276", sub: `${s.label} · brain → action a<sub>t</sub>`, steps: [
    { chip: "Readout", tex: "y=B\\,\\rho_{\\mathrm{DN}}+d,\\qquad a_t=\\tanh(y)",
      items: [M(groups.disp.B, "B", "a", "n"), op("·"), V(rho, "ρ_{DN}", "unit", "n", { names: groups.disp.dnName }), op("+"),
        V(Float32Array.from(ro.b), "d", "signed", "a", { names: ACT_NAME }), op("="), V(y, "y", "signed", "a", { names: ACT_NAME }), fn("tanh"),
        V(a, "a_t", "act", "a", { names: ACT_NAME })],
      body: `a<sub>t</sub>: ${actText(a)}.`,
      note: "B (3 × 1,276) is learned. It stands in for the nerve cord and body, which the FlyWire brain map does not include." },
  ] };
}

// 글이 바뀌었을 때만 다시 쓴다 (매 프레임 다시 쓰면 화면 배치를 계속 다시 계산함)
function setHTML(el, html) {
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

// 수식 (KaTeX). 같은 수식이면 다시 그리지 않고, 칸보다 넓으면 글자를 줄인다
function setTex(el, tex) {
  const ready = !!window.katex;
  if (el._tex === tex && el._ready === ready) return;
  el._tex = tex; el._ready = ready;
  el.style.fontSize = "";
  if (ready) window.katex.render(tex, el, { throwOnError: false, displayMode: false });
  else el.textContent = tex;
  if (el.scrollWidth > el.clientWidth + 1) el.style.fontSize = `${Math.max(8.5, 12.5 * (el.clientWidth / el.scrollWidth))}px`;
}

// ---------- 단계 구조도: 단계 버튼을 노드로, 단계 사이에 오가는 값을 화살표로 ----------
// 노드 번호는 layer.steps의 순서와 같다. col/row는 격자 위치(0열은 외부 입력 글자).
//   srcs : 외부 입력 { label, row, to: [노드] } 또는 노드 위에서 내려오는 입력 { label, above: true, to: [노드] }
//   edges: 노드 → 노드 { from, to, label } (via: "bottom2"면 아래 둘째 줄로 돌아감)
//   lanes: 여러 노드가 함께 쓰는 값 { side: "top", label, to } (위 줄) / { side: "bottom", from, label, to } (아래 줄)
//   outs : 나가는 값 { from, label }
const GRAPHS = {
  enc: (m) => (m !== "real" ? null : {
    nodes: [{ col: 1 }, { col: 2 }, { col: 3 }],
    srcs: [{ label: "o_t", row: 0, to: [0] }],
    edges: [{ from: 0, to: 1, label: "x^{(1)}" }, { from: 1, to: 2, label: "x^{(2)}" }],
    outs: [{ from: 2, label: "e_t → posterior" }],
  }),
  gru: () => ({
    nodes: [{ col: 1 }, { col: 2 }, { col: 3 }, { col: 4 }, { col: 5 }],
    srcs: [{ label: "[z_{t-1}; a_{t-1}]", above: true, to: [0] }],
    lanes: [{ side: "top", label: "h_{t-1}", to: [1, 2, 3, 4] }, { side: "bottom", from: 0, label: "x_t", to: [1, 2, 3] }],
    edges: [{ from: 2, to: 3, label: "r_t" }, { from: 3, to: 4, label: "n_t" }, { from: 1, to: 4, label: "u_t", via: "bottom2" }],
  }),
  z: (m) => (m === "real" ? {
    nodes: [{ col: 1, row: 0 }, { col: 2, row: 0 }, { col: 1, row: 1 }, { col: 2, row: 1 }],
    srcs: [{ label: "h_t", row: 0, to: [0] }, { label: "[h_t; e_t]", row: 1, to: [2] }],
    edges: [{ from: 0, to: 1, label: "x^p" }, { from: 2, to: 3, label: "x^q" }],
    outs: [{ from: 1, label: "p(ẑ_t)" }, { from: 3, label: "q(z_t) → z_t" }],
  } : {
    nodes: [{ col: 1 }, { col: 2 }],
    srcs: [{ label: "h_t", row: 0, to: [0] }],
    edges: [{ from: 0, to: 1, label: "x^p" }],
    outs: [{ from: 1, label: "p(ẑ_t) → z_t" }],
  }),
  out: () => ({
    nodes: [{ col: 1, row: 0 }, { col: 2, row: 0 }, { col: 3, row: 0 }, { col: 3, row: 1 }],
    srcs: [{ label: "[h_t; z_t]", row: 0, to: [0, 3], labels: { 3: "x^r (2 hidden layers)" } }],
    edges: [{ from: 0, to: 1, label: "x^{(1)}" }, { from: 1, to: 2, label: "x^{(2)}" }],
    outs: [{ from: 2, label: "ô_t" }, { from: 3, label: "r̂_t" }],
  }),
  sens: (m) => ({
    nodes: [{ col: 1 }, { col: 2 }],
    srcs: [{ label: m === "real" ? "o_t, c_{t-1}" : "ô_t, c_{t-1}", row: 0, to: [0] }],
    edges: [{ from: 0, to: 1, label: "s_t" }],
    outs: [{ from: 1, label: "I_t → Middle" }],
  }),
  mid: () => ({
    nodes: [{ col: 1 }],
    srcs: [{ label: "ρ_{t-1}, I_t", row: 0, to: [0] }],
    outs: [{ from: 0, label: "ρ_t → Descending" }],
  }),
  dn: () => ({
    nodes: [{ col: 1 }],
    srcs: [{ label: "ρ_{DN}", row: 0, to: [0] }],
    outs: [{ from: 0, label: "a_t → game, h_{t+1}" }],
  }),
};

const gCtx = document.createElement("canvas").getContext("2d");
const tw = (s, size) => {
  let w = 0;
  for (const p of parse(s)) { gCtx.font = `${p.mode === "base" ? size : size * 0.72}px Segoe UI`; w += gCtx.measureText(p.t).width; }
  return w;
};

function renderStepGraph(host, steps, g, sel) {
  const NH = 20, RG = 12, FN = 11, FL = 10, LINE = "#9aa1ad";
  host.innerHTML = "";
  const nodes = g.nodes.map((n, i) => ({ col: n.col, row: n.row || 0, k: i, label: steps[i].chip, w: tw(steps[i].chip, FN) + 18 }));
  const lanes = g.lanes || [], edges = g.edges || [], srcs = g.srcs || [], outs = g.outs || [];
  const hasTop = lanes.some((l) => l.side === "top") || srcs.some((s) => s.above);
  const nBottom = lanes.filter((l) => l.side === "bottom").length + edges.filter((e) => e.via).length;
  const nRows = Math.max(...nodes.map((n) => n.row)) + 1;
  const top = hasTop ? 23 : 3;
  const rowY = (r) => top + r * (NH + RG);
  const rowsBottom = rowY(nRows - 1) + NH;
  const laneY = { top: top - 9, bottom: rowsBottom + 9, bottom2: rowsBottom + 20 };
  const H = rowsBottom + (nBottom ? 9 + 11 * (nBottom - 1) + 9 : 3);
  // 열 위치: 열 폭 = 가장 넓은 노드, 열 사이 = 그 사이 화살표 글자가 들어갈 만큼
  const nCols = Math.max(...nodes.map((n) => n.col)) + 1;
  const colW = new Array(nCols).fill(0), gap = new Array(nCols).fill(16);
  colW[0] = Math.max(0, ...srcs.filter((s) => !s.above).map((s) => tw(s.label, FL) + 2));
  nodes.forEach((n) => (colW[n.col] = Math.max(colW[n.col], n.w)));
  edges.filter((e) => !e.via).forEach((e) => { const c = nodes[e.to].col; gap[c] = Math.max(gap[c], tw(e.label, FL) + 24); });
  if (!colW[0]) gap[1] = 0;
  const colX = [];
  let x = 2;
  for (let c = 0; c < nCols; c++) { if (c > 0) x += gap[c]; colX[c] = x; x += colW[c]; }
  nodes.forEach((n) => { n.x = colX[n.col]; n.y = rowY(n.row); n.r = n.x + n.w; n.cx = n.x + n.w / 2; n.cy = n.y + NH / 2; n.b = n.y + NH; });
  const outR = Math.max(0, ...outs.map((o) => nodes[o.from].r + 16 + tw(o.label, FL)));
  const W = Math.max(x, outR) + 4;

  const svg = document.createElementNS(NS, "svg");
  svg.id = `${host.id}-svg`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Steps of this layer and the values passed between them. Click a step to show its computation.");
  svg.style.width = `${Math.min(W, host.clientWidth || W)}px`;
  host.appendChild(svg);
  defs(svg);
  const mk = `url(#${svg.id}-ar)`;
  const path = (d, end = true) => el("path", { d, fill: "none", stroke: LINE, "stroke-width": 1.1, ...(end ? { "marker-end": mk } : {}) }, svg);
  // 글자 뒤에 흰 바탕을 깔아 선 위에 바로 쓴다
  const tag = (cx, cy, s, anchor = "middle") => {
    const w = tw(s, FL), x0 = anchor === "middle" ? cx - w / 2 : cx;
    el("rect", { x: x0 - 2, y: cy - 6.5, width: w + 4, height: 12, fill: "#ffffff" }, svg);
    text(svg, anchor === "middle" ? cx : cx, cy + 3.5, s, { a: anchor === "middle" ? "middle" : "start", size: FL, fill: SUB });
  };

  // 외부 입력
  for (const s of srcs) {
    for (const t of s.to) {
      const n = nodes[t];
      if (s.above) { path(`M${n.cx} ${top - 8} V${n.y - 1}`); continue; }
      const sy = rowY(s.row) + NH / 2, sx = colX[0] + colW[0] + 3;
      if (n.row === s.row) path(`M${sx} ${sy} H${n.x - 1}`);
      else {
        const xm = sx + 5;
        path(`M${sx} ${sy} H${xm} V${n.cy} H${n.x - 1}`);
        if (s.labels?.[t]) tag((xm + n.x) / 2, n.cy, s.labels[t]);
      }
    }
    if (s.above) { const n = nodes[s.to[0]]; text(svg, n.cx, top - 13, s.label, { size: FL, fill: SUB }); }
    else text(svg, colX[0] + colW[0], rowY(s.row) + NH / 2 + 3.5, s.label, { a: "end", size: FL, fill: SUB });
  }
  // 함께 쓰는 값 (위·아래 줄)
  for (const l of lanes) {
    const ts = l.to.map((t) => nodes[t]);
    if (l.side === "top") {
      const y = laneY.top, x0 = ts[0].cx - 38;
      path(`M${x0} ${y} H${ts.at(-1).cx}`, false);
      for (const n of ts) path(`M${n.cx} ${y} V${n.y - 1}`);
      tag(x0 + 1, y, l.label, "start");
    } else {
      const f = nodes[l.from], y = laneY.bottom;
      path(`M${f.cx} ${f.b} V${y} H${ts.at(-1).cx - 5}`, false);
      for (const n of ts) path(`M${n.cx - 5} ${y} V${n.b + 1}`);
      tag((f.cx + ts[0].cx - 5) / 2, y, l.label);
    }
  }
  // 노드 → 노드
  for (const e of edges) {
    const a = nodes[e.from], b = nodes[e.to];
    if (e.via) {
      const y = laneY.bottom2;
      path(`M${a.cx + 5} ${a.b} V${y} H${b.cx} V${b.b + 1}`);
      tag((a.cx + b.cx) / 2, y, e.label);
    } else if (a.row === b.row) {
      path(`M${a.r} ${a.cy} H${b.x - 1}`);
      tag((a.r + b.x) / 2, a.cy, e.label);
    } else {
      const xm = b.x - 10;
      path(`M${a.r} ${a.cy} H${xm} V${b.cy} H${b.x - 1}`);
      tag(xm, (a.cy + b.cy) / 2, e.label);
    }
  }
  // 나가는 값
  for (const o of outs) {
    const n = nodes[o.from];
    path(`M${n.r} ${n.cy} H${n.r + 13}`);
    text(svg, n.r + 16, n.cy + 3.5, o.label, { a: "start", size: FL, fill: SUB });
  }
  // 노드 (단계 버튼)
  for (const n of nodes) {
    const on = n.k === sel;
    const gr = el("g", { "data-k": n.k, style: "cursor:pointer" }, svg);
    el("rect", { x: n.x, y: n.y, width: n.w, height: NH, rx: 10, fill: on ? INK : "#ffffff", stroke: on ? INK : EDGE, "stroke-width": 1 }, gr);
    text(gr, n.cx, n.cy + 4, n.label, { size: FN, fill: on ? "#ffffff" : INK });
    el("title", {}, gr).textContent = `Step ${n.k + 1}: ${n.label.replace(/[_^{}]/g, "")}`;
  }
}

const PANELS = {
  wm: { head: "wml-head", steps: "wml-steps", tex: "wml-tex", cv: "wml-canvas", hov: "wml-hov", body: "wml-body", detail: "wm-detail" },
  br: { head: "brl-head", steps: "brl-steps", tex: "brl-tex", cv: "brl-canvas", hov: "brl-hov", body: "brl-body", detail: "brain-detail" },
};
function renderSteps(which, key, layer) {
  const P = PANELS[which], k = Math.min(stepSel[key], layer.steps.length - 1), st = layer.steps[k];
  setHTML($(P.head), head(plain(layer.title), layer.sub));
  // 단계 구조도: 칸·단계·모드·폭이 바뀔 때만 다시 그린다
  const graph = GRAPHS[key]?.(mode), host = $(P.steps);
  const gkey = graph ? `${key}|${mode}|${k}|${host.clientWidth}|${layer.steps.map((x) => x.chip).join(",")}` : "";
  if (host.dataset.key !== gkey) {
    host.dataset.key = gkey;
    if (graph) renderStepGraph(host, layer.steps, graph, k);
    else host.innerHTML = layer.steps.length > 1 ? layer.steps.map((x, i) => `<button data-k="${i}"${i === k ? ' class="on"' : ""}>${i + 1} · ${plain(x.chip)}</button>`).join("") : "";
  }
  setTex($(P.tex), st.tex);
  setHTML($(P.body), para(st.body || "", st.note || ""));
  const cv = $(P.cv), ids = [P.head, P.steps, P.tex, P.hov, P.body];
  cv.hidden = !st.items;
  if (st.items) {
    tighten(P.detail, ids, 130);
    drawCompute(cv, { items: st.items }, room(P.detail, ids));
  } else {
    tighten(P.detail, ids, 0);
    cv._placed = null; cv._hover = null;
  }
}

function renderWMDetail(s) {
  if (wmSel === "statemap") return;
  $("wml-sense").hidden = true;
  if (!s.wm || !init.explain) {
    setHTML($("wml-head"), head(s.wm ? "Computation view needs web/data/wm_weights.json" : "World model not loaded", s.wm ? "run: python -m worldmodel.export_weights" : ""));
    $("wml-canvas").hidden = true;
    return;
  }
  renderSteps("wm", wmSel, wmLayer(s));
}

function renderBrainDetail(s) {
  if (brSel === "brainmap") return;
  renderSteps("br", brSel, brainLayer(s));
}

// 마우스: 계산 그림이면 같은 첨자의 행·열·칸을 함께 강조하고 값을 보여 준다
function hover(e) {
  const cv = e.currentTarget, out = $(cv.id === "wml-canvas" ? "wml-hov" : "brl-hov");
  const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (cv._placed) {
    const h = hitCompute(cv, px, py);
    cv._hover = h && h.space ? { space: h.space, idx: h.idx } : null;
    out.innerHTML = h ? h.text : "";
    drawCompute(cv, cv._spec, cv._maxH);
  }
}
function unhover(e) {
  const cv = e.currentTarget;
  if (cv._placed && cv._hover) { cv._hover = null; drawCompute(cv, cv._spec, cv._maxH); }
}
