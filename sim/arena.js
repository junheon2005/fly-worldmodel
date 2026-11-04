// 2D 초파리 아레나 (브라우저용). env/fly_arena.py와 같은 규칙.
//
// 관측 36개: [먹이냄새 L, R, CO2 L, R, 왼눈 접근신호 × 16, 오른눈 × 16]
// 행동 3개 (−1~1): [전진(음수 후진), 회전(+왼쪽), 점프(0.5 이상 발동)]
// 단위: 거리 mm, 시간 s

export const N_EYE = 16;
export const LEVELS = { 0: [0.0, 0.0], 1: [15.0, 0.008], 2: [35.0, 0.015] }; // (포식자 속도, 등장 확률)

const P = {
  radius: 100, dt: 0.1, maxSteps: 600,
  walkSpeed: 20, turnSpeed: Math.PI, antennaFwd: 2.0, antennaSide: 2.5,
  jumpDist: 25, jumpCooldown: 10,
  foodSpread: 45, co2Spread: 20, foodRadius: 5,
  predatorRadius: 6, predatorLifetime: 60, loomingGain: 4,
};

const mod = (a, n) => ((a % n) + n) % n;
const clip = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const gauss = (p, src, spread) => Math.exp(-((p[0] - src[0]) ** 2 + (p[1] - src[1]) ** 2) / (2 * spread * spread));

// 시드 고정 난수 (mulberry32) + 정규분포 (Box-Muller)
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (mu, sd) => mu + sd * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  return { random, normal };
}

export class FlyArena {
  constructor({ level = 2, rng = seededRng(Date.now()) } = {}) {
    this.rng = rng;
    this.setLevel(level);
  }

  setLevel(level) {
    this.level = level;
    [this.predatorSpeed, this.predatorSpawnProb] = LEVELS[level];
  }

