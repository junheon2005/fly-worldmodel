// 층 계산 그림: "W · x + b = y → 활성화 → x'"처럼 행렬·벡터·연산 기호를 가로로 늘어놓고 실제 값을 칠한다.
// 벡터는 세로 띠(칸 하나 = 값 하나, 길이는 차원에 비례), 행렬은 행 = 출력, 열 = 입력인 판.
// 마우스를 올린 칸과 같은 첨자(j 또는 i)를 쓰는 다른 벡터·행렬의 행/열도 함께 표시한다.
//
// spec.items 종류
//   { t: "vec",  v, label, kind, space }       kind: signed | unit | obs | act | onehot
//   { t: "grid", v, label, kind, space }       256개 값을 16×16 (범주 16그룹 × 16칸)으로
//   { t: "mat",  m, label, rowSpace, colSpace } m: { data, rows, cols } 또는 { img, rows, cols, hit }
//   { t: "op",   s }                           연산 기호 (·, +, =, ⊙, −)
//   { t: "fn",   s }                           활성화 등: 위에 글자를 쓴 화살표
//   { t: "num",  text, label }                 값 하나
import { PAL, rgb, shade } from "./palette.js";

const INK = rgb(PAL.real), SUB = "#646b7a", EDGE = "#cfd4dc", HI = rgb(PAL.real);
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
function measure(ctx, s, size) {
  let w = 0;
  for (const p of parse(s)) { ctx.font = `${p.mode === "base" ? size : size * 0.72}px Segoe UI`; w += ctx.measureText(p.t).width; }
  return w;
}
// 수식 글자 (가운데 정렬)
export function label(ctx, x, y, s, { size = 11.5, color = INK, align = "center", italic = false } = {}) {
  const w = measure(ctx, s, size);
  let cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  for (const p of parse(s)) {
    const sz = p.mode === "base" ? size : size * 0.72;
    ctx.font = `${italic && p.mode === "base" ? "italic " : ""}${sz}px Segoe UI`;
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
    const t = 0.5 + 0.46 * Math.max(-1, Math.min(1, m.data[k] / sc));
    for (let ch = 0; ch < 3; ch++) img.data[4 * k + ch] = Math.round(LIGHT[ch] + (PAL.real[ch] - LIGHT[ch]) * t);
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
function layout(items, W, Hm) {
  const maxDim = Math.max(8, ...items.flatMap((it) =>
    it.t === "vec" ? [isSmall(it.v.length) ? 0 : it.v.length] : it.t === "mat" ? [isSmall(it.m.rows) ? 0 : it.m.rows, isSmall(it.m.cols) ? 0 : it.m.cols] : [0]));
  const k = Hm / maxDim, cell = Math.min(18, Hm / 6);
  const len = (n) => (isSmall(n) ? n * cell : Math.min(Hm, Math.max(n * k, Math.min(n * 2.4, Hm * 0.55))));
  const ctx = measureCtx;
  const boxes = items.map((it) => {
    if (it.t === "vec") { const n = it.v.length; return { w: isSmall(n) ? 40 : 12, h: len(n) }; }
    if (it.t === "grid") { const s = Math.min(Hm, 112); return { w: s, h: s }; }
    if (it.t === "mat") {
      const h = len(it.m.rows);
      const w = it.m.rows === it.m.cols ? h : Math.max(isSmall(it.m.cols) ? it.m.cols * cell : 16, Math.min(Hm, len(it.m.cols)));
      return { w, h };
    }
    if (it.t === "op") return { w: 16, h: 0 };
    if (it.t === "fn") { ctx.font = "10.5px Segoe UI"; return { w: Math.max(34, measure(ctx, it.s, 10.5) + 12), h: 0 }; }
    if (it.t === "num") { ctx.font = "13px Segoe UI"; return { w: Math.max(44, ctx.measureText(it.text).width + 14), h: 26 }; }
    return { w: 0, h: 0 };
  });
  // 위아래 글자(이름·모양)가 상자보다 넓으면 그만큼 자리를 둔다
  boxes.forEach((b, i) => {
    const it = items[i];
    if (it.label) { ctx.font = "11.5px Segoe UI"; b.lw = Math.max(measure(ctx, it.label, 11.5), shapeText(it).length * 5.6); }
    b.slot = Math.max(b.w, (b.lw || 0) * 0.9);
  });
  const total = boxes.reduce((s, b) => s + b.slot, 0) + 6 * (items.length - 1);
  return { boxes, total, k };
}
function shapeText(it) {
  if (it.t === "vec") return `(${it.v.length})`;
  if (it.t === "grid") return "(16×16)";
  if (it.t === "mat") return `(${it.m.rows.toLocaleString()}×${it.m.cols.toLocaleString()})`;
  return "";
}

// ---------- 그리기 ----------
// cv: 캔버스, spec: { items }, maxH: 쓸 수 있는 높이. 마우스 위치의 강조는 cv._hover에 담긴다
export function drawCompute(cv, spec, maxH) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(280, cv.clientWidth || cv.parentElement.clientWidth || 600);
  let Hm = Math.max(40, Math.min(190, maxH - 36));
  let L = layout(spec.items, W, Hm);
  for (let tries = 0; tries < 6 && L.total > W - 4; tries++) {
    Hm = Math.max(36, Hm * Math.max(0.6, (W - 4) / L.total));
    L = layout(spec.items, W, Hm);
  }
  const H = Hm + 36, top = 18, mid = top + Hm / 2;
  // 크기가 같으면 캔버스를 다시 만들지 않는다
  const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
  if (cv.width !== cw) cv.width = cw;
  if (cv.height !== ch) cv.height = ch;
  if (cv.style.height !== `${H}px`) cv.style.height = `${H}px`;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const hv = cv._hover || null;
  const placed = [];
  let x = Math.max(0, (W - L.total) / 2);
  spec.items.forEach((it, idx) => {
    const b = L.boxes[idx], bx = x + (b.slot - b.w) / 2, by = mid - b.h / 2;
    const p = { it, x: bx, y: by, w: b.w, h: b.h };
    placed.push(p);
    if (it.t === "vec") drawVec(ctx, p, hv);
    else if (it.t === "grid") drawGrid(ctx, p, hv);
    else if (it.t === "mat") drawMat(ctx, p, hv);
    else if (it.t === "op") { ctx.fillStyle = INK; ctx.font = "16px Segoe UI"; ctx.textAlign = "center"; ctx.fillText(it.s, bx + b.w / 2, mid + 5); }
    else if (it.t === "fn") {
      ctx.strokeStyle = SUB; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx + 3, mid); ctx.lineTo(bx + b.w - 4, mid); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + b.w - 8, mid - 3.5); ctx.lineTo(bx + b.w - 3, mid); ctx.lineTo(bx + b.w - 8, mid + 3.5); ctx.stroke();
      label(ctx, bx + b.w / 2, mid - 6, it.s, { size: 10.5, color: SUB });
    } else if (it.t === "num") {
      ctx.strokeStyle = EDGE; ctx.strokeRect(bx + 0.5, by + 0.5, b.w - 1, b.h - 1);
      ctx.fillStyle = INK; ctx.font = "600 13px Segoe UI"; ctx.textAlign = "center"; ctx.fillText(it.text, bx + b.w / 2, mid + 4.5);
    }
    if (it.label) label(ctx, bx + b.w / 2, by - 5, it.label, { size: 11.5 });
    const st = shapeText(it);
    if (st) { ctx.fillStyle = SUB; ctx.font = "10px Segoe UI"; ctx.textAlign = "center"; ctx.fillText(st, bx + b.w / 2, by + b.h + 12); }
    x += b.slot + 6;
  });
  cv._placed = placed;
  cv._spec = spec;
  cv._maxH = maxH;
}

