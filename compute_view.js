// 층 계산 그림: "W · x + b = y → 활성화 → x'"처럼 행렬·벡터·연산 기호를 가로로 늘어놓고 실제 값을 칠한다.
// 벡터는 세로 띠(칸 하나 = 값 하나, 길이는 차원에 비례), 행렬은 행 = 출력, 열 = 입력인 판.
// 마우스를 올린 칸과 같은 첨자(j 또는 i)를 쓰는 다른 벡터·행렬의 행/열도 함께 표시한다.
//
// spec.items 종류
//   { t: "vec",  v, label, kind, space }       kind: signed | unit | obs | act | onehot
//   { t: "grid", v, label, kind, space }       256개 값을 16×16 (범주 16그룹 × 16칸)으로
//   { t: "mat",  m, label, rowSpace, colSpace } m: { data, rows, cols, hue? } 또는 { img, rows, cols, hit }
//   { t: "op",   s }                           연산 기호 (·, +, =, ⊙, −)
//   { t: "fn",   s }                           활성화 등: 위에 글자를 쓴 화살표
//   { t: "num",  text, label }                 값 하나
// hue: 값이 한 감각에 속할 때(감각 입력 세기 등) 칸마다 그 감각 색을 돌려주는 함수. vec은 it.hue(i), mat은 m.hue(row, col).
//      주면 0 = 옅은 회색, 클수록 그 색으로 진하게 칠한다 (양수 값만)
// cells: vec 칸 높이를 고르지 않게 그린다 { big: [크게 그릴 칸], gapsBefore: [앞에 간격을 둘 칸] }.
//        관측 36칸에서 냄새 4칸을 키우고 먹이 / CO₂ / 왼눈 / 오른눈 사이를 띄우는 데 쓴다. 같은 화면의 관측 벡터는 모두 같은 cells를 줘야 줄이 맞는다
// segs: vec 왼쪽에 칸 구간 이름을 붙인다 [{ from, to, label, c }]. 한 칸짜리는 칸 옆에, 긴 구간은 괄호 선 옆에 쓴다
import { PAL, PALE, rgb, shade } from "./palette.js";

const INK = rgb(PAL.real), SUB = "#646b7a", EDGE = "#cfd4dc", HI = rgb(PAL.real);
const FRAME = "#7d8492", FRAME_W = 1.5;            // 행렬·벡터 테두리
const NAME_SIZE = 13, OP_INK = "#2b303b";          // 위 이름 글자, 계산 기호 색
const LIGHT = [250, 250, 251];
const signedCol = (v) => shade(PAL.real, 0.5 + 0.46 * Math.max(-1, Math.min(1, v || 0)), LIGHT);   // −1 밝음 … +1 진함
const unitCol = (v) => shade(PAL.real, 0.92 * Math.max(0, Math.min(1, v || 0)));
const SENSE = (i) => (i < 2 ? PAL.food : i < 4 ? PAL.co2 : PAL.pred);
const ACT = (i) => (i < 2 ? PAL.action : PAL.jump);

// ---------- 글자: h_t, W^{(1)}, h_{t−1} 같은 아래·위 첨자 ----------
export function parse(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if ((c === "_" || c === "^") && i + 1 < s.length) {
      let t;
      if (s[i + 1] === "{") { const j = s.indexOf("}", i + 2); t = s.slice(i + 2, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; }
      else { t = s[i + 1]; i += 2; }
      out.push({ t, mode: c === "_" ? "sub" : "sup" });
    } else {
      let j = i;
      while (j < s.length && s[j] !== "_" && s[j] !== "^") j++;
      out.push({ t: s.slice(i, j), mode: "base" });
      i = j;
    }
  }
  return out;
}
function measure(ctx, s, size, weight = "") {
  let w = 0;
  for (const p of parse(s)) { ctx.font = `${weight ? weight + " " : ""}${p.mode === "base" ? size : size * 0.72}px Segoe UI`; w += ctx.measureText(p.t).width; }
  return w;
}
// 수식 글자 (가운데 정렬)
export function label(ctx, x, y, s, { size = 11.5, color = INK, align = "center", italic = false, weight = "" } = {}) {
  const w = measure(ctx, s, size);
  let cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  for (const p of parse(s)) {
    const sz = p.mode === "base" ? size : size * 0.72;
    ctx.font = `${weight ? weight + " " : ""}${italic && p.mode === "base" ? "italic " : ""}${sz}px Segoe UI`;
    ctx.fillText(p.t, cx, y + (p.mode === "sub" ? size * 0.28 : p.mode === "sup" ? -size * 0.4 : 0));
    cx += ctx.measureText(p.t).width;
  }
  return w;
}