  randomPoint(maxR) {
    const r = maxR * Math.sqrt(this.rng.random());
    const a = this.rng.random() * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a)];
  }

  antennae() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const fx = this.pos[0] + P.antennaFwd * c, fy = this.pos[1] + P.antennaFwd * s;
    return [
      [fx - P.antennaSide * s, fy + P.antennaSide * c],   // 왼쪽
      [fx + P.antennaSide * s, fy - P.antennaSide * c],   // 오른쪽
    ];
  }

  odor() {
    const [l, r] = this.antennae();
    return [
      gauss(l, this.food, P.foodSpread), gauss(r, this.food, P.foodSpread),
      gauss(l, this.co2, P.co2Spread), gauss(r, this.co2, P.co2Spread),
    ];
  }

  // 포식자의 시야각 확장 속도를 좌/우 눈 칸에 표시 (LPLC2/LC4가 반응하는 신호)
  looming() {
    const eyes = new Array(2 * N_EYE).fill(0);
    if (!this.predator) { this.prevAlpha = null; return eyes; }
    const rx = this.predator[0] - this.pos[0], ry = this.predator[1] - this.pos[1];
    const dist = Math.max(Math.hypot(rx, ry), 1e-3);
    const alpha = Math.asin(Math.min(1, P.predatorRadius / dist));
    const prev = this.prevAlpha == null ? alpha : this.prevAlpha;
    this.prevAlpha = alpha;
    const expansion = Math.min(1, Math.max(0, ((alpha - prev) / P.dt) * P.loomingGain));
    if (expansion === 0) return eyes;
    const bearing = mod(Math.atan2(ry, rx) - this.heading + Math.PI, 2 * Math.PI) - Math.PI;
    const w = Math.PI / N_EYE;
    [[0, 1], [1, -1]].forEach(([eye, sign]) => {
      const lo = sign * bearing - alpha, hi = sign * bearing + alpha;
      for (let i = 0; i < N_EYE; i++) {
        if ((i + 1) * w > lo && i * w < hi) eyes[eye * N_EYE + i] = expansion;
      }
    });
    return eyes;
  }

  observe() {
    this.lastEyes = this.looming();
    const o = [...this.odor(), ...this.lastEyes];
    return Float32Array.from(o, (x) => clip(x + this.rng.normal(0, 0.005), 0, 1));
  }

  reset() {
    this.pos = this.randomPoint(P.radius * 0.6);
    this.heading = this.rng.random() * 2 * Math.PI;
    this.food = this.randomPoint(P.radius * 0.8);
    this.co2 = this.randomPoint(P.radius * 0.7);
    this.predator = null;
    this.predatorAge = 0;
    this.prevAlpha = null;
    this.cooldown = 0;
    this.steps = 0;
    this.score = 0;
    this.events = [];
    this.lastAction = [0, 0, 0];
    this.prevFoodOdor = gauss(this.pos, this.food, P.foodSpread);
    this.obs = this.observe();
    return this.obs;
  }

  step(action) {
    const [forward, turn, jump] = Array.from(action, (x) => clip(x, -1, 1));
    this.lastAction = [forward, turn, jump];
    let reward = 0, terminated = false;
    this.events = [];

    // 이동
    this.heading = mod(this.heading + turn * P.turnSpeed * P.dt, 2 * Math.PI);
    let stepLen = forward * P.walkSpeed * P.dt;
    if (forward < 0) stepLen *= 0.4;                       // 후진은 느림
    const jumped = jump > 0.5 && this.cooldown === 0;
    if (jumped) {
      stepLen = P.jumpDist;
      this.cooldown = P.jumpCooldown;
      reward -= 0.5;                                       // 점프는 에너지가 많이 듦
    }
    this.cooldown = Math.max(0, this.cooldown - 1);
    this.pos = [this.pos[0] + stepLen * Math.cos(this.heading), this.pos[1] + stepLen * Math.sin(this.heading)];
    const r = Math.hypot(this.pos[0], this.pos[1]);
    if (r > P.radius) this.pos = [this.pos[0] * P.radius / r, this.pos[1] * P.radius / r];
    reward -= 0.01 * Math.abs(forward);

    // 먹이: 가까워지면 보상(냄새 증가량), 도착하면 큰 보상 후 새 위치
    let foodOdor = gauss(this.pos, this.food, P.foodSpread);
    reward += 5 * (foodOdor - this.prevFoodOdor);
    if (Math.hypot(this.pos[0] - this.food[0], this.pos[1] - this.food[1]) < P.foodRadius) {
      reward += 10;
      this.score += 1;
      this.events.push("food");
      this.food = this.randomPoint(P.radius * 0.8);
      foodOdor = gauss(this.pos, this.food, P.foodSpread);
    }
    this.prevFoodOdor = foodOdor;

    // CO2: 진한 곳에 있으면 벌점
    reward -= 0.3 * gauss(this.pos, this.co2, P.co2Spread);

    // 포식자
    if (!this.predator) {
      if (this.steps > 30 && this.rng.random() < this.predatorSpawnProb) {
        const a = this.rng.random() * 2 * Math.PI;
        this.predator = [this.pos[0] + 70 * Math.cos(a), this.pos[1] + 70 * Math.sin(a)];
        this.predatorAge = 0;
        this.prevAlpha = null;
      }
    } else {
      this.predatorAge += 1;
      const rx = this.predator[0] - this.pos[0], ry = this.predator[1] - this.pos[1];
      const dist = Math.hypot(rx, ry);
      if (jumped && dist < 30) {
        reward += 2;                                       // 제때 도망침
        this.events.push("escaped");
        this.predator = null;
      } else if (dist < P.predatorRadius + 1.5) {
        reward -= 10;
        this.events.push("caught");
        terminated = true;
      } else if (this.predatorAge > P.predatorLifetime) {
        this.predator = null;
      } else {
        const k = (this.predatorSpeed * P.dt) / dist;
        this.predator = [this.predator[0] - rx * k, this.predator[1] - ry * k];
      }
    }

    this.steps += 1;
    const truncated = this.steps >= P.maxSteps;
    this.obs = this.observe();
    return { obs: this.obs, reward, terminated, truncated, events: this.events, score: this.score };
  }
}

export const ARENA = P;
