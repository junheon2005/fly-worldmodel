// 왼쪽 패널: 실제 뉴런 위치에 발화율을 색으로 표시하는 3D 점구름
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PAL, rgb, unit } from "./palette.js";

// 뉴런 묶음 → 색 규칙(palette.js)의 어느 뜻인지. 감각 뉴런은 그 감각의 색, 하행뉴런은 걷기(주황) 또는 점프(자홍)
const GROUP_ROLE = {
  in_odor_food: "food",
  in_odor_co2: "co2",
  in_looming: "pred",
  out_steer: "action",
  out_forward: "action",
  out_backward: "action",
  out_escape: "jump",
};
const byRole = (pal, f) => Object.fromEntries(Object.entries(GROUP_ROLE).map(([k, r]) => [k, f(pal[r])]));
export const GROUP_COLORS = byRole(PAL, unit);   // 3D 점: 밝은 배경이라 범례와 똑같은 색
export const GROUP_SWATCH = byRole(PAL, rgb);    // 범례·목록의 색 점
// 3D 뇌 지도 범례. 위 칸(State map) 범례와 같은 색은 같은 뜻이다
export const LEGEND = [
  ["Food odor ORN", rgb(PAL.food)],
  ["CO₂ ORN", rgb(PAL.co2)],
  ["Looming LPLC2/LC4 (predator)", rgb(PAL.pred)],
  ["Descending neurons (1,276) → walking actions", rgb(PAL.action)],
  ["Escape Giant Fiber (jump)", rgb(PAL.jump)],
  ["Middle neurons (13,144): pale green / yellow / red = wired mostly to that sense, gray = mixed", "#b9bec8"],
  ["more saturated / darker = more active", null],
];
export const GROUP_LABELS = {
  in_odor_food: "Food odor ORN",
  in_odor_co2: "CO₂ ORN",
  in_looming: "Looming LPLC2/LC4",
  out_steer: "Steering DNa01/02",
  out_forward: "Forward DNp09",
  out_backward: "Backward MDN",
  out_escape: "Escape Giant Fiber",
};
// 밝은 배경: 쉬는 뉴런은 옅게, 활발할수록 진하게.
const REST = [0.90, 0.91, 0.93];    // 쉬는 Middle 뉴런 (배경보다 조금 어두운 회색)
const BUSY = [0.40, 0.42, 0.47];    // 가장 활발한 Middle 뉴런 (색 뉴런보다 진해지지 않게 중간 회색까지만)
const TINT = 0.4;                   // 색 뉴런은 쉴 때도 자기 색이 40% 보인다
// Middle 뉴런: 입력의 70% 이상이 한 감각에서 오면(연결 기준, 4단계까지) 그 감각의 옅은 색으로 칠한다
const SENSE_COLORS = [PAL.food, PAL.co2, PAL.pred].map(unit), SENSE_NAMES = ["food odor", "CO₂", "looming"];
const LEAN = 0.7, MID_TINT = 0.18;  // 기울기 기준, 쉴 때 보이는 색의 정도

