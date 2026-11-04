// 프레임을 받아 세 패널을 갱신한다.
// 출처는 두 가지: Python 서버(WebSocket, legacy.html) 또는 브라우저 안 시뮬레이션(sim/local_session.js, app.html)
import { createBrainView, GROUP_COLORS, GROUP_LABELS } from "./brain.js";

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

let init = null;
let brain = null;
let ws = null;
let local = null;     // 브라우저 안에서 돌 때의 LocalSession
const history = { reward: [], total: [], h: [], pred: [], real: [], value: [], surprise: [] };
let viewMode = "live";          // 뇌 보기: live(실제) / dream(꿈) / diff(꿈 − 실제)
let picked = null;              // 3D에서 클릭한 뉴런
let clampedNow = new Map();     // 지금 강제로 켜고 끈 뉴런 → 막전위
const STIM = 2.0, SILENCE = -2.0;
let pins = new Map();           // 월드모델 믿음 고정: z 범주 → 칸
let zLayout = null;             // z 격자 칸 크기 (클릭 위치 계산용)
let lastRates = null;           // 마지막 실제 뇌 발화율 (일시정지 중 비교용)
let lastZ = null;               // 마지막 z 확률 (믿음 저장용)
let savedBelief = null;
let lastObs = [];
let lastStep = null;            // 지금 보여 주는 상태 t의 스텝 번호
let recentEye = [];             // 최근 10프레임의 눈 접근 신호 최대값 (저장 시 상황 설명용)         // 저장한 믿음: [[범주, 칸], ...] + 저장 당시 상황
const HISTORY = 300;
let wmMap = null;               // 상태 지도 (PCA): web/data/wm_map.json
const mapTrail = [];            // 최근 상태 지도 위치 (꼬리)
const MAP_COLORS = ["rgba(138,145,162,0.35)", "rgba(76,196,106,0.55)", "rgba(200,192,64,0.6)", "rgba(224,80,80,0.6)"];
const MAP_SOLID = ["rgb(150,162,185)", "rgb(76,210,110)", "rgb(225,210,70)", "rgb(235,80,80)"];
const TRAIL_RGB = "190,120,255";   // 최근 경로 (CO2 노랑과 구분되는 보라)

// ---------- 막대 그래프 ----------
function makeBars(el, labels, colors, centered = false) {
  el.innerHTML = "";
  return labels.map((label, i) => {
    const name = document.createElement("span");
    name.textContent = label;
    const track = document.createElement("div");
    track.className = "track";
    const fill = document.createElement("div");
    fill.className = "fill" + (centered ? " center" : "");
    fill.style.background = colors[i];
    track.appendChild(fill);
    const num = document.createElement("span");
    num.className = "num";
    el.append(name, track, num);
    return (v) => {
      if (centered) {
        const w = Math.min(1, Math.abs(v)) * 50;
        fill.style.width = `${w}%`;
        fill.style.left = v >= 0 ? "50%" : `${50 - w}%`;
      } else {
        fill.style.width = `${Math.min(1, Math.max(0, v)) * 100}%`;
      }
      num.textContent = v.toFixed(2);
    };
  });
}

function makeLR(el, color) {
  el.innerHTML = "";
  return [0, 1].map((side) => {
    const track = document.createElement("div");
    track.className = "track";
    const fill = document.createElement("div");
    fill.className = "fill";
    fill.style.background = color;
    if (side === 0) fill.style.right = "0"; else fill.style.left = "0";
    const tick = document.createElement("div");    // 월드모델 복원값 (흰 눈금)
    tick.className = "tick";
    tick.style.display = "none";
    track.append(fill, tick);
    el.appendChild(track);
    return (v, recon = null) => {
      fill.style.width = `${Math.min(1, v) * 100}%`;
      if (recon == null) return;
      tick.style.display = "block";
      tick.style[side === 0 ? "right" : "left"] = `calc(${Math.min(1, recon) * 100}% - 1px)`;
    };
  });
}

// ---------- 캔버스 ----------
function fitCanvas(c) {
  const r = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight || c.height;
  if (c.width !== Math.round(w * r)) { c.width = Math.round(w * r); c.height = Math.round(h * r); }
  const ctx = c.getContext("2d");
  ctx.setTransform(r, 0, 0, r, 0, 0);
  return [ctx, w, h];
}

// recon을 주면 위 칸은 실제, 아래 칸은 월드모델 복원값
function drawEyes(obs, id = "eyes", recon = null) {
  if (!$(id)) return;
  const [ctx, w, h] = fitCanvas($(id));
  const n = init.n_eye, gap = 10, cw = (w - gap) / (2 * n);
  ctx.clearRect(0, 0, w, h);
  const rows = recon ? [[obs, 0, h / 2 - 1], [recon, h / 2 + 1, h / 2 - 1]] : [[obs, 0, h]];
  for (const [vals, y0, rh] of rows) {
    for (let i = 0; i < 2 * n; i++) {
      const v = vals[4 + i];
      // 왼눈은 바깥(왼쪽 뒤)→앞 순서로 보이도록 뒤집어 그린다
      const col = i < n ? n - 1 - i : i;
      const x = col * cw + (i >= n ? gap : 0);
      ctx.fillStyle = `rgba(${Math.round(40 + 200 * v)}, ${Math.round(40 + 60 * v)}, ${Math.round(50 + 30 * v)}, 1)`;
      ctx.fillRect(x, y0, cw - 1, rh);
    }
  }
}

function drawReward() {
  if (!$("reward-chart")) return;
  const [ctx, w, h] = fitCanvas($("reward-chart"));
  ctx.clearRect(0, 0, w, h);
  const { reward, total } = history;
  if (!total.length) return;
  const lo = Math.min(0, ...total), hi = Math.max(1, ...total);
  const y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
  const x = (i) => (i / (HISTORY - 1)) * w;
  ctx.strokeStyle = css("--line");
  ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(w, y(0)); ctx.stroke();
  // 큰 보상 이벤트는 세로 막대
  reward.forEach((r, i) => {
    if (Math.abs(r) < 1) return;
    ctx.fillStyle = r > 0 ? css("--food") : css("--bad");
    ctx.fillRect(x(i) - 1, 0, 2, h);
  });
  ctx.strokeStyle = css("--accent");
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  total.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
  ctx.fillStyle = css("--muted");
  ctx.font = "11px Segoe UI";
  ctx.fillText(`return ${total.at(-1).toFixed(1)}`, 4, 12);
}

// ---------- 월드모델 ----------
const hCanvas = document.createElement("canvas");