// 벡터 값 → 칸 색
function cellColor(it, i, v, sc) {
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
function drawVec(ctx, p, hv) {
  const { it, x, y, w, h } = p, v = it.v, n = v.length, sc = it.scale || vecScale(v);
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
  ctx.strokeStyle = EDGE; ctx.lineWidth = 0.8; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  if (hv && it.space && hv.space === it.space && hv.idx < n) outline(ctx, x - 1.5, y + (hv.idx * h) / n - 1, w + 3, Math.max(2, h / n) + 2);
}
function drawGrid(ctx, p, hv) {
  const { it, x, y, w } = p, v = it.v, c = w / 16;
  for (let i = 0; i < 256; i++) {
    ctx.fillStyle = it.kind === "signed" ? signedCol((v[i] || 0) / vecScale(v)) : unitCol(v[i]);
    ctx.fillRect(x + (i % 16) * c, y + Math.floor(i / 16) * c, c - 0.5, c - 0.5);
  }
  ctx.strokeStyle = EDGE; ctx.lineWidth = 0.8; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, w + 1);
  if (hv && it.space && hv.space === it.space) outline(ctx, x + (hv.idx % 16) * c - 1, y + Math.floor(hv.idx / 16) * c - 1, c + 1.5, c + 1.5);
}
function drawMat(ctx, p, hv) {
  const { it, x, y, w, h } = p, m = it.m;
  ctx.drawImage(matrixImage(m), x, y, w, h);
  ctx.strokeStyle = EDGE; ctx.lineWidth = 0.8; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  if (!hv) return;
  if (it.rowSpace && hv.space === it.rowSpace && hv.idx < m.rows) outline(ctx, x - 1.5, y + (hv.idx * h) / m.rows - 1, w + 3, Math.max(2, h / m.rows) + 2);
  if (it.colSpace && hv.space === it.colSpace && hv.idx < m.cols) outline(ctx, x + (hv.idx * w) / m.cols - 1, y - 1.5, Math.max(2, w / m.cols) + 2, h + 3);
}
function outline(ctx, x, y, w, h) {
  ctx.strokeStyle = HI; ctx.lineWidth = 1.4; ctx.strokeRect(x, y, w, h);
}

// ---------- 마우스 ----------
const fmt = (v) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 3);
// 마우스 위치의 칸: { text, space, idx } 또는 null
export function hitCompute(cv, px, py) {
  for (const p of cv._placed || []) {
    const { it, x, y, w, h } = p;
    if (it.t === "grid") {
      if (px < x || px >= x + w || py < y || py >= y + w) continue;
      const c = w / 16, idx = Math.floor((py - y) / c) * 16 + Math.floor((px - x) / c);
      return { space: it.space, idx, text: `${plain(it.label)} · group ${Math.floor(idx / 16) + 1}, class ${(idx % 16) + 1} · ${fmt(it.v[idx] || 0)}` };
    }
    if (px < x - 2 || px >= x + w + 2 || py < y || py >= y + h) continue;
    if (it.t === "vec") {
      const n = it.v.length, idx = Math.min(n - 1, Math.floor(((py - y) / h) * n));
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
