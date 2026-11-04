// 왼쪽 패널: 실제 뉴런 위치에 발화율을 색으로 표시하는 3D 점구름
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export const GROUP_COLORS = {
  in_odor_food: [0.30, 0.77, 0.42],
  in_odor_co2: [0.78, 0.75, 0.25],
  in_looming: [0.29, 0.56, 0.89],
  out_steer: [0.94, 0.54, 0.24],
  out_forward: [0.70, 0.45, 0.95],
  out_backward: [0.65, 0.45, 0.30],
  out_escape: [0.95, 0.30, 0.30],
};
export const GROUP_LABELS = {
  in_odor_food: "Food odor ORN",
  in_odor_co2: "CO₂ ORN",
  in_looming: "Looming LPLC2/LC4",
  out_steer: "Steering DNa01/02",
  out_forward: "Forward DNp09",
  out_backward: "Backward MDN",
  out_escape: "Escape Giant Fiber",
};
const BASE = [0.55, 0.6, 0.7];

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
    gl_FragColor = vec4(vColor, a * 0.85);
  }`;

// 발화율 → 색: 어두운 회색 → 주황 → 노랑 → 흰색
function heat(r) {
  if (r < 0.33) { const t = r / 0.33; return [0.9 * t, 0.35 * t, 0.05 * t]; }
  if (r < 0.66) { const t = (r - 0.33) / 0.33; return [0.9 + 0.1 * t, 0.35 + 0.5 * t, 0.05 + 0.05 * t]; }
  const t = (r - 0.66) / 0.34; return [1, 0.85 + 0.15 * t, 0.1 + 0.9 * t];
}

// onPick(i): 뉴런을 클릭하면 호출 (드래그로 회전할 때는 호출하지 않음)
export function createBrainView(container, tooltip, init, { onPick = null } = {}) {
  const n = init.n;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.01, 20);
  camera.position.set(0, 0, 1.9);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = false;   // 정면 고정. 마우스로 드래그하면 직접 돌릴 수 있음
  controls.autoRotateSpeed = 0.6;

  // FlyWire 좌표: x 오른쪽→왼쪽, y 아래, z 앞→뒤 → 화면 좌표로 뒤집기
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[3 * i] = init.pos[3 * i];
    pos[3 * i + 1] = -init.pos[3 * i + 1];
    pos[3 * i + 2] = -init.pos[3 * i + 2];
  }
  const base = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = init.group[i];
    const c = GROUP_COLORS[g] || BASE;
    base.set(c, 3 * i);
    sizes[i] = g.startsWith("out_") ? 55 : g ? 11 : 7;
  }
  const colors = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  let rates = new Uint8Array(n);

  // newRates: 발화율 (0~255)
  // diffFrom: 주면 (newRates − diffFrom)을 빨강(증가)/파랑(감소)으로 표시 (꿈 − 실제 비교)
  // clamped:  [[뉴런, 값], ...] 강제로 켠(하늘색)/끈(보라색) 뉴런
  function update(newRates, { diffFrom = null, clamped = [] } = {}) {
    rates = newRates;
    if (diffFrom) {
      for (let i = 0; i < n; i++) {
        const d = (newRates[i] - diffFrom[i]) / 255;
        const m = Math.min(1, Math.abs(d) * 3);
        const c = d > 0 ? [1, 0.35, 0.2] : [0.25, 0.55, 1];
        for (let k = 0; k < 3; k++) colors[3 * i + k] = base[3 * i + k] * 0.05 + c[k] * m;
      }
      markClamped(clamped);
      geo.attributes.color.needsUpdate = true;
      dirty = true;
      return;
    }
    for (let i = 0; i < n; i++) {
      const r = rates[i] / 255;
      const h = heat(r);
      const isGroup = init.group[i] !== "";
      // 일반 뉴런은 흐리게, 입출력 뉴런은 자기 색으로 밝아지게
      for (let k = 0; k < 3; k++) {
        colors[3 * i + k] = isGroup
          ? base[3 * i + k] * (0.35 + 1.4 * r) + h[k] * 0.3
          : base[3 * i + k] * 0.06 + h[k] * 0.45;
      }
    }
    markClamped(clamped);
    geo.attributes.color.needsUpdate = true;
    dirty = true;
  }

  function markClamped(clamped) {
    for (const [i, v] of clamped) colors.set(v > 0 ? [0.55, 0.95, 1] : [0.6, 0.3, 0.9], 3 * i);
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
    tooltip.textContent = `${name} · ${init.side[i]} · ${init.super_class[i]} · rate ${(rates[i] / 255).toFixed(2)}`;
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
