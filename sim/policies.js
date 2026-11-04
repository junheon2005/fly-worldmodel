// 비교·시연용 규칙 기반 초파리 (env/check_env.py와 같은 규칙)
import { N_EYE } from "./arena.js";

function escape(obs, action) {
  let l = 0, r = 0;
  for (let i = 0; i < N_EYE; i++) { l = Math.max(l, obs[4 + i]); r = Math.max(r, obs[4 + N_EYE + i]); }
  if (Math.max(l, r) > 0.3) {
    action[1] = l > r ? -1 : 1;
    action[2] = Math.max(l, r) > 0.6 ? 1 : -1;
  }
  return action;
}

// 좌우 더듬이 냄새 비교로 회전
export function rulePolicy(obs) {
  const turn = 40 * (obs[0] - obs[1]) - 20 * (obs[2] - obs[3]);
  return escape(obs, [1, Math.max(-1, Math.min(1, turn)), -1]);
}

// 최근 window스텝 동안 좋은 냄새가 진해졌으면 직진, 옅어졌으면 회전 (klinotaxis)
export class KlinotaxisPolicy {
  constructor({ turn = 1, slowForward = 0.1, window = 3 } = {}) {
    Object.assign(this, { turn, slowForward, window });
    this.history = [];
  }
  reset() { this.history = []; }
  act(obs) {
    const util = (obs[0] + obs[1]) / 2 - 0.7 * (obs[2] + obs[3]) / 2;
    this.history = [...this.history, util].slice(-(this.window + 1));
    const rising = util >= this.history[0];
    return escape(obs, rising ? [1, 0, -1] : [this.slowForward, this.turn, -1]);
  }
}