// h 히트맵은 오프스크린 캔버스를 왼쪽으로 한 칸 밀고 새 열 하나만 그린다 (매번 전체를 다시 만들지 않음)
let hCol = null;
function drawH() {
  if (!$("h-heat")) return;
  const rows = history.h;
  if (!rows.length) return;
  const dims = rows[0].length;
  const hctx = hCanvas.getContext("2d");
  if (hCanvas.width !== HISTORY || hCanvas.height !== dims || rows.length === 1) {
    hCanvas.width = HISTORY; hCanvas.height = dims;
    hctx.fillStyle = "#0b0d11"; hctx.fillRect(0, 0, HISTORY, dims);
    hCol = hctx.createImageData(1, dims);
  }
  hctx.drawImage(hCanvas, -1, 0);
  const col = rows.at(-1);
  for (let d = 0; d < dims; d++) {
    const v = Math.max(-1, Math.min(1, col[d]));
    // 음수 파랑, 양수 주황
    hCol.data.set([v > 0 ? 40 + 215 * v : 40, 40 + 90 * Math.abs(v), v < 0 ? 40 - 200 * v : 40, 255], 4 * d);
  }
  hctx.putImageData(hCol, HISTORY - 1, 0);
  const [ctx, w, h] = fitCanvas($("h-heat"));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(hCanvas, 0, 0, w, h);
}

function drawZ(probs, [groups, classes]) {
  if (!$("z-grid")) return;
  const [ctx, w, h] = fitCanvas($("z-grid"));
  ctx.clearRect(0, 0, w, h);
  const cell = Math.min((w - 40) / classes, h / groups);
  zLayout = { cell, groups, classes };
  for (let g = 0; g < groups; g++) {
    let best = 0;
    for (let c = 0; c < classes; c++) if (probs[g * classes + c] > probs[g * classes + best]) best = c;
    for (let c = 0; c < classes; c++) {
      const p = probs[g * classes + c];
      ctx.fillStyle = `rgba(240, 200, 80, ${0.08 + 0.92 * p})`;
      ctx.fillRect(c * cell, g * cell, cell - 1, cell - 1);
      if (c === best) { ctx.strokeStyle = "#fff"; ctx.strokeRect(c * cell + 0.5, g * cell + 0.5, cell - 2, cell - 2); }
    }
    if (pins.has(g)) {                       // 고정한 칸: 하늘색 테두리
      ctx.strokeStyle = "rgb(140,220,255)";
      ctx.lineWidth = 2;
      ctx.strokeRect(pins.get(g) * cell + 1, g * cell + 1, cell - 3, cell - 3);
      ctx.lineWidth = 1;
    }
  }
  ctx.fillStyle = css("--muted");
  ctx.font = "11px Segoe UI";
  ctx.fillText(`${groups}×${classes}`, classes * cell + 6, 12);
}

function drawPred(imagined) {
  if (!$("pred-chart")) return;
  const [ctx, w, h] = fitCanvas($("pred-chart"));
  ctx.clearRect(0, 0, w, h);
  const H = imagined.reward.length;
  const split = w * 0.75;
  const all = [...history.pred, ...history.real, ...imagined.reward];
  const rlo = Math.min(-1, ...all), rhi = Math.max(1, ...all);
  const vals = [...history.value, ...imagined.value];
  const vlo = Math.min(...vals), vhi = Math.max(...vals, vlo + 1);
  const ry = (v) => h - 6 - ((v - rlo) / (rhi - rlo)) * (h - 12);
  const vy = (v) => h - 6 - ((v - vlo) / (vhi - vlo)) * (h - 12);
  const hx = (i) => (i / (HISTORY - 1)) * split;
  const fx = (k) => split + (k / H) * (w - split);
  const off = HISTORY - history.pred.length;
  const line = (arr, x, y, color, dash = []) => {
    ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.lineWidth = 1.5;
    ctx.beginPath();
    arr.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke(); ctx.setLineDash([]);
  };
  ctx.strokeStyle = css("--line");
  ctx.beginPath(); ctx.moveTo(0, ry(0)); ctx.lineTo(w, ry(0)); ctx.moveTo(split, 0); ctx.lineTo(split, h); ctx.stroke();
  line(history.real, (i) => hx(i + off), ry, css("--muted"));
  line(history.pred, (i) => hx(i + off), ry, css("--accent"));
  line(history.value, (i) => hx(i + off), vy, css("--loom"));
  // 상상: 현재 값에서 이어서 (첫 상상 궤적이 완성되기 전에는 생략)
  if (H > 0) {
    line([history.pred.at(-1) ?? 0, ...imagined.reward], (k) => fx(k), ry, css("--accent"), [4, 3]);
    line(imagined.value, (k) => fx(k), vy, css("--loom"), [4, 3]);
  }
}

// ---------- 상태 지도: 월드모델 상태(h ⊕ z)를 PCA 2축에 투영 ----------
function project(h, z) {
  const { mean, components } = wmMap;
  const D = h.length;
  return components.map((c) => {
    let s = 0;
    for (let j = 0; j < D; j++) s += c[j] * (h[j] - mean[j]);
    for (let j = 0; j < z.length; j++) s += c[D + j] * (z[j] - mean[D + j]);
    return s;
  });
}

// 배경: 상황별 상태 밀도로 그린 '지형도'.
//   1) 상태들을 격자에 상황별로 모으고 살짝 블러, 상황마다 따로 정규화 (개수가 적은 CO2도 보이게)
//   2) 화면 픽셀마다 밀도를 보간해 가장 우세한 상황 하나의 색으로, 진하기는 4단계 띠로 나눔
//   3) 단계가 바뀌는 경계에 얇은 선 (등고선)
const MAP_RGB = [[150, 162, 185], [76, 210, 110], [225, 210, 70], [235, 80, 80]];
const LEVELS = [0.1, 0.28, 0.5, 0.75];          // 밀도 문턱값
const LEVEL_ALPHA = [0.16, 0.32, 0.5, 0.72];    // 단계별 진하기

