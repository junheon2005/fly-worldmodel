// 아레나를 캔버스에 그린다 (env/fly_arena.py의 render와 같은 모습)
import { ARENA, N_EYE } from "./arena.js";

export class ArenaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.bgKey = null;
    this.bg = document.createElement("canvas");
  }

  // 냄새 배경 (먹이 초록, CO2 노랑): 먹이·CO2 위치가 바뀔 때만 다시 계산
  background(env, size, scale) {
    const key = `${size}|${env.food}|${env.co2}`;
    if (key === this.bgKey) return;
    this.bgKey = key;
    const res = 160;                                   // 낮은 해상도로 계산 후 확대
    this.bg.width = this.bg.height = res;
    const g = this.bg.getContext("2d");
    const img = g.createImageData(res, res);
    const s = scale * (res / size);
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const wx = (x - res / 2) / s, wy = -(y - res / 2) / s;
        const k = 4 * (y * res + x);
        if (wx * wx + wy * wy > ARENA.radius ** 2) {
          img.data.set([12, 12, 12, 255], k);
          continue;
        }
        const food = Math.exp(-((wx - env.food[0]) ** 2 + (wy - env.food[1]) ** 2) / (2 * ARENA.foodSpread ** 2));
        const co2 = Math.exp(-((wx - env.co2[0]) ** 2 + (wy - env.co2[1]) ** 2) / (2 * ARENA.co2Spread ** 2));
        img.data.set([20 + 120 * co2, 20 + 70 * food + 110 * co2, 28 + 10 * food, 255], k);
      }
    }
    g.putImageData(img, 0, 0);
  }

  // ghostAge: 유령 경로(상상)가 몇 스텝 전 상태에서 시작했는지
  draw(env, { ghost = null, ghostAge = null } = {}) {
    const { canvas, ctx } = this;
    const size = canvas.width;
    const scale = size / (2 * ARENA.radius * 1.05);
    const px = (p) => [size / 2 + p[0] * scale, size / 2 - p[1] * scale];

    this.background(env, size, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bg, 0, 0, size, size);
    ctx.strokeStyle = "rgb(90,90,100)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(size / 2, size / 2, ARENA.radius * scale, 0, 2 * Math.PI); ctx.stroke();

    const circle = (p, r, color) => {
      const [x, y] = px(p);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, r * scale, 0, 2 * Math.PI); ctx.fill();
    };
    circle(env.food, ARENA.foodRadius, "rgb(60,220,90)");
    if (env.predator) circle(env.predator, ARENA.predatorRadius, "rgb(230,60,60)");

    // 유령 초파리: 상상 속 행동을 따라간 경로 (점선) + 끝 위치의 반투명 초파리
    if (ghost && ghost.length > 1) {
      ctx.strokeStyle = "rgba(140,220,255,0.75)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ghost.forEach((p, i) => { const [x, y] = px(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.setLineDash([]);
      ghost.forEach((p, i) => {          // 스텝마다 작은 점
        const [x, y] = px(p);
        ctx.fillStyle = `rgba(140,220,255,${0.25 + 0.5 * (i / ghost.length)})`;
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 2 * Math.PI); ctx.fill();
      });
      // 상상이 시작된 위치 (빈 원) + 몇 스텝 전인지
      const [sx, sy] = px(ghost[0]);
      ctx.strokeStyle = "rgba(140,220,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 2 * Math.PI); ctx.stroke();
      if (ghostAge != null) {
        ctx.fillStyle = "rgba(140,220,255,0.95)";
        ctx.font = "11px Consolas, monospace";
        const label = ghostAge === 0 ? "dream from now" : `dream from ${ghostAge} steps ago`;
        const tw = ctx.measureText(label).width;
        // 오른쪽·위가 화면 밖이면 반대쪽에 씀
        const lx = sx + 7 + tw > size - 4 ? sx - 7 - tw : sx + 7;
        const ly = sy - 6 < 30 ? sy + 14 : sy - 6;
        ctx.fillText(label, lx, ly);
      }
      const [gx, gy, gh] = ghost.at(-1);
      const gc = Math.cos(gh), gs = Math.sin(gh);
      const g = (f, l) => px([gx + f * gc - l * gs, gy + f * gs + l * gc]);
      ctx.fillStyle = "rgba(140,220,255,0.45)";
      ctx.beginPath();
      [g(4, 0), g(-3, 2.5), g(-3, -2.5)].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.fill();
    }

    // 초파리: 몸통 삼각형 + 더듬이
    const c = Math.cos(env.heading), s = Math.sin(env.heading);
    const at = (f, l) => px([env.pos[0] + f * c - l * s, env.pos[1] + f * s + l * c]);
    ctx.fillStyle = "rgb(240,200,80)";
    ctx.beginPath();
    [at(4, 0), at(-3, 2.5), at(-3, -2.5)].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.fill();
    ctx.strokeStyle = "rgb(240,240,240)";
    ctx.lineWidth = 1;
    for (const side of [1, -1]) {
      const [x0, y0] = at(3, 0), [x1, y1] = at(ARENA.antennaFwd, side * ARENA.antennaSide);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }

    // 상단: 좌/우 눈 접근신호
    const eyes = env.lastEyes || [];
    const w = Math.max(3, size / 80);
    eyes.forEach((v, i) => {
      const x = 10 + i * w + (i >= N_EYE ? 8 : 0);
      ctx.fillStyle = `rgb(${40 + 215 * v},40,40)`;
      ctx.fillRect(x, 10, w - 1, 12);
    });
    ctx.fillStyle = "rgb(230,230,230)";
    ctx.font = "13px Consolas, monospace";
    ctx.fillText(`score ${env.score}  step ${env.steps}${env.cooldown ? "  [jump cooldown]" : ""}`, 10, size - 10);
  }
}