// ---------- 행렬 그림 (한 번만 만들어 둠) ----------
const matCache = new WeakMap();
function robustScale(data) {
  const n = data.length, step = Math.max(1, Math.floor(n / 4000)), s = [];
  for (let i = 0; i < n; i += step) s.push(Math.abs(data[i]));
  s.sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.98)] || 1;
}
export function matrixImage(m) {
  if (m.img) return m.img;
  let c = matCache.get(m.data);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = m.cols; c.height = m.rows;
  const g = c.getContext("2d"), img = g.createImageData(m.cols, m.rows), sc = robustScale(m.data);
  for (let k = 0; k < m.rows * m.cols; k++) {
    if (m.hue) {
      // 감각 색: 0 = 옅은 회색, 클수록 그 칸 감각의 색
      const t = Math.max(0, Math.min(1, m.data[k] / sc)), col = t > 0 ? m.hue(Math.floor(k / m.cols), k % m.cols) : PALE;
      for (let ch = 0; ch < 3; ch++) img.data[4 * k + ch] = Math.round(PALE[ch] + (col[ch] - PALE[ch]) * t);
    } else {
      const t = 0.5 + 0.46 * Math.max(-1, Math.min(1, m.data[k] / sc));
      for (let ch = 0; ch < 3; ch++) img.data[4 * k + ch] = Math.round(LIGHT[ch] + (PAL.real[ch] - LIGHT[ch]) * t);
    }
    img.data[4 * k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  c._scale = sc;
  matCache.set(m.data, c);
  return c;
}

// ---------- 배치 ----------
const isSmall = (n) => n <= 8;
const measureCtx = document.createElement("canvas").getContext("2d");
// opt.vecBrace: 벡터 길이를 오른쪽 중괄호로(true) / 아래 숫자로(false). opt.compact: 칸 상자를 작은 글자·좁은 칸으로
function layout(items, W, Hm, opt = {}) {
  const vecBrace = opt.vecBrace !== false, compact = !!opt.compact;
  const maxDim = Math.max(8, ...items.flatMap((it) =>
    it.t === "vec" ? [isSmall(it.v.length) ? 0 : it.v.length] : it.t === "mat" ? [isSmall(it.m.rows) ? 0 : it.m.rows, isSmall(it.m.cols) ? 0 : it.m.cols] : [0]));
  const k = Hm / maxDim, cell = Math.min(24, Hm / 6);   // 숫자 칸 높이: 자리가 있으면 24까지
  const len = (n) => (isSmall(n) ? n * cell : Math.min(Hm, Math.max(n * k, Math.min(n * 2.4, Hm * 0.55))));
  const ctx = measureCtx;
  const boxes = items.map((it) => {
    // 칸 상자(sym): 벡터는 [처음 2개, ⋮, 마지막] 4칸, 행렬은 같은 방식의 4×4 칸
    if (it.sym && (it.t === "vec" || it.t === "mat")) {
      const cw = symCellW(ctx, compact);
      return { w: it.t === "vec" ? cw : symColW(it.m.cols, cw, compact).reduce((a, b) => a + b, 0), h: symIdx(it.t === "vec" ? it.v.length : it.m.rows).length * cell };
    }
    if (it.t === "vec") { const n = it.v.length; return { w: isSmall(n) ? 40 : 12, h: it.cells ? Math.min(Hm, Math.max(len(n), 130)) : len(n) }; }
    if (it.t === "grid") { const s = Math.min(Hm, 112); return { w: s, h: s }; }
    if (it.t === "mat") {
      const h = len(it.m.rows);
      const w = it.m.rows === it.m.cols ? h : Math.max(isSmall(it.m.cols) ? it.m.cols * cell : 16, Math.min(Hm, len(it.m.cols)));
      return { w, h };
    }
    if (it.t === "op") { ctx.font = "600 13px Segoe UI"; return { w: it.s.length > 1 ? ctx.measureText(it.s).width + 10 : 20, h: 0 }; }
    if (it.t === "fn") return { w: Math.max(38, measure(ctx, it.s, 11.5) + 14), h: 0 };
    if (it.t === "num") { ctx.font = "13px Segoe UI"; return { w: Math.max(44, ctx.measureText(it.text).width + 14), h: 26 }; }
    return { w: 0, h: 0 };
  });
  // 위 이름, 왼쪽 구간 이름, 차원 중괄호가 들어갈 자리를 둔다
  boxes.forEach((b, i) => {
    const it = items[i];
    if (it.label) b.lw = measure(ctx, it.label, NAME_SIZE, "600");
    if (it.segs) b.padL = 16 + Math.max(...it.segs.map((s) => measure(ctx, s.label, SEG_FONT)));   // 왼쪽 구간 이름 자리
    b.dims = dimsOf(it, vecBrace);
    if (b.dims.left != null) b.padL = (b.padL || 0) + dimPad(ctx, b.dims.left);
    if (b.dims.right != null) b.padR = dimPad(ctx, b.dims.right);
    b.slot = Math.max(b.w, (b.lw || 0) * 0.9) + (b.padL || 0) + (b.padR || 0);
    if (b.dims.below != null) b.slot = Math.max(b.slot, dimPad(ctx, b.dims.below) - 2 * BR - 5);   // 아래 숫자가 벡터보다 넓을 때
  });
  const total = boxes.reduce((s, b) => s + b.slot, 0) + 6 * (items.length - 1);
  return { boxes, total, k };
}
// 차원 표시: 행렬은 왼쪽 중괄호(행 수)와 아래 중괄호(열 수), 벡터는 오른쪽 중괄호(길이).
// 폭이 모자란 화면에서는 벡터 길이를 중괄호 대신 벡터 바로 아래 숫자로 쓴다 (vecBrace = false, drawCompute가 고름)
const DIM_FONT = 9.5, BR = 3;
const dimText = (n) => (n >= 10000 && n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString());   // 15000 → 15k (자리 절약)
function dimsOf(it, vecBrace) {
  if (it.t === "mat") return { left: it.m.rows, bottom: it.m.cols };
  if (it.t === "vec" && !isSmall(it.v.length)) return vecBrace ? { right: it.v.length } : { below: it.v.length };
  return {};
}
function dimPad(ctx, n) {
  ctx.font = `${DIM_FONT}px Segoe UI`;
  return 2 * BR + 7 + ctx.measureText(dimText(n)).width;
}

// ---------- 그리기 ----------
// cv: 캔버스, spec: { items }, maxH: 쓸 수 있는 높이. 마우스 위치의 강조는 cv._hover에 담긴다
export function drawCompute(cv, spec, maxH) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(280, cv.clientWidth || cv.parentElement.clientWidth || 600);
  const Hm0 = Math.max(40, Math.min(190, maxH - 46));   // 46 = 위아래 글자 자리 (아래 H 참고)
  // 폭이 넘치면 높이(=크기)를 줄인다. 중괄호·이름·칸 상자 폭은 높이와 상관없이 고정이라 이분 탐색으로 맞는 높이를 찾는다
  const fit = (opt) => {
    const room = W - 14;   // 양옆 7px 여유
    let L = layout(spec.items, W, Hm0, opt);
    if (L.total <= room) return { Hm: Hm0, L, opt, fits: true };
    let lo = 30, hi = Hm0;
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (layout(spec.items, W, m, opt).total > room) hi = m; else lo = m; }
    L = layout(spec.items, W, lo, opt);
    return { Hm: lo, L, opt, fits: L.total <= room };
  };
  // 차례로: 벡터 중괄호 → 벡터 길이를 아래 숫자로 → 칸 상자를 작게. 그림이 충분히 큰(원래의 80%, 적어도 90) 첫 방식을 쓴다.
  // 모두 안 되면 작은 방식 그대로 전체를 비율로 줄여 그린다 (글자도 함께 작아짐)
  const want = Math.min(Hm0, Math.max(90, Hm0 * 0.8));
  let best = null;
  for (const opt of [{ vecBrace: true }, { vecBrace: false }, { vecBrace: false, compact: true }]) {
    const f = fit(opt);
    if (f.fits && f.Hm >= want) { best = f; break; }
  }
  let s = 1;
  if (!best) {
    const opt = { vecBrace: false, compact: true }, Hb = Math.min(Hm0, 110), L = layout(spec.items, W, Hb, opt);
    s = Math.min(1, (W - 14) / L.total);
    best = { Hm: Hb, L, opt };
  }
  // 캔버스 높이는 실제 그림 높이(가장 큰 상자)에 맞춘다. 위 22: 굵은 이름(위첨자 포함), 아래 24: 행렬 아래 중괄호와 열 수
  const L = best.L, Hc = Math.max(26, ...L.boxes.map((b) => b.h)), H = Hc + 46, top = 22, mid = top + Hc / 2;
  // 자리가 남으면(가로·세로 모두) 그림 전체를 비율로 키운다. 최대 1.5배
  if (s === 1) s = Math.max(1, Math.min(1.5, (W - 14) / L.total, maxH / H));   // 양옆 7px 여유 (두꺼운 테두리가 끝에 닿지 않게)
  const Wl = W / s;   // Wl: 비율로 그릴 때의 논리 폭
  // 크기가 같으면 캔버스를 다시 만들지 않는다
  const cw = Math.round(W * dpr), ch = Math.round(H * s * dpr);
  if (cv.width !== cw) cv.width = cw;
  if (cv.height !== ch) cv.height = ch;
  if (cv.style.height !== `${H * s}px`) cv.style.height = `${H * s}px`;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
  ctx.clearRect(0, 0, Wl, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const hv = cv._hover || null;
  const placed = [];
  let x = Math.max(0, (Wl - L.total) / 2);
  spec.items.forEach((it, idx) => {
    const b = L.boxes[idx], pl = b.padL || 0, pr = b.padR || 0, bx = x + pl + (b.slot - pl - pr - b.w) / 2, by = mid - b.h / 2;
    const p = { it, x: bx, y: by, w: b.w, h: b.h, compact: !!best.opt.compact };
    if (it.t === "vec" && it.cells) p.rows = cellRows(it.v.length, b.h, it.cells).map(([a, c]) => [by + a, by + c]);
    placed.push(p);
    if (it.segs) drawSegs(ctx, p);
    if (it.sym && (it.t === "vec" || it.t === "mat")) drawSym(ctx, p, hv);
    else if (it.t === "vec") drawVec(ctx, p, hv);
    else if (it.t === "grid") drawGrid(ctx, p, hv);
    else if (it.t === "mat") drawMat(ctx, p, hv);
    else if (it.t === "op") drawOp(ctx, it.s, bx + b.w / 2, mid);
    else if (it.t === "fn") {
      ctx.strokeStyle = OP_INK; ctx.lineWidth = 1.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(bx + 3, mid); ctx.lineTo(bx + b.w - 4, mid); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + b.w - 9, mid - 4.5); ctx.lineTo(bx + b.w - 3, mid); ctx.lineTo(bx + b.w - 9, mid + 4.5); ctx.stroke();
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      label(ctx, bx + b.w / 2, mid - 7, it.s, { size: 11.5, color: OP_INK });
    } else if (it.t === "num") {
      ctx.strokeStyle = FRAME; ctx.lineWidth = FRAME_W; ctx.strokeRect(bx + 0.5, by + 0.5, b.w - 1, b.h - 1);
      ctx.fillStyle = INK; ctx.font = "600 13px Segoe UI"; ctx.textAlign = "center"; ctx.fillText(it.text, bx + b.w / 2, mid + 4.5);
    }
    if (it.label) label(ctx, bx + b.w / 2, by - 6, it.label, { size: NAME_SIZE, weight: "600" });
    drawDims(ctx, p, b.dims);
    x += b.slot + 6;
  });
  cv._placed = placed;
  cv._scale = s;
  cv._spec = spec;
  cv._maxH = maxH;
}