function densityGrid(gw = 100, gh = 75) {
  const [x0, x1, y0, y1] = wmMap.bounds;
  const K = MAP_RGB.length;
  const grid = Array.from({ length: K }, () => new Float32Array(gw * gh));
  wmMap.points.forEach(([px, py], i) => {
    const gx = Math.floor(((px - x0) / (x1 - x0)) * gw);
    const gy = Math.floor((1 - (py - y0) / (y1 - y0)) * gh);
    if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) grid[wmMap.point_labels[i]][gy * gw + gx] += 1;
  });
  // 가로·세로 상자 블러를 세 번 (가우시안에 가까움)
  const blur = (a, rad) => {
    const tmp = new Float32Array(a.length);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let s = 0, n = 0;
        for (let d = -rad; d <= rad; d++) { const xx = x + d; if (xx >= 0 && xx < gw) { s += a[y * gw + xx]; n++; } }
        tmp[y * gw + x] = s / n;
      }
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let s = 0, n = 0;
        for (let d = -rad; d <= rad; d++) { const yy = y + d; if (yy >= 0 && yy < gh) { s += tmp[yy * gw + x]; n++; } }
        a[y * gw + x] = s / n;
      }
    }
  };
  grid.forEach((g) => {
    blur(g, 2);
    const sorted = Array.from(g).sort((a, b) => a - b);
    const m = sorted[Math.floor(0.995 * (sorted.length - 1))] || 1;   // 극단값 하나에 끌려가지 않게
    for (let i = 0; i < g.length; i++) g[i] = Math.min(1, g[i] / m);
  });
  return { grid, gw, gh };
}