const vertexShader = `
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (3.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const fragmentShader = `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(vColor, a * 0.9);
  }`;

// 발화율 → 진하기. 색상은 뉴런의 역할만 나타내고, 얼마나 활발한지는 진하기로만 나타낸다
const glow = (r) => Math.pow(r, 0.6);

// onPick(i): 뉴런을 클릭하면 호출 (드래그로 회전할 때는 호출하지 않음)
export function createBrainView(container, tooltip, init, { onPick = null } = {}) {
  const n = init.n;
  // 배경은 투명하게 두고 #brain-view의 밝은 CSS 배경이 비치게 한다
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.01, 20);
  camera.position.set(0, 0, 1.9);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // 천천히 스스로 돈다 (한 바퀴 약 40초). 마우스를 올리면 멈춰서 뉴런 이름을 읽거나 직접 돌릴 수 있다
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.5;
  renderer.domElement.addEventListener("pointerenter", () => { controls.autoRotate = false; });
  renderer.domElement.addEventListener("pointerleave", () => { controls.autoRotate = true; });

  // FlyWire 좌표: x 오른쪽→왼쪽, y 아래, z 앞→뒤 → 화면 좌표로 뒤집기
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[3 * i] = init.pos[3 * i];
    pos[3 * i + 1] = -init.pos[3 * i + 1];
    pos[3 * i + 2] = -init.pos[3 * i + 2];
  }
  const base = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  // 색은 왼쪽 구조도의 세 층과 맞춘다: 감각 뉴런은 그 감각의 색, 하행뉴런(행동을 읽는 1,276개)은 걷기 색,
  // Giant Fiber는 점프 색, 나머지(Middle)는 회색
  const dnSet = new Set(init.readout?.neurons || []);
  const DN_COLOR = unit(PAL.action);
  const colored = new Uint8Array(n);
  const share = init.sense_share, lean = new Int8Array(n).fill(-1), leanPct = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const g = init.group[i];
    const isDN = dnSet.has(i) || init.super_class?.[i] === "descending";
    let c = GROUP_COLORS[g] || (isDN ? DN_COLOR : null);
    colored[i] = c ? 1 : 0;
    if (!c && share) {
      // Middle 뉴런: 가장 많이 닿는 감각과 그 비율
      const a = [share[3 * i], share[3 * i + 1], share[3 * i + 2]], tot = a[0] + a[1] + a[2];
      const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2, p = tot > 0.005 ? a[k] / tot : 0;
      if (p >= LEAN) {
        lean[i] = k;
        leanPct[i] = Math.round(p * 100);
        const w = 0.45 + 0.3 * ((p - LEAN) / (1 - LEAN));     // 많이 기울수록 색이 분명하게
        c = BUSY.map((v, ch) => v + (SENSE_COLORS[k][ch] - v) * w);
      }
    }
    base.set(c || BUSY, 3 * i);
    sizes[i] = 7;   // 모든 뉴런을 같은 크기로 (역할은 색으로만 구분)
  }
  // 그리는 순서: Middle(회색)을 먼저, 색 뉴런을 나중에 그려 회색 점에 덮이지 않게 한다
  const order = new Uint32Array(n);
  let w = 0;
  for (let i = 0; i < n; i++) if (!colored[i]) order[w++] = i;
  for (let i = 0; i < n; i++) if (colored[i]) order[w++] = i;
  const colors = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geo.setIndex(new THREE.BufferAttribute(order, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  let rates = new Uint8Array(n);

  // newRates: 발화율 (0~255)
  function update(newRates) {
    rates = newRates;
    for (let i = 0; i < n; i++) {
      const r = rates[i] / 255;
      const g = glow(r);
      // 감각·하행 뉴런은 옅은 자기 색 → 진한 자기 색, Middle 뉴런은 옅은 회색 → 중간 회색
      const t = colored[i] === 1 ? TINT + (1 - TINT) * g : lean[i] >= 0 ? MID_TINT + (1 - MID_TINT) * g : g;
      for (let k = 0; k < 3; k++) colors[3 * i + k] = REST[k] + (base[3 * i + k] - REST[k]) * t;
    }
    geo.attributes.color.needsUpdate = true;
    dirty = true;
  }

  // 마우스를 올리면 뉴런 이름·발화율 표시
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.015;
  const mouse = new THREE.Vector2();
  let hover = null;
  renderer.domElement.addEventListener("pointermove", (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  });
  renderer.domElement.addEventListener("pointerleave", () => { hover = null; tooltip.style.display = "none"; });

  // 클릭(거의 움직이지 않은 누름)이면 그 위치의 뉴런을 선택
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!onPick || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(m, camera);
    const hit = raycaster.intersectObject(points)[0];
    if (hit) onPick(hit.index);
  });

  function showTooltip() {
    if (!hover) return;
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObject(points)[0];
    if (!hit) { tooltip.style.display = "none"; return; }
    const i = hit.index;
    const name = init.cell_type[i] || "(unnamed)";
    tooltip.textContent = `${name} · ${init.side[i]} · ${init.super_class[i]} · rate ${(rates[i] / 255).toFixed(2)}` +
      (lean[i] >= 0 ? ` · ${leanPct[i]}% of its sensory input traces to ${SENSE_NAMES[lean[i]]}` : "");
    tooltip.style.left = `${hover.x + 12}px`;
    tooltip.style.top = `${hover.y + 12}px`;
    tooltip.style.display = "block";
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // 데이터가 바뀌었거나(update) 카메라가 움직일 때만 다시 그린다 (자동 회전은 초당 30번이면 충분)
  let dirty = true, lastRender = 0;
  controls.addEventListener("change", () => { dirty = true; });
  (function loop(t) {
    controls.update();
    if (hover) showTooltip();
    if (dirty || (controls.autoRotate && t - lastRender > 33)) {
      renderer.render(scene, camera);
      dirty = false;
      lastRender = t;
    }
    requestAnimationFrame(loop);
  })(0);

  update(rates);
  return { update, setAutoRotate: (on) => { controls.autoRotate = on; } };
}