// 계산 기호: ·는 채운 원, +, =, −, ⊙ 등은 굵은 큰 글자, vs 같은 글자는 굵은 작은 글자
function drawOp(ctx, s, cx, cy) {
  ctx.fillStyle = OP_INK;
  if (s === "·") { ctx.beginPath(); ctx.arc(cx, cy, 2.8, 0, 2 * Math.PI); ctx.fill(); return; }
  ctx.textAlign = "center";
  if (s.length > 1) { ctx.font = "600 13px Segoe UI"; ctx.fillText(s, cx, cy + 4.5); return; }
  ctx.font = "600 21px Segoe UI";
  ctx.fillText(s, cx, cy + 7);
}
// 벡터 값 → 칸 색
function cellColor(it, i, v, sc) {
  if (it.hue) return shade(it.hue(i), Math.max(0, v) / sc);
  if (it.kind === "obs") return shade(SENSE(i), v);
  if (it.kind === "act") return shade(ACT(i), Math.abs(v));
  if (it.kind === "unit" || it.kind === "onehot") return unitCol(v);
  return signedCol(v / sc);
}
function vecScale(v) {
  let m = 0;
  for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i]));
  return m || 1;
}
// cells가 있을 때 칸마다 [위, 아래] (벡터 위쪽 기준). 큰 칸은 작은 칸의 4배, 단 글자가 들어가게 최소 MIN_BIG
const GAP = 5, MIN_BIG = 12;
function cellRows(n, h, cells) {
  const big = new Set(cells.big || []), gaps = new Set(cells.gapsBefore || []);
  const nb = big.size, ns = n - nb, G = gaps.size * GAP;
  let e = (h - G) / (4 * nb + ns), o = Math.max(4 * e, MIN_BIG);
  e = (h - G - nb * o) / ns;
  if (e < 0.6) { e = 0.6; o = (h - G - ns * e) / nb; }
  const rows = [];
  let y = 0;
  for (let i = 0; i < n; i++) {
    if (gaps.has(i)) y += GAP;
    const ch = big.has(i) ? o : e;
    rows.push([y, y + ch]);
    y += ch;
  }
  return rows;
}
function drawVec(ctx, p, hv) {
  const { it, x, y, w, h } = p, v = it.v, n = v.length, sc = it.scale || vecScale(v);
  if (p.rows) {
    // 고르지 않은 칸: 칸마다 칠하고, 간격으로 나뉜 묶음마다 테두리
    const gaps = new Set(it.cells.gapsBefore || []);
    let start = 0;
    for (let i = 0; i < n; i++) {
      const [a, b] = p.rows[i];
      ctx.fillStyle = cellColor(it, i, v[i], sc);
      ctx.fillRect(x, a, w, Math.max(b - a - (b - a > 3 ? 0.6 : 0), 0.8));
      if (i === n - 1 || gaps.has(i + 1)) {
        ctx.strokeStyle = FRAME; ctx.lineWidth = FRAME_W;
        ctx.strokeRect(x - 0.5, p.rows[start][0] - 0.5, w + 1, b - p.rows[start][0] + 1);
        start = i + 1;
      }
    }
    if (hv && it.space && hv.space === it.space && hv.idx < n) {
      const [a, b] = p.rows[hv.idx];
      outline(ctx, x - 1.5, a - 1, w + 3, Math.max(2, b - a) + 2);
    }
    return;
  }
  if (n <= h) {
    const ch = h / n;
    for (let i = 0; i < n; i++) { ctx.fillStyle = cellColor(it, i, v[i], sc); ctx.fillRect(x, y + i * ch, w, Math.max(ch - (ch > 3 ? 0.6 : 0), 0.8)); }
    if (isSmall(n)) {
      ctx.font = "10.5px Segoe UI"; ctx.textAlign = "center";
      for (let i = 0; i < n; i++) {
        const t = Math.abs(it.kind === "act" ? v[i] : v[i] / sc);
        ctx.fillStyle = t > 0.55 ? "#fff" : INK;
        ctx.fillText((v[i] < 0 ? "−" : "") + Math.abs(v[i]).toFixed(2), x + w / 2, y + (i + 0.5) * ch + 3.5);
      }
    }
  } else {
    // 값이 픽셀보다 많으면 한 줄에 여러 값의 평균
    const rows = Math.ceil(h);
    for (let r = 0; r < rows; r++) {
      const a = Math.floor((r * n) / rows), b = Math.max(a + 1, Math.floor(((r + 1) * n) / rows));
      let s = 0;
      for (let i = a; i < b; i++) s += v[i];
      ctx.fillStyle = cellColor(it, a, s / (b - a), sc);
      ctx.fillRect(x, y + (r * h) / rows, w, h / rows + 0.4);
    }
  }
  ctx.strokeStyle = FRAME; ctx.lineWidth = FRAME_W; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  if (hv && it.space && hv.space === it.space && hv.idx < n) outline(ctx, x - 1.5, y + (hv.idx * h) / n - 1, w + 3, Math.max(2, h / n) + 2);
}
// 칸 상자(sym): 수가 너무 많아 무늬로는 뜻이 없는 벡터·행렬을 몇 칸만 숫자로 보여 준다
//   벡터: [첫째, 둘째, ⋮, 마지막] 4칸.  행렬: 행과 열 모두 [첫째, 둘째, ⋮/…, 마지막]인 4×4 칸 (가운데는 ⋱)
//   칸 색은 작은 벡터와 같은 규칙(값 크기 = 회색 농도), 계산 화면을 다시 그릴 때마다(초당 10번) 지금 값으로 바뀐다
const NUM_FONT = 10.5, NUM_FONT_C = 9.5;
const ellW = (compact) => (compact ? 12 : 16);
const fmt2 = (v) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
const symIdx = (n) => (n > 4 ? [0, 1, -1, n - 1] : [...Array(n).keys()]);   // −1 = 줄임표 칸
function symCellW(ctx, compact) {
  ctx.font = `${compact ? NUM_FONT_C : NUM_FONT}px Segoe UI`;
  return compact ? Math.max(30, ctx.measureText("−0.00").width + 6) : Math.max(38, ctx.measureText("−0.00").width + 12);
}
const symColW = (n, cw, compact) => symIdx(n).map((j) => (j < 0 ? ellW(compact) : cw));
const matScale = new WeakMap();
function scaleOfMat(m) {
  let s = matScale.get(m.data);
  if (s == null) { s = robustScale(m.data); matScale.set(m.data, s); }
  return s;
}
function numCell(ctx, it, x, y, w, h, v, sc, i) {
  ctx.fillStyle = it.t === "mat" ? signedCol(v / sc) : cellColor(it, i, v, sc);
  ctx.fillRect(x, y, w - 0.6, h - 0.6);
  const t = it.kind === "unit" ? v : Math.abs(v / sc);
  ctx.fillStyle = t > 0.55 ? "#fff" : INK;
  ctx.textAlign = "center";
  ctx.fillText(fmt2(v), x + w / 2, y + h / 2 + 3.6);
}
function ellCell(ctx, x, y, w, h, s) {
  ctx.fillStyle = SUB; ctx.textAlign = "center";
  ctx.fillText(s, x + w / 2, y + h / 2 + 3.6);
}
function drawSym(ctx, p, hv) {
  const { it, x, y, w, h } = p, font = `${p.compact ? NUM_FONT_C : NUM_FONT}px Segoe UI`;
  ctx.font = font;
  if (it.t === "vec") {
    const rows = symIdx(it.v.length), ch = h / rows.length, sc = it.scale || vecScale(it.v);
    rows.forEach((i, r) => (i < 0 ? ellCell(ctx, x, y + r * ch, w, ch, "⋮") : numCell(ctx, it, x, y + r * ch, w, ch, it.v[i], sc, i)));
    ctx.strokeStyle = FRAME; ctx.lineWidth = FRAME_W; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    if (hv && it.space && hv.space === it.space) { const r = symRow(rows, hv.idx); if (r >= 0) outline(ctx, x - 1.5, y + r * ch - 1, w + 3, ch + 2); }
    return;
  }
  const m = it.m, rows = symIdx(m.rows), cols = symIdx(m.cols), ch = h / rows.length, cws = symColW(m.cols, symCellW(ctx, p.compact), p.compact), sc = scaleOfMat(m);
  ctx.font = font;
  const cx = cws.map((_, c) => x + cws.slice(0, c).reduce((a, b) => a + b, 0));
  rows.forEach((i, r) => cols.forEach((j, c) => {
    const yy = y + r * ch;
    if (i < 0 && j < 0) ellCell(ctx, cx[c], yy, cws[c], ch, "⋱");
    else if (i < 0) ellCell(ctx, cx[c], yy, cws[c], ch, "⋮");
    else if (j < 0) ellCell(ctx, cx[c], yy, cws[c], ch, "…");
    else numCell(ctx, it, cx[c], yy, cws[c], ch, m.data[i * m.cols + j], sc, i);
  }));
  ctx.strokeStyle = FRAME; ctx.lineWidth = FRAME_W; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  if (!hv) return;
  if (it.rowSpace && hv.space === it.rowSpace) { const r = symRow(rows, hv.idx); if (r >= 0) outline(ctx, x - 1.5, y + r * ch - 1, w + 3, ch + 2); }
  if (it.colSpace && hv.space === it.colSpace) { const c = symRow(cols, hv.idx); if (c >= 0) outline(ctx, cx[c] - 1, y - 1.5, cws[c] + 2, h + 3); }
}
// 마우스로 고른 첨자가 보이는 칸이면 그 칸, 가운데(생략된) 첨자면 줄임표 칸
function symRow(idx, k) {
  const r = idx.indexOf(k);
  if (r >= 0) return r;
  const e = idx.indexOf(-1);
  return e >= 0 && k > idx[e - 1] && k < idx[e + 1] ? e : -1;
}
// 차원 중괄호와 숫자
function braceV(ctx, x0, y0, y1, dir) {   // dir +1: 오른쪽으로 뾰족, −1: 왼쪽으로
  const d = Math.min(BR, (y1 - y0) / 4), m = (y0 + y1) / 2, a = x0 + dir * d, t = x0 + dir * 2 * d;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.quadraticCurveTo(a, y0, a, y0 + d); ctx.lineTo(a, m - d);
  ctx.quadraticCurveTo(a, m, t, m); ctx.quadraticCurveTo(a, m, a, m + d);
  ctx.lineTo(a, y1 - d); ctx.quadraticCurveTo(a, y1, x0, y1);
  ctx.stroke();
}
function braceH(ctx, x0, x1, y0) {         // 아래로 뾰족
  const d = Math.min(BR, (x1 - x0) / 4), m = (x0 + x1) / 2, a = y0 + d, t = y0 + 2 * d;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0, a, x0 + d, a); ctx.lineTo(m - d, a);
  ctx.quadraticCurveTo(m, a, m, t); ctx.quadraticCurveTo(m, a, m + d, a);
  ctx.lineTo(x1 - d, a); ctx.quadraticCurveTo(x1, a, x1, y0);
  ctx.stroke();
}
function drawDims(ctx, p, dm) {
  if (!dm) return;
  const { x, y, w, h } = p;
  ctx.strokeStyle = "#9aa1ad"; ctx.lineWidth = 0.9;
  ctx.fillStyle = SUB; ctx.font = `${DIM_FONT}px Segoe UI`;
  if (dm.left != null) {
    braceV(ctx, x - 3, y, y + h, -1);
    ctx.textAlign = "right"; ctx.fillText(dimText(dm.left), x - 3 - 2 * BR - 3, y + h / 2 + 3.5);
  }
  if (dm.right != null) {
    braceV(ctx, x + w + 3, y, y + h, 1);
    ctx.textAlign = "left"; ctx.fillText(dimText(dm.right), x + w + 3 + 2 * BR + 3, y + h / 2 + 3.5);
  }
  if (dm.bottom != null) {
    braceH(ctx, x, x + w, y + h + 3);
    ctx.textAlign = "center"; ctx.fillText(dimText(dm.bottom), x + w / 2, y + h + 3 + 2 * BR + 10);
  }
  if (dm.below != null) { ctx.textAlign = "center"; ctx.fillText(dimText(dm.below), x + w / 2, y + h + 13); }
}
// 벡터 왼쪽 구간 이름: 글자가 겹치지 않게 위에서부터 차례로 내려 놓는다
const SEG_FONT = 10;
function drawSegs(ctx, p) {
  const { it, x, y, h } = p, n = it.v.length, cell = h / n;
  let prev = -Infinity;
  ctx.lineWidth = 0.8;
  for (const s of it.segs) {
    const y0 = p.rows ? p.rows[s.from][0] : y + s.from * cell, y1 = p.rows ? p.rows[s.to][1] : y + (s.to + 1) * cell, m = (y0 + y1) / 2;
    const ly = Math.max(m, prev + SEG_FONT + 1.5);
    prev = ly;
    ctx.strokeStyle = "#9aa1ad";
    ctx.beginPath();
    if (s.to - s.from >= 2) {
      // 긴 구간: 괄호 선
      ctx.moveTo(x - 3, y0 + 1); ctx.lineTo(x - 6, y0 + 1); ctx.lineTo(x - 6, y1 - 1); ctx.lineTo(x - 3, y1 - 1);
      ctx.moveTo(x - 6, m); ctx.lineTo(x - 9, ly);
    } else {
      // 한두 칸: 칸 가운데에서 글자 높이까지 가는 선
      ctx.moveTo(x - 2, m); ctx.lineTo(x - 6, m); ctx.lineTo(x - 10, ly);
    }
    ctx.stroke();
    label(ctx, x - 12, ly + 3.5, s.label, { size: SEG_FONT, color: s.c ? rgb(s.c) : SUB, align: "right" });
  }
}
function drawGrid(ctx, p, hv) {
  const { it, x, y, w } = p, v = it.v, c = w / 16;
  for (let i = 0; i < 256; i++) {
    ctx.fillStyle = it.kind === "signed" ? signedCol((v[i] || 0) / vecScale(v)) : unitCol(v[i]);
    ctx.fillRect(x + (i % 16) * c, y + Math.floor(i / 16) * c, c - 0.5, c - 0.5);
  }
  ctx.strokeStyle = FRAME; ctx.lineWidth = FRAME_W; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, w + 1);
  if (hv && it.space && hv.space === it.space) outline(ctx, x + (hv.idx % 16) * c - 1, y + Math.floor(hv.idx / 16) * c - 1, c + 1.5, c + 1.5);
}
function drawMat(ctx, p, hv) {
  const { it, x, y, w, h } = p, m = it.m;
  ctx.drawImage(matrixImage(m), x, y, w, h);
  ctx.strokeStyle = FRAME; ctx.lineWidth = FRAME_W; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  if (!hv) return;
  if (it.rowSpace && hv.space === it.rowSpace && hv.idx < m.rows) outline(ctx, x - 1.5, y + (hv.idx * h) / m.rows - 1, w + 3, Math.max(2, h / m.rows) + 2);
  if (it.colSpace && hv.space === it.colSpace && hv.idx < m.cols) outline(ctx, x + (hv.idx * w) / m.cols - 1, y - 1.5, Math.max(2, w / m.cols) + 2, h + 3);
}
function outline(ctx, x, y, w, h) {
  ctx.strokeStyle = HI; ctx.lineWidth = 2.4; ctx.strokeRect(x, y, w, h);
}