// pw×ph 픽셀 크기의 지형도 이미지
function densityImage(pw, ph) {
  const { grid, gw, gh } = densityGrid();
  const K = grid.length;
  const sample = (k, fx, fy) => {                 // 격자 쌍선형 보간
    const x = Math.min(gw - 1.001, Math.max(0, fx * gw - 0.5)), y = Math.min(gh - 1.001, Math.max(0, fy * gh - 0.5));
    const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
    const g = grid[k];
    return (g[iy * gw + ix] * (1 - tx) + g[iy * gw + ix + 1] * tx) * (1 - ty) +
           (g[(iy + 1) * gw + ix] * (1 - tx) + g[(iy + 1) * gw + ix + 1] * tx) * ty;
  };
  // 픽셀마다 (우세한 상황, 단계)
  const cls = new Int8Array(pw * ph).fill(-1), lvl = new Int8Array(pw * ph).fill(-1);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    let best = -1, bd = 0;
    for (let k = 0; k < K; k++) { const d = sample(k, (x + 0.5) / pw, (y + 0.5) / ph); if (d > bd) { bd = d; best = k; } }
    let l = -1;
    for (let j = 0; j < LEVELS.length; j++) if (bd >= LEVELS[j]) l = j;
    if (l >= 0) { cls[y * pw + x] = best; lvl[y * pw + x] = l; }
  }
  const cv = document.createElement("canvas");
  cv.width = pw; cv.height = ph;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(pw, ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const i = y * pw + x;
    if (lvl[i] < 0) continue;
    const [r, g, b] = MAP_RGB[cls[i]];
    // 오른쪽·아래 이웃과 상황이나 단계가 다르면 경계선
    const edge = (x + 1 < pw && (lvl[i + 1] !== lvl[i] || cls[i + 1] !== cls[i])) ||
                 (y + 1 < ph && (lvl[i + pw] !== lvl[i] || cls[i + pw] !== cls[i]));
    img.data.set(edge ? [r, g, b, 235] : [r, g, b, 255 * LEVEL_ALPHA[lvl[i]]], 4 * i);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

let mapBg = null, mapBgKey = "";
function drawStateMap(cur, imagined) {
  const c = $("state-map");
  if (!c || !wmMap) return;
  const [ctx, w, h] = fitCanvas(c);
  const [x0, x1, y0, y1] = wmMap.bounds;
  const pad = 28;
  const X = (v) => pad + ((v - x0) / (x1 - x0)) * (w - pad - 8);
  const Y = (v) => h - pad - ((v - y0) / (y1 - y0)) * (h - pad - 8);
  // 배경 점 (수집한 상태들, 상황별 색): 크기가 바뀔 때만 다시 그림
  const key = `${w}x${h}`;
  if (key !== mapBgKey) {
    mapBgKey = key;
    mapBg = document.createElement("canvas");
    const r = window.devicePixelRatio || 1;
    mapBg.width = w * r; mapBg.height = h * r;
    const b = mapBg.getContext("2d");
    b.scale(r, r);
    // 지형도는 실제 픽셀 크기로 만들어 확대 없이 그림 (흐려지지 않게)
    const mw = Math.round((w - pad - 8) * r), mh = Math.round((h - pad - 8) * r);
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.drawImage(densityImage(mw, mh), Math.round(pad * r), Math.round(8 * r));
    b.setTransform(r, 0, 0, r, 0, 0);
    // 축 이름: 각 축이 실제로 무엇과 연관되는지
    b.fillStyle = css("--muted");
    b.font = "11px Segoe UI";
    b.fillText(`→ ${wmMap.axis_names[0]}`, pad, h - 8);
    b.save(); b.translate(14, h - pad); b.rotate(-Math.PI / 2);
    b.fillText(`→ ${wmMap.axis_names[1]}`, 0, 0);
    b.restore();
  }
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(mapBg, 0, 0, w, h);
  // 최근 궤적: 보라색 선 (오래될수록 흐리게)
  ctx.lineWidth = 2;
  for (let i = 1; i < mapTrail.length; i++) {
    ctx.strokeStyle = `rgba(${TRAIL_RGB},${0.15 + 0.75 * (i / mapTrail.length)})`;
    ctx.beginPath();
    ctx.moveTo(X(mapTrail[i - 1][0]), Y(mapTrail[i - 1][1]));
    ctx.lineTo(X(mapTrail[i][0]), Y(mapTrail[i][1]));
    ctx.stroke();
  }
  // 상상한 앞으로 15스텝 (점선)
  if (imagined && imagined.hz && imagined.hz.length > 1) {
    const pts = imagined.hz.map(([hh, zz]) => project(hh, zz));
    // 상상이 시작된 상태 (빈 원): 지금보다 몇 스텝 전일 수 있음
    ctx.strokeStyle = "rgba(140,220,255,0.9)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(pts[0][0]), Y(pts[0][1]), 4, 0, 2 * Math.PI); ctx.stroke();
    ctx.strokeStyle = "rgba(140,220,255,0.85)";
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(X(px), Y(py)) : ctx.moveTo(X(px), Y(py))));
    ctx.stroke(); ctx.setLineDash([]);
    const [ex, ey] = pts[pts.length - 1];
    ctx.fillStyle = "rgba(140,220,255,0.9)";
    ctx.beginPath(); ctx.arc(X(ex), Y(ey), 3.5, 0, 2 * Math.PI); ctx.fill();
  }
  // 현재 위치
  if (cur) {
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(X(cur[0]), Y(cur[1]), 5, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = `rgb(${TRAIL_RGB})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(cur[0]), Y(cur[1]), 8, 0, 2 * Math.PI); ctx.stroke();
  }
}

function mapLegend() {
  if (!$("map-legend") || !wmMap) return;
  $("map-legend").innerHTML =
    wmMap.labels.map((l, i) => `<span><i style="background:${MAP_SOLID[i]}"></i>${l}</span>`).join("") +
    `<span><i style="background:#fff"></i>now</span><span><i style="background:rgb(${TRAIL_RGB})"></i>recent path</span>` +
    `<span><i style="background:rgb(140,220,255)"></i>imagined 15 steps (○ = where the dream started)</span>` +
    `<span class="muted">axes explain ${(100 * (wmMap.explained[0] + wmMap.explained[1])).toFixed(0)}% of state variance</span>`;
}

// ---------- 행동 지도: 고른 행동 + 행동마다 월드모델이 예상한 결과 ----------
// 축은 행동값 그대로 (x = 회전, 왼쪽이 +1 / y = 전진), 점프는 오른쪽 칸.
// 배경 = advantage: 후보 행동마다 상상한 4스텝 보상 합(Q)에서 이 상태의 평균을 뺀 값.
// 상황 자체가 좋은지(먹이 근처 등)는 빼고 '여기서 어느 선택이 나은가'만 남긴다.
const ACT_GOOD = "76,196,106", ACT_BAD = "240,45,60";
const actTrail = [];                 // 최근 실제 행동 [회전, 전진] (꼬리)
let actAdv = null, actScale = 0.05;  // 화면용 advantage (프레임 사이 부드럽게), 색이 꽉 차는 크기
let lastAct = null;                  // 마지막 프레임의 행동 (일시정지 미리보기용)

function drawStar(ctx, x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
    ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.strokeStyle = "#0b0d11"; ctx.lineWidth = 1; ctx.stroke();
}

function drawActionMap(whatif, act) {
  const c = $("action-map");
  if (!c || !init?.actionGrid || !act) return;
  const { turns, forwards } = init.actionGrid;
  const nT = turns.length, nF = forwards.length, JUMP = nT * nF;
  const [ctx, w, h] = fitCanvas(c);
  ctx.clearRect(0, 0, w, h);
  const padL = 22, padT = 6, padB = 18, jumpW = 46, gap = 8;
  const gx = padL, gy = padT, gw = w - padL - jumpW - gap - 4, gh = h - padT - padB;
  const cw = gw / nT, ch = gh / nF;
  const jx = gx + gw + gap, jcx = jx + (jumpW - 10) / 2;
  // 행동값 → 화면 좌표 (칸 중심 = 그 칸의 행동값). 후진(전진 < 0)은 아래 가장자리에 붙임
  const X = (t) => gx + cw / 2 + ((turns[0] - t) / (turns[0] - turns[nT - 1])) * (gw - cw);
  const Y = (f) => {
    const v = Math.max(forwards[nF - 1], Math.min(forwards[0], f));
    return gy + ch / 2 + ((forwards[0] - v) / (forwards[0] - forwards[nF - 1])) * (gh - ch);
  };
  // 점프 쿨다운 중에는 점프해도 효과가 없으므로 점프 칸은 비교에서 뺌
  const jumpReady = !whatif || whatif.cooldown === 0;
  const usable = (i) => i < JUMP || jumpReady;
  let best = -1;
  if (whatif) {
    // 기준(평균)과 색 크기는 걷기 격자 27칸으로만 정한다. 점프는 에너지 비용(−0.5) 때문에 평소 값이 훨씬 낮아서
    // 함께 넣으면 격자 색이 모두 흐려진다. 점프 칸은 같은 기준에 비교해 칠하고, 넘치면 끝 색으로.
    const q = whatif.q;
    const mean = q.slice(0, JUMP).reduce((s, v) => s + v, 0) / JUMP;
    const adv = q.map((v) => v - mean);
    actAdv = actAdv ? actAdv.map((a, i) => 0.5 * a + 0.5 * adv[i]) : adv;
    let maxAbs = 0;
    actAdv.forEach((a, i) => {
      if (i < JUMP) maxAbs = Math.max(maxAbs, Math.abs(a));
      if (usable(i) && (best < 0 || a > actAdv[best])) best = i;
    });
    actScale = Math.max(maxAbs, actScale * 0.95, 0.05);   // 커지면 바로, 작아지면 천천히 (깜빡임 방지)
  }
  const fill = (a) => {
    // 나쁜 쪽은 조금만 나빠도 눈에 띄게 더 진하게
    const k = Math.max(-1, Math.min(1, a / actScale));
    return k >= 0 ? `rgba(${ACT_GOOD},${0.08 + 0.72 * k})` : `rgba(${ACT_BAD},${0.12 + 0.83 * Math.sqrt(-k)})`;
  };
  const EMPTY = "rgba(138,145,162,0.08)";
  for (let j = 0; j < nF; j++) for (let i = 0; i < nT; i++) {
    ctx.fillStyle = actAdv ? fill(actAdv[j * nT + i]) : EMPTY;
    ctx.fillRect(gx + i * cw + 1, gy + j * ch + 1, cw - 2, ch - 2);
  }
  // 점프 칸 + 고른 점프 값 (아래에서 채움, 흰 눈금 = 발동 문턱 0.5)
  ctx.fillStyle = !jumpReady ? "rgba(138,145,162,0.12)" : actAdv ? fill(actAdv[JUMP]) : EMPTY;
  ctx.fillRect(jx, gy + 1, jumpW, gh - 2);
  const jv = (Math.max(-1, Math.min(1, act.action[2])) + 1) / 2;
  ctx.fillStyle = "rgba(224,80,80,0.8)";
  ctx.fillRect(jx + jumpW - 8, gy + 1 + (gh - 2) * (1 - jv), 5, (gh - 2) * jv);
  ctx.fillStyle = "#fff";
  ctx.fillRect(jx + jumpW - 10, gy + 1 + (gh - 2) * 0.25 - 1, 9, 2);
  const jumped = act.action[2] > 0.5 && jumpReady;
  if (jumped) {
    ctx.strokeStyle = css("--bad"); ctx.lineWidth = 2;
    ctx.strokeRect(jx + 1, gy + 2, jumpW - 2, gh - 4);
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";   // 진한 빨강 칸 위에서도 읽히게
  ctx.font = "11px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("Jump", jcx, gy + 14);
  if (!jumpReady) ctx.fillText("cooldown", jcx, gy + gh / 2 + 4);
  ctx.fillStyle = css("--muted");
  ctx.textAlign = "left"; ctx.fillText("◀ turn left", gx, h - 5);
  ctx.textAlign = "center"; ctx.fillText("straight", X(0), h - 5);
  ctx.textAlign = "right"; ctx.fillText("turn right ▶", gx + gw, h - 5);
  ctx.save(); ctx.translate(13, gy + gh / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center"; ctx.fillText("stop → forward", 0, 0);
  ctx.restore();
  ctx.textAlign = "left";
  // ☆ 월드모델이 보기에 가장 나은 행동
  if (best >= 0) {
    if (best === JUMP) drawStar(ctx, jcx, gy + gh / 2 + 18, 7);
    else drawStar(ctx, X(turns[best % nT]), Y(forwards[Math.floor(best / nT)]), 7);
  }
  // 꼬리 (오래될수록 흐리게) + 지금 고른 행동
  actTrail.forEach(([t, f], k) => {
    ctx.fillStyle = `rgba(240,200,80,${0.08 + 0.5 * (k / actTrail.length)})`;
    ctx.beginPath(); ctx.arc(X(t), Y(f), 2.5, 0, 2 * Math.PI); ctx.fill();
  });
  const [f0, t0] = act.action;
  ctx.fillStyle = css("--accent"); ctx.strokeStyle = "#0b0d11"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(X(t0), Y(f0), 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  // 키보드 모드: 뇌였다면 고를 행동 (빈 원)
  const showBrain = act.mode !== "brain" && act.brain;
  if (showBrain) {
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(act.brain[1]), Y(act.brain[0]), 6, 0, 2 * Math.PI); ctx.stroke();
  }

  // 숫자: 고른 행동 + 월드모델 기준 순위 (가장 가까운 후보 칸, 점프가 발동했으면 점프 칸)
  const rankOf = (a) => {
    if (!actAdv) return null;
    let idx = JUMP;
    if (!(a[2] > 0.5 && jumpReady)) {
      const near = (arr, v) => arr.reduce((b, x, i) => (Math.abs(x - v) < Math.abs(arr[b] - v) ? i : b), 0);
      idx = near(forwards, a[0]) * nT + near(turns, a[1]);
    }
    let rank = 1, total = 0;
    actAdv.forEach((v, i) => { if (usable(i)) { total++; if (v > actAdv[idx]) rank++; } });
    return `${rank} / ${total}`;
  };
  const turnText = (t) => `${t >= 0 ? "+" : "−"}${Math.abs(t).toFixed(2)} (${Math.abs(t) < 0.05 ? "straight" : t > 0 ? "left" : "right"})`;
  const who = act.mode === "brain" ? "brain" : "you";
  let text = `forward ${f0.toFixed(2)} · turn ${turnText(t0)} · jump ${act.action[2].toFixed(2)}${jumped ? " (jumping)" : ""}`;
  const r = rankOf(act.action);
  if (r) text += ` — world model ranks ${who === "brain" ? "the brain's" : "your"} choice <b>${r}</b>`;
  if (showBrain && actAdv) text += ` · brain would rank ${rankOf(act.brain)}`;
  $("act-num").innerHTML = text;
}

// ---------- 타임라인: 보상 · 가치 · 놀람을 같은 시간축에 세 줄로 ----------
function drawTimeline(imagined) {
  const c = $("timeline");
  if (!c) return;
  const [ctx, w, h] = fitCanvas(c);
  ctx.clearRect(0, 0, w, h);
  const labelW = 58, split = labelW + (w - labelW) * 0.78;
  const lanes = [["reward", 0, h * 0.36], ["value", h * 0.38, h * 0.3], ["surprise", h * 0.7, h * 0.3]];
  const H = (imagined && imagined.reward) ? imagined.reward.length : 0;
  const n = history.pred.length;
  const age = (H && imagined.originStep != null && lastStep != null) ? lastStep - imagined.originStep : null;
  const hx = (i) => labelW + ((i + HISTORY - n) / (HISTORY - 1)) * (split - labelW);
  const fx = (k) => split + (H ? k / H : 0) * (w - split - 4);
  ctx.font = "11px Segoe UI";
  for (const [name, top, lh] of lanes) {
    ctx.fillStyle = css("--muted");
    ctx.fillText(name, 4, top + 13);
    ctx.strokeStyle = css("--line");
    ctx.beginPath(); ctx.moveTo(labelW, top + lh - 1); ctx.lineTo(w, top + lh - 1); ctx.stroke();
  }
  ctx.strokeStyle = css("--line");
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(split, 0); ctx.lineTo(split, h); ctx.stroke();
  ctx.setLineDash([]);
  if (age != null) {
    ctx.fillStyle = "rgba(140,220,255,0.9)";
    ctx.fillText(age === 0 ? "imagined from now" : `imagined from ${age} steps ago`, split + 4, 12);
  }
  const line = (arr, x, y, color, dash = []) => {
    if (!arr.length) return;
    ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.lineWidth = 1.5;
    ctx.beginPath();
    arr.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke(); ctx.setLineDash([]);
  };
  // 1) 보상: 실제(회색) vs 예측(노랑)
  const [, rt, rh] = lanes[0];
  const rAll = [...history.pred, ...history.real, ...(H ? imagined.reward : [])];
  const rlo = Math.min(-1, ...rAll), rhi = Math.max(1, ...rAll);
  const ry = (v) => rt + rh - 3 - ((v - rlo) / (rhi - rlo)) * (rh - 6);
  ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(labelW, ry(0)); ctx.lineTo(w, ry(0)); ctx.stroke();
  line(history.real, hx, ry, css("--muted"));
  line(history.pred, hx, ry, css("--accent"));
  if (H) line([history.pred.length ? history.pred[history.pred.length - 1] : 0, ...imagined.reward], fx, ry, css("--accent"), [4, 3]);
  // 2) 가치
  const [, vt, vh] = lanes[1];
  const vAll = [...history.value, ...(H ? imagined.value : [])];
  if (vAll.length) {
    const vlo = Math.min(...vAll), vhi = Math.max(...vAll, vlo + 1);
    const vy = (v) => vt + vh - 3 - ((v - vlo) / (vhi - vlo)) * (vh - 6);
    line(history.value, hx, vy, css("--loom"));
    if (H) line(imagined.value, fx, vy, css("--loom"), [4, 3]);
  }
  // 3) 놀람: 평소(중앙값)의 2배를 넘으면 빨강
  const [, st, sh] = lanes[2];
  const s = history.surprise;
  if (s.length) {
    const typical = [...s].sort((a, b) => a - b)[Math.floor(s.length / 2)];
    const shi = Math.max(3, ...s);
    const bw = Math.max(1.5, (split - labelW) / HISTORY);
    s.forEach((v, i) => {
      const x = labelW + ((i + HISTORY - s.length) / (HISTORY - 1)) * (split - labelW);
      const bh = (v / shi) * (sh - 4);
      ctx.fillStyle = v > 2 * typical + 0.5 ? "rgba(224,80,80,0.9)" : "rgba(138,145,162,0.45)";
      ctx.fillRect(x - bw / 2, st + sh - 2 - bh, bw, bh);
    });
  }
}

// 일시정지 중 믿음을 바꿨을 때: 복원 감각·z·상상·꿈속 뇌만 다시 그림 (시간 기록은 그대로)
function drawPreview(p) {
  showRecon(p.recon);
  pins = new Map(p.pins);
  if (rawOpen()) drawZ(p.z_probs, p.z_shape);
  drawPred(p.imagined);
  drawTimeline(p.imagined);
  if (wmMap) drawStateMap(project(p.h, p.z), p.imagined);
  drawActionMap(p.whatif, lastAct);
  $("wm-num").textContent = `pred ${p.reward_pred.toFixed(2)} · value ${p.value.toFixed(1)} · continue ${(p.cont * 100).toFixed(0)}% (preview)`;
  if (viewMode !== "live" && lastRates) {
    brain.update(p.dream.rates, viewMode === "diff" ? { diffFrom: lastRates, clamped: [...clampedNow] } : { clamped: [...clampedNow] });
    const a = p.dream.action;
    $("dream-info").textContent = `dream from now (step ${p.dream.originStep}) · end of rollout · forward ${a[0].toFixed(2)} turn ${a[1].toFixed(2)} jump ${a[2].toFixed(2)}`;
  }
  updatePinInfo();
}

function updatePinInfo() {
  if ($("pin-info")) $("pin-info").textContent = pins.size ? `${pins.size} row${pins.size > 1 ? "s" : ""} pinned` : "";
}

// 원래 h·z 그림은 'Raw state'를 펼쳤을 때만 그림 (legacy.html에는 접기가 없으니 항상)
const rawOpen = () => !$("raw") || $("raw").open;

// 월드모델 복원 감각: app.html은 실제 막대 위에 흰 눈금으로, legacy.html은 별도 막대로
function showRecon(recon) {
  if (setFoodR) {
    setFoodR[0](recon[0]); setFoodR[1](recon[1]);
    setCO2R[0](recon[2]); setCO2R[1](recon[3]);
    drawEyes(recon, "eyes-r");
  } else {
    setFood[0](lastObs[0], recon[0]); setFood[1](lastObs[1], recon[1]);
    setCO2[0](lastObs[2], recon[2]); setCO2[1](lastObs[3], recon[3]);
    drawEyes(lastObs, "eyes", recon);
  }
}

function drawWM(wm) {
  if (wm.pins) { pins = new Map(wm.pins); updatePinInfo(); }
  lastZ = { probs: wm.z_probs, shape: wm.z_shape };
  showRecon(wm.recon);
  history.h.push(wm.h); history.pred.push(wm.reward_pred);
  history.real.push(wm.reward_real); history.value.push(wm.value);
  for (const k of ["h", "pred", "real", "value"]) if (history[k].length > HISTORY) history[k].shift();
  if (wm.surprise != null) {
    history.surprise.push(wm.surprise);
    if (history.surprise.length > HISTORY) history.surprise.shift();
    if ($("surprise-num")) $("surprise-num").textContent = wm.surprise.toFixed(2);
  }
  if (rawOpen()) { drawH(); drawZ(wm.z_probs, wm.z_shape); }
  drawPred(wm.imagined);
  drawSurprise();
  drawTimeline(wm.imagined);
  if (wmMap && wm.z) {
    const cur = project(wm.h, wm.z);
    mapTrail.push(cur);
    if (mapTrail.length > 60) mapTrail.shift();
    drawStateMap(cur, wm.imagined);
  }
  $("wm-num").textContent = `pred ${wm.reward_pred.toFixed(2)} · actual ${wm.reward_real.toFixed(2)} · value ${wm.value.toFixed(1)} · continue ${(wm.cont * 100).toFixed(0)}%`;
}

function drawSurprise() {
  const c = $("surprise-chart");
  if (!c) return;
  const [ctx, w, h] = fitCanvas(c);
  ctx.clearRect(0, 0, w, h);
  const s = history.surprise;
  if (!s.length) return;
  const sorted = [...s].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  const hi = Math.max(3, ...s);
  const x = (i) => ((i + HISTORY - s.length) / (HISTORY - 1)) * w;
  const y = (v) => h - 4 - (v / hi) * (h - 8);
  // 평소(중앙값)의 2배를 넘으면 '놀람'으로 빨갛게
  s.forEach((v, i) => {
    ctx.fillStyle = v > 2 * typical + 0.5 ? "rgba(224,80,80,0.85)" : "rgba(138,145,162,0.45)";
    ctx.fillRect(x(i) - 1, y(v), Math.max(1.5, w / HISTORY), h - 4 - y(v));
  });
  ctx.strokeStyle = css("--line");
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(0, y(2 * typical + 0.5)); ctx.lineTo(w, y(2 * typical + 0.5)); ctx.stroke();
  ctx.setLineDash([]);
}

function drawWMPlaceholder() {
  for (const id of ["h-heat", "z-grid", "pred-chart", "timeline", "state-map", "action-map"]) {
    if (!$(id)) continue;
    const [ctx, w, h] = fitCanvas($(id));
    ctx.fillStyle = "#0b0d11";
    ctx.fillRect(0, 0, w, h);
  }
}

// ---------- 패널 구성 ----------
let setDN, setIn, setAct, setFood, setCO2, setFoodR, setCO2R;

function onInit(msg) {
  init = msg;
  $("brain-info").textContent = `${msg.n.toLocaleString()} neurons · ${msg.trained ? "trained" : "untrained"}`;
  $("brain-view").querySelector("canvas")?.remove();
  // 3D에서 뉴런을 고르면 접혀 있던 뉴런 조작 영역을 펼침
  brain = createBrainView($("brain-view"), $("tooltip"), msg, {
    onPick: (i) => { picked = i; if ($("perturb")) $("perturb").open = true; renderPicked(); },
  });
  setupPerturb(msg);

  $("legend").innerHTML = Object.entries(GROUP_LABELS)
    .map(([k, label]) => `<span><i style="background:${rgb(GROUP_COLORS[k])}"></i>${label}</span>`)
    .join("");

  // 하행뉴런·감각뉴런 막대는 legacy.html(서버)에만 있음
  const dnGroup = (i) => msg.group[msg.out_neurons[i]];
  setDN = $("dn-bars") ? makeBars($("dn-bars"), msg.out_names, msg.out_neurons.map((_, i) => rgb(GROUP_COLORS[dnGroup(i)]))) : null;
  const inKeys = ["in_odor_food", "in_odor_co2", "in_looming"];
  const inLabels = inKeys.flatMap((k) => [`${GROUP_LABELS[k]} L`, `${GROUP_LABELS[k]} R`]);
  setIn = $("in-bars") ? makeBars($("in-bars"), inLabels, inKeys.flatMap((k) => [rgb(GROUP_COLORS[k]), rgb(GROUP_COLORS[k])])) : null;
  // 행동 막대는 legacy.html(서버)에만 있고, app.html은 행동 지도로 그림
  setAct = $("act-bars") ? makeBars($("act-bars"), ["Forward", "Turn (+left)", "Jump"], [css("--accent"), css("--accent"), css("--bad")], true) : null;
  setFood = makeLR($("o-food"), css("--food"));
  setCO2 = makeLR($("o-co2"), css("--co2"));
  // legacy.html(서버)에는 복원 감각용 막대가 따로 있고, app.html은 실제 막대에 눈금으로 겹쳐 그림
  setFoodR = $("r-food") ? makeLR($("r-food"), css("--food")) : null;
  setCO2R = $("r-co2") ? makeLR($("r-co2"), css("--co2")) : null;
  drawWMPlaceholder();
}

// ---------- 뉴런 조작 (브라우저 시뮬레이션에서만) ----------
function setupPerturb(msg) {
  if (!$("group-ctl")) return;
  $("group-ctl").innerHTML = Object.entries(GROUP_LABELS).map(([k, label]) =>
    `<span><i style="background:${rgb(GROUP_COLORS[k])}"></i>${label} <span class="muted">(${msg.groups[k].length})</span></span>` +
    `<button class="stim" data-g="${k}">Stimulate</button><button class="sil" data-g="${k}">Silence</button>`).join("");
  $("group-ctl").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.g, on = b.classList.contains("on");
    send("clamp", { neurons: init.groups[g], v: on ? null : (b.classList.contains("stim") ? STIM : SILENCE) });
    $("group-ctl").querySelectorAll(`[data-g="${g}"]`).forEach((x) => x.classList.remove("on"));
    if (!on) b.classList.add("on");
  }));
  // z 격자 클릭 → 그 범주의 믿음을 그 칸으로 고정 (같은 칸 다시 클릭하면 해제)
  $("z-grid")?.addEventListener("click", async (e) => {
    if (!zLayout || !local) return;
    const rect = e.target.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left) / zLayout.cell);
    const g = Math.floor((e.clientY - rect.top) / zLayout.cell);
    if (g < 0 || g >= zLayout.groups || c < 0 || c >= zLayout.classes) return;
    const release = pins.get(g) === c;
    send("pin", { g, c: release ? null : c });
    release ? pins.delete(g) : pins.set(g, c);
    updatePinInfo();
    if (paused) { const p = await local.preview(); if (p) drawPreview(p); }
  });
  // 지금 z(각 범주의 가장 확률 높은 칸)를 저장 → 나중에 전 범주를 그 칸으로 고정
  $("save-belief")?.addEventListener("click", () => {
    if (!lastZ) return;
    const [G, C] = lastZ.shape;
    savedBelief = [];
    for (let g = 0; g < G; g++) {
      let best = 0;
      for (let c = 1; c < C; c++) if (lastZ.probs[g * C + c] > lastZ.probs[g * C + best]) best = c;
      savedBelief.push([g, best]);
    }
    const eyes = Math.max(0, ...recentEye);
    const situation = eyes > 0.05 ? "predator approaching" : lastObs[0] + lastObs[1] > 1.4 ? "near food" : "calm";
    $("belief-info").textContent = `saved at episode ${$("episode").textContent} step ${$("step").textContent} (${situation})`;
    $("inject-belief").disabled = false;
  });
  $("inject-belief")?.addEventListener("click", async () => {
    if (!savedBelief) return;
    for (const [g, c] of savedBelief) { send("pin", { g, c }); pins.set(g, c); }
    updatePinInfo();
    if (paused) { const p = await local.preview(); if (p) drawPreview(p); }
  });
  $("clear-pins")?.addEventListener("click", async () => {
    send("pin", { clear: true });
    pins.clear();
    updatePinInfo();
    if (paused) { const p = await local.preview(); if (p) drawPreview(p); }
  });
  $("unclamp").addEventListener("click", () => {
    send("unclamp_all");
    $("group-ctl").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    clampedNow.clear();
    renderPicked();
  });
  document.querySelectorAll("#brain-mode button").forEach((b) => b.addEventListener("click", () => {
    viewMode = b.dataset.v;
    document.querySelectorAll("#brain-mode button").forEach((x) => x.classList.toggle("on", x === b));
  }));
}

function renderPicked() {
  if (picked == null || !$("picked")) return;
  const i = picked, v = clampedNow.get(i);
  const type = init.cell_type[i];
  const same = type ? init.cell_type.reduce((a, t, j) => (t === type ? (a.push(j), a) : a), []) : [i];
  const state = v == null ? "" : v > 0 ? " · <b>stimulated</b>" : " · <b>silenced</b>";
  $("picked").innerHTML =
    `<div><b>${type || "(unnamed)"}</b> · ${init.side[i]} · ${init.super_class[i]} · #${i}${state}</div>` +
    `<div class="ctl-row"><button data-a="stim">Stimulate</button><button data-a="sil">Silence</button>` +
    `<button data-a="rel">Release</button>` +
    (same.length > 1 ? `<button data-a="type">Stimulate all ${same.length} ${type}</button>` : "") + `</div>`;
  $("picked").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.a;
    const neurons = a === "type" ? same : [i];
    const val = a === "stim" || a === "type" ? STIM : a === "sil" ? SILENCE : null;
    send("clamp", { neurons, v: val });
    neurons.forEach((j) => (val == null ? clampedNow.delete(j) : clampedNow.set(j, val)));
    renderPicked();
  }));
}

