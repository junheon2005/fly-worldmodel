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
const seq = (v) => shade(PAL.real, 0.92 * Math.min(1, Math.max(0, v || 0)));   // 0~1 값: 옅은 회색 → 검정
const signed = (v) => shade(PAL.real, 0.5 + 0.46 * Math.max(-1, Math.min(1, v || 0)), [250, 250, 251]);   // −1~1 값: 밝음(−) → 진함(+)
const SENSE = (i) => (i < 2 ? PAL.food : i < 4 ? PAL.co2 : PAL.pred);   // 감각 36칸: 먹이 냄새 2, CO2 2, 눈 32
const ACT = (i) => rgb(i < 2 ? PAL.action : PAL.jump);                  // 행동 3칸: 전진·회전 = 걷기, 점프
const f2 = (x) => (x < 0 ? "−" : "") + Math.abs(x).toFixed(2);
const active = (v) => v.filter((x) => x > 0.05).length;

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
// 층 상자: 제목, 부제, 값, (선택) 발화율 막대. 모두 가운데 정렬
function box(svg, { x, y, w, h, c, title, sub, bar = false }, onClick) {
  const g = el("g", { style: "cursor:pointer" }, svg);
  const rect = el("rect", { x, y, width: w, height: h, rx: 7, fill: c.in, stroke: c.s, "stroke-width": 0.8 }, g);
  text(g, x + w / 2, y + 18, title, { size: 12.5, w: 600, fill: c.t });
  text(g, x + w / 2, y + 33, sub, { size: 10, fill: c.u });
  const val = text(g, x + w / 2, y + 49, "", { size: 10.5, fill: c.t });
  let barEl;
  if (bar) {
    el("rect", { x: x + 10, y: y + 56, width: w - 20, height: 6, rx: 2, fill: "#eef0f3", stroke: c.s, "stroke-width": 0.5 }, g);
    barEl = el("rect", { x: x + 10, y: y + 56, width: 0, height: 6, rx: 2, fill: INK }, g);
  }
  g.addEventListener("click", onClick);
  return { g, rect, val, bar: barEl, w, c };
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
// 화살표 옆 작은 값 그림: 감각 36칸 또는 행동 3막대
function glyph(svg, kind, x, y) {
  const g = el("g", { transform: `translate(${x},${y})`, "pointer-events": "none" }, svg);
  el("rect", { x: -2, y: -2, width: kind === "obs" ? 40 : 30, height: 20, rx: 3, fill: "#ffffff", stroke: EDGE, "stroke-width": 0.6 }, g);
  const cells = [];
  if (kind === "obs") {
    for (let i = 0; i < 4; i++) cells.push(el("rect", { x: i * 9, y: 0, width: 8, height: 5 }, g));
    for (let e = 0; e < 2; e++) for (let i = 0; i < 16; i++) cells.push(el("rect", { x: i * 2.25, y: 7 + e * 5, width: 1.9, height: 4 }, g));
  } else {
    el("line", { x1: 0, x2: 26, y1: 8, y2: 8, stroke: EDGE, "stroke-width": 0.6 }, g);
    for (let i = 0; i < 3; i++) cells.push(el("rect", { x: 2 + i * 8, width: 6 }, g));
  }
  return { g, cells, kind };
}
function fillGlyph(gl, v) {
  if (!gl || !v) return;
  if (gl.kind === "obs") gl.cells.forEach((c, i) => c.setAttribute("fill", shade(SENSE(i), v[i])));
  else gl.cells.forEach((c, i) => {
    const h = Math.abs(v[i]) * 8;
    c.setAttribute("y", v[i] >= 0 ? 8 - h : 8);
    c.setAttribute("height", Math.max(0.5, h));
    c.setAttribute("fill", ACT(i));
  });
}
function setPort(p, on, ghost = false) {
  p.path.setAttribute("stroke", on ? flowColor() : DIM);
  p.path.setAttribute("stroke-width", on ? 1.8 : 1.1);
  p.path.setAttribute("stroke-dasharray", on ? "" : "4 3");
  const op = on ? 1 : ghost ? 0.9 : 0.35;
  p.path.setAttribute("opacity", op);
  if (p.label) p.label.setAttribute("opacity", op);
  if (p.glyph) p.glyph.g.setAttribute("opacity", on || ghost ? 1 : 0.3);
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
  el("rect", { x: 4, y: 362, width: 352, height: 274, rx: 12, fill: TEAL.f, stroke: TEAL.s, "stroke-width": 0.6 }, svg);
  text(svg, 74, 384, "Fly brain", { a: "start", size: 13, w: 700, fill: TEAL.t });   // 화살표(x=64, 180, 262, 296)와 겹치지 않는 자리

  // 화살표를 먼저 그려 상자 아래에 깔리게
  W.pGame = { path: arrow(svg, "M180 306 V254"), label: text(svg, 186, 271, "o_t", { a: "start", size: 10.5, fill: SUB }), glyph: glyph(svg, "obs", 188, 278) };
  W.pRecon = { path: arrow(svg, "M64 252 V440 H128"), label: lines(svg, 70, 270, ["reconstruction", "ô_t → brain"], "start"),
               note: text(svg, 70, 292, "", { a: "start", size: 9.5, fill: SUB }), glyph: glyph(svg, "obs", 70, 300) };
  W.pAct = { path: arrow(svg, "M296 410 V254"), label: lines(svg, 302, 300, ["action a_t", "→ h_{t+1}"], "start"), glyph: glyph(svg, "act", 304, 326) };
  B.pActG = { path: arrow(svg, "M262 410 V326 H232") };
  B.pGame = { path: arrow(svg, "M180 346 V408"), label: text(svg, 186, 384, "o_t", { a: "start", size: 10.5, fill: SUB }) };
  arrow(svg, "M180 196 V150", PUR.s);
  arrow(svg, "M276 196 L232 150", PUR.s);
  arrow(svg, "M128 150 L86 194", PUR.s);
  text(svg, 100, 166, "(h_t, z_t)", { a: "end", size: 10, fill: PUR.u });
  arrow(svg, "M180 480 V502", TEAL.s);
  arrow(svg, "M296 504 V482", TEAL.s);

  W.statemap = tile(svg, { x: 16, y: 34, w: 328, h: 38, title: "State map", sub: "model state (h_t, z_t) → 2-D by PCA" }, pw("statemap"));
  W.z = box(svg, { x: 120, y: 92, w: 120, h: 56, c: PUR, title: "z_t", sub: "stochastic · 16×16" }, pw("z"));
  W.out = box(svg, { x: 14, y: 196, w: 100, h: 56, c: PUR, title: "Outputs", sub: "ô_t · r̂_t · ĉ_t · v_t" }, pw("out"));
  W.enc = box(svg, { x: 130, y: 196, w: 100, h: 56, c: PUR, title: "Encoder", sub: "o_t → e_t" }, pw("enc"));
  W.gru = box(svg, { x: 246, y: 196, w: 100, h: 56, c: PUR, title: "h_t", sub: "deterministic · GRU" }, pw("gru"));

  G.g = el("g", {}, svg);
  el("rect", { x: 130, y: 306, width: 100, height: 40, rx: 7, fill: "#ffffff", stroke: "#8a919e", "stroke-width": 1 }, G.g);
  text(G.g, 180, 322, "Game", { size: 12, w: 600 });
  text(G.g, 180, 336, "panel on the right", { size: 9.5, fill: SUB });

  B.sens = box(svg, { x: 130, y: 410, w: 100, h: 70, c: TEAL, title: "Sensory", sub: "580 neurons", bar: true }, pb("sens"));
  B.dn = box(svg, { x: 246, y: 410, w: 100, h: 70, c: TEAL, title: "Descending", sub: "1,276 neurons", bar: true }, pb("dn"));
  B.mid = box(svg, { x: 130, y: 504, w: 216, h: 70, c: TEAL, title: "Middle", sub: "13,144 neurons · recurrent", bar: true }, pb("mid"));
  B.brainmap = tile(svg, { x: 14, y: 588, w: 160, h: 38, title: "Brain map 3D", sub: "neurons at real positions" }, pb("brainmap"));
  B.action = tile(svg, { x: 186, y: 588, w: 160, h: 38, title: "Action path", sub: "forward × turn × jump" }, pb("action"));
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
      const b = e.target.closest("button[data-k]");
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
  for (const key of ["brainmap", "action", "sens", "mid", "dn"]) highlight(B[key], key === k);
  $("brv-map").hidden = k !== "brainmap";
  $("brv-action").hidden = k !== "action";
  $("brv-layer").hidden = k === "brainmap" || k === "action";
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

function sortedRates(rates, idx) {
  const v = new Float32Array(idx.length);
  for (let i = 0; i < idx.length; i++) v[i] = rates[idx[i]] / 255;
  return v.sort().reverse();
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
  const lay = { sens: groups.sens, mid: groups.mid, dn: groups.dn };
  for (const k of ["sens", "mid", "dn"]) {
    let on = 0, tot = 0;
    for (const g of lay[k]) for (const i of g.idx) { tot++; if (s.rates[i] > 12) on++; }
    const p = tot ? on / tot : 0;
    B[k].val.textContent = `${(p * 100).toFixed(0)}% firing`;
    B[k].bar.setAttribute("width", Math.max(1, (B[k].w - 16) * p));
    B[k].bar.setAttribute("fill", flowColor());
  }
  fillGlyph(W.pGame.glyph, s.obs);
  fillGlyph(W.pAct.glyph, mode === "real" ? s.wm?.aIn : s.act);
  fillGlyph(W.pRecon.glyph, s.wm?.recon);
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
  while (lv < 2 && rawRoom(detailId, ids) < need) d.dataset.tight = String(++lv);
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
      { chip: "Linear 3 → e_t", tex: "e_{t,j}=\\sum_{i=1}^{256}W^{(3)}_{ji}\\,x^{(2)}_i+b^{(3)}_j",
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
      gate("r", "Reset r_t", "r_t=\\sigma\\big(W_{ir}x_t+W_{hr}h_{t-1}+b_r\\big)", "How much of h<sub>t−1</sub> the candidate n<sub>t</sub> may use."),
      gate("u", "Update u_t", "u_t=\\sigma\\big(W_{iu}x_t+W_{hu}h_{t-1}+b_u\\big)",
        "How much of h<sub>t−1</sub> to keep. (PyTorch names this gate z; it is u here so it does not clash with the stochastic state z<sub>t</sub>.)"),
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
      { chip: "Prior hidden", tex: "x^{p}=\\mathrm{SiLU}\\big(\\mathrm{LN}(W^{p}_1h_t+b^{p}_1)\\big)",
        items: linearItems(p0, "W^p_1", V(h, "h_t", "signed", "i"), "b^p_1", "y", "x^p"),
        body: "The prior guesses z<sub>t</sub> from h<sub>t</sub> alone, without the observation." },
      { chip: "Prior ẑ_t", tex: "p(\\hat z_t\\mid h_t)=\\mathrm{softmax}_{16}\\big(W^{p}_2x^{p}+b^{p}_2\\big)" + (real ? "" : ",\\quad z_t=\\arg\\max"),
        items: [M(p1.W, "W^p_2", "g", "i"), op("·"), V(p1.input, "x^p", "signed", "i"), fn("+ b, softmax"), G16(pr.probs, "p(ẑ_t)"),
          ...(real ? [] : [fn("argmax"), G16(pr.z, "z_t", "onehot")])],
        body: real ? "16 groups × 16 classes; softmax within each group, mixed with 1% uniform." : "While imagining, the prior's most likely class in each group becomes z<sub>t</sub>.",
        note: w.prior ? check(maxDiff(pr.probs, w.prior)) : "" },
    ];
    if (real) {
      const e = w.e || x.encoder(s.obs)[2].pre, po = x.posterior(h, e), q0 = po.steps[0], q1 = po.steps[1];
      steps.push(
        { chip: "Posterior hidden", tex: "x^{q}=\\mathrm{SiLU}\\big(\\mathrm{LN}(W^{q}_1[h_t;\\,e_t]+b^{q}_1)\\big)",
          items: linearItems(q0, "W^q_1", V(q0.input, "[h_t; e_t]", "signed", "i", { names: (i) => (i < 256 ? `h_t #${i + 1}` : `e_t #${i - 255}`) }), "b^q_1", "y", "x^q"),
          body: "The posterior also sees the observation, through e<sub>t</sub>." },
        { chip: "Posterior z_t", tex: "q(z_t\\mid h_t,e_t)=\\mathrm{softmax}_{16}\\big(W^{q}_2x^{q}+b^{q}_2\\big),\\quad z_t=\\arg\\max",
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
  return { title: "Outputs", sub: `${s.label} · decoder 207,396 + reward 263,679 parameters`, steps: [
    { chip: "Decoder 1", tex: "x^{(1)}=\\mathrm{SiLU}\\big(\\mathrm{LN}(W^{(1)}[h_t;\\,z_t]+b^{(1)})\\big)",
      items: linearItems(d0, "W^{(1)}", hz, "b^{(1)}", "y^{(1)}", "x^{(1)}"), body: "The decoder turns the model state (h<sub>t</sub>, z<sub>t</sub>) back into an observation." },
    { chip: "Decoder 2", tex: "x^{(2)}=\\mathrm{SiLU}\\big(\\mathrm{LN}(W^{(2)}x^{(1)}+b^{(2)})\\big)",
      items: linearItems(d1, "W^{(2)}", V(d1.input, "x^{(1)}", "signed", "i"), "b^{(2)}", "y^{(2)}", "x^{(2)}"), body: "Second hidden layer." },
    { chip: "ô_t", tex: "\\hat o_{t,j}=\\mathrm{clip}_{[0,1]}\\Big(\\sum_{i=1}^{256}W^{(3)}_{ji}\\,x^{(2)}_i+b^{(3)}_j\\Big)",
      items: [M(d2.W, "W^{(3)}"), op("·"), V(d2.input, "x^{(2)}", "signed", "i"), op("+"), V(d2.b.data, "b^{(3)}", "signed", "j"), op("="),
        V(dec.recon, "ô_t", "obs", "j", { names: OBS_NAME }), ...(real ? [op("vs"), V(s.obs, "o_t", "obs", "j", { names: OBS_NAME })] : [])],
      body: real ? `In real play ô<sub>t</sub> is only displayed; compare it with the real o<sub>t</sub>.` : "ô<sub>t</sub> stands in for o<sub>t</sub>: the brain's sensory neurons get it at the next imagined step.",
      note: real ? check(maxDiff(dec.recon, w.recon)) : "" },
    { chip: "Reward r̂_t", tex: "\\hat r_t=\\mathrm{symexp}\\Big(\\sum_{k=1}^{255}\\mathrm{softmax}(\\ell)_k\\,b_k\\Big),\\quad \\ell=W^{r}_3x^{r}+b^{r}_3",
      items: [M(r2.W, "W^r_3"), op("·"), V(r2.input, "x^r", "signed", "i"), fn("+ b, softmax"),
        V(rw.probs, "p", "unit", "j", { names: (k) => `bin ${k + 1} (symlog reward ${x.bins[k].toFixed(2)})` }), fn("symexp(Σ p_k b_k)"), num(f2(rw.value), "r̂_t")],
      body: `x<sup>r</sup> comes from two hidden layers shaped like the decoder's. Continue ĉ<sub>t</sub> = ${Math.round((w.cont ?? 1) * 100)}%, value v<sub>t</sub> = ${f2(w.value ?? 0)} (critic).`,
      note: w.reward != null ? check(Math.abs(rw.value - w.reward)) : "" },
  ] };
}

function brainLayer(s) {
  const io = s.io, sim = init.sim, r = s.rates, real = mode === "real", oLab = real ? "o_t" : "ô_t";
  const groupsFor = brSel === "sens" ? groups.sens : brSel === "mid" ? groups.mid : groups.dn;
  const gridStep = { chip: "Firing by group", tex: "\\rho_i=\\tanh\\big(\\max(v_i,0)\\big)", grid: groupsFor,
    body: "Each square is one neuron, sorted by firing rate within its group (darker = higher ρ)." };
  if (!io || !sim) return { title: brSel, sub: s.label, steps: [gridStep] };
  if (brSel === "sens") {
    const D = groups.disp, n = D.sensOrder.length;
    const I = Float32Array.from(D.sensOrder, (id) => io.I[D.inRow.get(id)]), rho = Float32Array.from(D.sensOrder, (id) => r[id] / 255);
    return { title: "Sensory neurons · 580", sub: `${s.label} · input: ${real ? "real observation o<sub>t</sub>" : "reconstruction ô<sub>t</sub>"}`, steps: [
      { chip: "Adaptation s_t", tex: "s_t=\\max\\big(0,\\;o_t+8\\,m\\odot(o_t-c_{t-1})\\big),\\qquad c_t=c_{t-1}+0.3\\,(o_t-c_{t-1})",
        items: [V(s.obs, oLab, "obs", "i", { names: OBS_NAME }), op("−"), V(io.c, "c_{t-1}", "obs", "i", { names: OBS_NAME }), fn("×8m, +" + oLab + ", max(0, ·)"), V(io.s, "s_t", "obs", "i", { names: OBS_NAME })],
        body: "m = 1 only on the 4 odor channels, so smell responds to change like real olfactory receptor neurons; c is the recent average." },
      { chip: "Input I_t", tex: "I_{t,k}=\\sum_{j=1}^{36}\\mathrm{softplus}(U_{kj})\\,M_{kj}\\,s_{t,j}",
        items: [M(D.U, "softplus(U)⊙M", "k", "i"), op("·"), V(io.s, "s_t", "obs", "i", { names: OBS_NAME }), op("="),
          V(I, "I_t", "signed", "k", { names: D.sensName }), fn("dynamics"), V(rho, "ρ_t", "unit", "k", { names: D.sensName })],
        body: "M lets each sense reach only neurons of its own type and side (5,290 learned weights). I<sub>t</sub> then drives v (see Middle)." },
      gridStep,
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
      gridStep,
    ] };
  }
  // 하행뉴런 → 행동
  const ro = init.readout, nR = ro.neurons.length, rho = Float32Array.from(ro.neurons, (id) => r[id] / 255);
  const y = Float32Array.from(io.y), a = y.map(Math.tanh);
  const rows = ro.neurons.map((id, j) => [rho[j], j]).sort((p, q) => q[0] - p[0]).slice(0, 5).map(([rate, j]) => {
    const id = ro.neurons[j];
    return `<tr><td>${init.cell_type[id] || "DN"} ${init.side[id] === "left" ? "L" : init.side[id] === "right" ? "R" : ""}</td><td>${rate.toFixed(2)}</td>${[0, 1, 2].map((k) => `<td>${f2(ro.w[k * nR + j] * rate)}</td>`).join("")}</tr>`;
  });
  return { title: "Descending neurons · 1,276", sub: `${s.label} · brain → action a<sub>t</sub>`, steps: [
    { chip: "Readout a_t", tex: "y=B\\,\\rho_{\\mathrm{DN}}+d,\\qquad a_t=\\tanh(y)",
      items: [M(groups.disp.B, "B", "a", "n"), op("·"), V(rho, "ρ_{DN}", "unit", "n", { names: groups.disp.dnName }), op("+"),
        V(Float32Array.from(ro.b), "d", "signed", "a", { names: ACT_NAME }), op("="), V(y, "y", "signed", "a", { names: ACT_NAME }), fn("tanh"),
        V(a, "a_t", "act", "a", { names: ACT_NAME })],
      body: `a<sub>t</sub>: ${actText(a)}.`,
      note: "B (3 × 1,276) is learned. It stands in for the nerve cord and body, which the FlyWire brain map does not include." },
    { chip: "Most active DNs", tex: "\\text{contribution}_{n,k}=\\rho_n\\,B_{kn}", body: `<div class="xd-scroll"><table class="xd-table"><thead><tr><th>Most active DN</th><th>ρ</th><th>forward</th><th>turn</th><th>jump</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
      note: "Contribution = ρ × readout weight. DNp01 is the Giant Fiber, which triggers the escape jump in real flies." },
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

const PANELS = {
  wm: { head: "wml-head", steps: "wml-steps", tex: "wml-tex", cv: "wml-canvas", hov: "wml-hov", body: "wml-body", detail: "wm-detail" },
  br: { head: "brl-head", steps: "brl-steps", tex: "brl-tex", cv: "brl-canvas", hov: "brl-hov", body: "brl-body", detail: "brain-detail" },
};
function renderSteps(which, key, layer) {
  const P = PANELS[which], k = Math.min(stepSel[key], layer.steps.length - 1), st = layer.steps[k];
  setHTML($(P.head), head(plain(layer.title), layer.sub));
  const chips = layer.steps.length > 1 ? layer.steps.map((x, i) => `<button data-k="${i}"${i === k ? ' class="on"' : ""}>${i + 1} · ${plain(x.chip)}</button>`).join("") : "";
  if ($(P.steps).dataset.html !== chips) { $(P.steps).innerHTML = chips; $(P.steps).dataset.html = chips; }
  setTex($(P.tex), st.tex);
  setHTML($(P.body), para(st.body || "", st.note || ""));
  const cv = $(P.cv), ids = [P.head, P.steps, P.tex, P.hov, P.body];
  cv.hidden = !(st.items || st.grid);
  if (st.items) {
    tighten(P.detail, ids, 130);
    cv._hit = null;
    drawCompute(cv, { items: st.items }, room(P.detail, ids));
  } else if (st.grid) {
    tighten(P.detail, ids, st.grid.length * 19 + 4);
    cv._placed = null; cv._hover = null;
    drawLayer(cv, st.grid.map((g) => ({ name: g.name, color: g.color, cnt: g.idx.length, v: sortedRates(lastRates, g.idx) })),
              brSel === "mid" ? 3 : brSel === "sens" ? 7 : 6, room(P.detail, ids));
  }
}
let lastRates = null;

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
  if (brSel === "brainmap" || brSel === "action") return;
  lastRates = s.rates;
  renderSteps("br", brSel, brainLayer(s));
}

// ---------- 캔버스 ----------
function sizeCanvas(cv, H) {
  const Wd = Math.max(280, cv.clientWidth || cv.parentElement.clientWidth || 600), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(Wd * dpr);
  cv.height = Math.round(H * dpr);
  cv.style.height = `${H}px`;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, Wd, H);
  return [ctx, Wd];
}

// 뉴런 묶음 격자. 칸 크기 c를 cPref에서 줄여 가며 maxH 안에 들어가는 가장 큰 크기로 그린다
function drawLayer(cv, lay, cPref, maxH) {
  const Wd = Math.max(280, cv.clientWidth || cv.parentElement.clientWidth || 600), LW = 200, gap = 4, minH = 15;
  let c = cPref, cols, items, H;
  const layout = (c) => {
    const cols = Math.max(10, Math.floor((Wd - LW) / c));
    let y = 2;
    const items = lay.map((o) => { const h = Math.max(Math.ceil(o.cnt / cols) * c, minH), it = { ...o, y, h }; y += h + gap; return it; });
    return [cols, items, y];
  };
  for (; ; c -= 0.5) {
    [cols, items, H] = layout(c);
    if (H <= maxH || c <= 1.5) break;
  }
  const [ctx] = sizeCanvas(cv, Math.min(H, Math.max(maxH, 30)));
  for (const o of items) {
    ctx.fillStyle = INK; ctx.font = "11.5px Segoe UI"; ctx.textAlign = "left"; ctx.fillText(o.name, 0, o.y + 11);
    ctx.fillStyle = SUB; ctx.font = "11px Segoe UI"; ctx.textAlign = "right";
    ctx.fillText(`${active(o.v).toLocaleString()} / ${o.cnt.toLocaleString()}`, LW - 10, o.y + 11);
    for (let i = 0; i < o.cnt; i++) {
      ctx.fillStyle = o.color ? shade(o.color, o.v[i]) : seq(o.v[i]);   // 감각 뉴런은 그 감각의 색, 나머지는 회색 농도
      ctx.fillRect(LW + (i % cols) * c, o.y + Math.floor(i / cols) * c, c > 3 ? c - 0.6 : c, c > 3 ? c - 0.6 : c);
    }
  }
  cv._hit = (x, yy) => {
    const o = items.find((o) => yy >= o.y && yy < o.y + o.h);
    if (!o || x < LW) return "";
    const i = Math.floor((yy - o.y) / c) * cols + Math.floor((x - LW) / c);
    return i < o.cnt ? `${o.name} · rate ${o.v[i].toFixed(2)} (rank ${i + 1} in this group, firing ${active(o.v)} / ${o.cnt})` : "";
  };
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
  } else if (cv._hit) out.textContent = cv._hit(px, py) || "";
}
function unhover(e) {
  const cv = e.currentTarget;
  if (cv._placed && cv._hover) { cv._hover = null; drawCompute(cv, cv._spec, cv._maxH); }
}