// ---------- 마우스 ----------
const fmt = (v) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 3);
// 마우스 위치의 칸: { text, space, idx } 또는 null
export function hitCompute(cv, px, py) {
  const s = cv._scale || 1;
  px /= s; py /= s;
  for (const p of cv._placed || []) {
    const { it, x, y, w, h } = p;
    if (it.t === "grid") {
      if (px < x || px >= x + w || py < y || py >= y + w) continue;
      const c = w / 16, idx = Math.floor((py - y) / c) * 16 + Math.floor((px - x) / c);
      return { space: it.space, idx, text: `${plain(it.label)} · group ${Math.floor(idx / 16) + 1}, class ${(idx % 16) + 1} · ${fmt(it.v[idx] || 0)}` };
    }
    if (px < x - 2 || px >= x + w + 2 || py < y || py >= y + h) continue;
    if (it.sym) {
      // 칸 상자: 보이는 칸의 첨자 (줄임표 칸은 강조하지 않음)
      const rows = symIdx(it.t === "vec" ? it.v.length : it.m.rows), r = Math.min(rows.length - 1, Math.floor(((py - y) / h) * rows.length));
      if (it.t === "vec") return rows[r] < 0 ? null : { space: it.space, idx: rows[r], text: "" };
      const cws = symColW(it.m.cols, symCellW(measureCtx, p.compact), p.compact), cols = symIdx(it.m.cols);
      let c = 0, acc = x;
      while (c < cws.length - 1 && px >= acc + cws[c]) acc += cws[c++];
      if (rows[r] >= 0) return { space: it.rowSpace, idx: rows[r], text: "" };
      if (cols[c] >= 0) return { space: it.colSpace, idx: cols[c], text: "" };
      return null;
    }
    if (it.t === "vec") {
      const n = it.v.length;
      let idx = Math.min(n - 1, Math.floor(((py - y) / h) * n));
      if (p.rows) {
        // 고르지 않은 칸: 마우스 높이에 가장 가까운 칸
        let best = Infinity;
        p.rows.forEach(([a, b], i) => { const d = py < a ? a - py : py >= b ? py - b : 0; if (d < best) { best = d; idx = i; } });
      }
      const name = it.names ? it.names(idx) : `#${idx + 1}`;
      return { space: it.space, idx, text: `${plain(it.label)} · ${name} · ${fmt(it.v[idx])}` };
    }
    if (it.t === "mat") {
      const m = it.m, r = Math.min(m.rows - 1, Math.floor(((py - y) / h) * m.rows)), c = Math.min(m.cols - 1, Math.floor(((px - x) / w) * m.cols));
      if (m.hit) return { ...m.hit(r, c), space: it.rowSpace, idx: r };
      // 행과 열 중 가장자리에 가까운 쪽을 강조 (행: 출력 j, 열: 입력 i)
      const nearCol = Math.min(py - y, y + h - py) < Math.min(px - x, x + w - px);
      return { space: nearCol ? it.colSpace : it.rowSpace, idx: nearCol ? c : r,
               text: `${plain(it.label)}[row ${r + 1}, col ${c + 1}] = ${fmt(m.data[r * m.cols + c])} · row = output, column = input` };
    }
  }
  return null;
}
// 마우스 안내 글(HTML): h_{t-1} → h<sub>t-1</sub>
export const plain = (s = "") => s.replace(/_\{([^}]*)\}/g, "<sub>$1</sub>").replace(/\^\{([^}]*)\}/g, "<sup>$1</sup>")
  .replace(/_(.)/g, "<sub>$1</sub>").replace(/\^(.)/g, "<sup>$1</sup>").replace(/t-1/g, "t−1").replace(/t\+1/g, "t+1");