function groupMean(rates, idx, side) {
  let s = 0, c = 0;
  for (const i of idx) if (init.side[i] === side) { s += rates[i]; c++; }
  return c ? s / c / 255 : 0;
}

function onFrame(f) {
  // 서버는 base64 문자열, 브라우저 시뮬레이션은 바로 Uint8Array
  const rates = typeof f.rates === "string" ? Uint8Array.from(atob(f.rates), (c) => c.charCodeAt(0)) : f.rates;
  lastRates = rates;
  lastObs = f.obs;
  lastStep = f.step;
  recentEye = [...recentEye, Math.max(...f.obs.slice(4))].slice(-10);
  // 뇌 보기: 실제 / 꿈(상상 중 뇌 활동) / 꿈 − 실제
  const clamped = f.clamped || [];
  clampedNow = new Map(clamped);
  if (viewMode !== "live" && f.dream) {
    brain.update(f.dream.rates, viewMode === "diff" ? { diffFrom: rates, clamped } : { clamped });
    const a = f.dream.action;
    $("dream-info").textContent = `dream started at step ${f.dream.originStep} (${f.dream.age} steps ago) · ` +
      `imagined step +${f.dream.step}/${f.dream.of} · forward ${a[0].toFixed(2)} turn ${a[1].toFixed(2)} jump ${a[2].toFixed(2)}`;
  } else {
    brain.update(rates, { clamped });
    if ($("dream-info")) $("dream-info").textContent = viewMode === "live" ? "" : "waiting for the first imagined rollout…";
  }
  if ($("clamp-info")) $("clamp-info").textContent = clamped.length ? `${clamped.length.toLocaleString()} neurons clamped` : "";
  if (setDN) init.out_neurons.forEach((n, i) => setDN[i](rates[n] / 255));
  if (setIn) {
    let j = 0;
    for (const k of ["in_odor_food", "in_odor_co2", "in_looming"]) {
      for (const side of ["left", "right"]) setIn[j++](groupMean(rates, init.groups[k], side));
    }
  }

  setFood[0](f.obs[0]); setFood[1](f.obs[1]);
  setCO2[0](f.obs[2]); setCO2[1](f.obs[3]);
  drawEyes(f.obs);
  if (setAct) f.action.forEach((v, i) => setAct[i](v));
  if (lastAct && lastAct.episode !== f.episode) { actTrail.length = 0; actAdv = null; }   // 리셋 버튼 등으로 새 에피소드
  lastAct = { action: f.action, brain: f.brain_action, mode: f.mode, episode: f.episode };
  actTrail.push([f.action[1], f.action[0]]);
  if (actTrail.length > 30) actTrail.shift();
  drawActionMap(f.wm?.whatif, lastAct);
  history.reward.push(f.reward); history.total.push(f.total);
  if (history.reward.length > HISTORY) { history.reward.shift(); history.total.shift(); }
  drawReward();
  $("reward-num").textContent = `on arriving at step ${f.step}: ${f.reward >= 0 ? "+" : ""}${f.reward.toFixed(3)}`;
  if ($("act-note")) $("act-note").textContent = f.actionApplied === false
    ? "(episode ended at this state — not applied)" : "(chosen at this state, applied on the next step)";
  $("wm-empty").style.display = f.wm ? "none" : "flex";
  if (f.wm) drawWM(f.wm);

  if (f.game) $("game").src = `data:image/jpeg;base64,${f.game}`;   // 브라우저 시뮬레이션은 캔버스에 직접 그림
  $("score").textContent = f.score;
  $("total").textContent = f.total.toFixed(1);
  $("step").textContent = f.step;
  $("episode").textContent = f.episode;
  $("game-info").textContent = { brain: "Connectome brain", rule: "Rule-based", human: "Keyboard" }[f.mode];
  if (document.activeElement !== $("level")) $("level").value = String(f.level);
  const names = { food: "Ate food +10", escaped: "Escaped +2", caught: "Caught −10" };
  for (const ev of f.events) {
    const li = document.createElement("li");
    li.className = ev;
    li.textContent = `Ep ${f.episode} · step ${f.step} · ${names[ev] || ev}`;
    $("events").prepend(li);
    while ($("events").children.length > 30) $("events").lastChild.remove();
  }
  if (f.done) { for (const k in history) history[k].length = 0; mapTrail.length = 0; actTrail.length = 0; actAdv = null; }
}

// ---------- 연결 · 조작 ----------
function send(cmd, value) {
  if (local) local.command(cmd, value);
  else if (ws?.readyState === 1) ws.send(JSON.stringify({ cmd, value }));
}

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { $("status").textContent = "Connected"; };
  ws.onclose = () => { $("status").textContent = "Disconnected — retrying…"; setTimeout(connect, 1500); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "init") onInit(msg); else onFrame(msg);
  };
}

document.querySelectorAll("#mode button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#mode button").forEach((x) => x.classList.toggle("on", x === b));
  send("mode", b.dataset.mode);
  $("hint").style.display = b.dataset.mode === "human" ? "block" : "none";
}));
let paused = false;
$("pause").addEventListener("click", () => {
  paused = !paused;
  $("pause").textContent = paused ? "Play" : "Pause";
  send("pause", paused);
});
$("reset").addEventListener("click", () => send("reset"));
$("speed").addEventListener("change", (e) => send("speed", e.target.value));
$("level").addEventListener("change", (e) => send("level", e.target.value));
$("ghost")?.addEventListener("change", (e) => send("ghost", e.target.checked));
$("reflex")?.addEventListener("change", (e) => send("reflex", e.target.checked));

const KEYMAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", " ": "space" };
const keys = {};
for (const type of ["keydown", "keyup"]) {
  window.addEventListener(type, (e) => {
    const k = KEYMAP[e.key];
    if (!k) return;
    e.preventDefault();
    const v = type === "keydown" ? 1 : 0;
    if (keys[k] === v) return;
    keys[k] = v;
    send("keys", { [k]: v });
  });
}

async function startLocal() {
  const { LocalSession } = await import("./sim/local_session.js");
  const status = (s) => { $("status").textContent = s; };
  local = await LocalSession.create("data/", $("game"), status);
  try {
    wmMap = await fetch("data/wm_map.json").then((r) => r.json());
    // 축 이름과 그릴 범위 (배경 점의 1~99% 범위 + 여백)
    const corr = wmMap.axis_corr;
    wmMap.axis_names = [
      `PC1 · food nearby (r = ${corr["food odor"][0].toFixed(2)} with food odor)`,
      `PC2 · danger (r = ${corr.looming[1].toFixed(2)} looming, ${corr.value[1].toFixed(2)} value)`,
    ];
    const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
    const xs = wmMap.points.map((p) => p[0]), ys = wmMap.points.map((p) => p[1]);
    const [ax, bx, ay, by] = [q(xs, 0.01), q(xs, 0.99), q(ys, 0.01), q(ys, 0.99)];
    const mx = 0.08 * (bx - ax), my = 0.08 * (by - ay);
    wmMap.bounds = [ax - mx, bx + mx, ay - my, by + my];
    mapLegend();
  } catch (e) {
    console.warn("state map not available (web/data/wm_map.json)", e);
  }
  const msg = local.initMessage();
  onInit(msg);
  if (!msg.worldModel) $("wm-empty").textContent = "World model files not found (web/data/wm_*.onnx)";
  local.run(onFrame);
  status("");     // 로딩 문구만 쓰고, 실행 중에는 비움
}

if (document.body.dataset.source === "local") startLocal();
else connect();
