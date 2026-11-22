// 월드모델 계산 화면용: 각 층의 중간값을 가중치로 다시 계산한다 (worldmodel/rssm.py와 같은 계산).
// 실제 실행은 ONNX가 하고, 이 파일은 화면에 "입력 × 가중치 + 편향 = 출력"을 실제 값으로 보여 주기 위한 것이다.
// 가중치: worldmodel/export_weights.py가 만든 web/data/wm_weights.bin (float16)
//
// 표기 (RSSM 논문): o_t 관측, a_t 행동, h_t 결정적 상태(GRU), z_t 확률적 상태(사후), ẑ_t 사전,
//                   e_t 인코더 출력, ô_t 복원 관측, r̂_t 보상 예측

function halfToFloat(u16) {
  const out = new Float32Array(u16.length);
  const exp = new Float32Array(32);
  for (let e = 0; e < 32; e++) exp[e] = Math.pow(2, e - 15);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    out[i] = e === 0 ? s * m * 5.960464477539063e-8 : e === 31 ? (m ? NaN : s * Infinity) : s * exp[e] * (1 + m / 1024);
  }
  return out;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const silu = (x) => x * sigmoid(x);

export class WMExplain {
  static async load(base = "data/") {
    try {
      const [meta, buf] = await Promise.all([
        fetch(base + "wm_weights.json").then((r) => (r.ok ? r.json() : null)),
        fetch(base + "wm_weights.bin").then((r) => (r.ok ? r.arrayBuffer() : null)),
      ]);
      return meta && buf ? new WMExplain(meta, buf) : null;
    } catch {
      return null;
    }
  }

  constructor(meta, buf) {
    this.meta = meta;
    this.eps = meta.ln_eps;
    this.G = meta.groups;
    this.C = meta.classes;
    this.bins = Float32Array.from(meta.twohot_bins);
    this.W = {};
    for (const [name, a] of Object.entries(meta.arrays)) {
      const len = a.shape.reduce((x, y) => x * y, 1);
      const data = halfToFloat(new Uint16Array(buf, a.offset, len));
      this.W[name] = { data, rows: a.shape[0], cols: a.shape[1] || 1, name };
    }
    // GRU 가중치는 [reset; update; candidate] 세 덩어리를 따로 보여 준다
    for (const part of ["ih", "hh"]) {
      const w = this.W[`gru.weight_${part}`], b = this.W[`gru.bias_${part}`], D = w.rows / 3;
      ["r", "u", "n"].forEach((g, k) => {
        this.W[`gru.${g}_${part}`] = { data: w.data.subarray(k * D * w.cols, (k + 1) * D * w.cols), rows: D, cols: w.cols, name: `gru.${g}_${part}` };
        this.W[`gru.b${g}_${part}`] = { data: b.data.subarray(k * D, (k + 1) * D), rows: D, cols: 1, name: `gru.b${g}_${part}` };
      });
    }
  }

  // y = W x + b
  linear(name, x) {
    const W = this.W[`${name}.weight`], b = this.W[`${name}.bias`];
    return this.affine(W, x, b);
  }
  affine(W, x, b) {
    const y = new Float32Array(W.rows);
    for (let j = 0; j < W.rows; j++) {
      let s = b ? b.data[j] : 0;
      const row = j * W.cols;
      for (let i = 0; i < W.cols; i++) s += W.data[row + i] * x[i];
      y[j] = s;
    }
    return y;
  }
  lnSilu(name, x) {
    const g = this.W[`${name}.weight`].data, b = this.W[`${name}.bias`].data, n = x.length;
    let m = 0;
    for (let i = 0; i < n; i++) m += x[i];
    m /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (x[i] - m) ** 2;
    const inv = 1 / Math.sqrt(v / n + this.eps);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = silu((x[i] - m) * inv * g[i] + b[i]);
    return y;
  }
  // mlp(): [Linear → LayerNorm → SiLU] × layers → Linear. 층마다 (선형 출력, 활성화 출력)을 돌려준다
  mlp(name, x, layers) {
    const steps = [];
    let cur = x;
    for (let l = 0; l < layers; l++) {
      const pre = this.linear(`${name}.${3 * l}`, cur);
      const post = this.lnSilu(`${name}.${3 * l + 1}`, pre);
      steps.push({ input: cur, W: this.W[`${name}.${3 * l}.weight`], b: this.W[`${name}.${3 * l}.bias`], pre, post });
      cur = post;
    }
    const out = this.linear(`${name}.${3 * layers}`, cur);
    steps.push({ input: cur, W: this.W[`${name}.${3 * layers}.weight`], b: this.W[`${name}.${3 * layers}.bias`], pre: out, post: out });
    return steps;
  }
  // 범주 16×16: 그룹별 softmax, 균등분포 1% 섞기 (unimix)
  categorical(logits) {
    const p = new Float32Array(logits.length), u = this.meta.unimix;
    for (let g = 0; g < this.G; g++) {
      let mx = -Infinity;
      for (let c = 0; c < this.C; c++) mx = Math.max(mx, logits[g * this.C + c]);
      let s = 0;
      for (let c = 0; c < this.C; c++) s += (p[g * this.C + c] = Math.exp(logits[g * this.C + c] - mx));
      for (let c = 0; c < this.C; c++) p[g * this.C + c] = (1 - u) * (p[g * this.C + c] / s) + u / this.C;
    }
    return p;
  }
  argmax(p) {
    const z = new Float32Array(p.length);
    for (let g = 0; g < this.G; g++) {
      let k = 0;
      for (let c = 1; c < this.C; c++) if (p[g * this.C + c] > p[g * this.C + k]) k = c;
      z[g * this.C + k] = 1;
    }
    return z;
  }

  // ---------- 층별 계산 ----------
  // 인코더: e_t = enc(o_t)
  encoder(o) {
    return this.mlp("encoder", Float32Array.from(o), 2);
  }

  // 결정적 상태 (GRU): h_t = f(h_{t−1}, z_{t−1}, a_{t−1})
  sequence(hPrev, zPrev, aPrev) {
    const inp = new Float32Array(zPrev.length + aPrev.length);
    inp.set(zPrev); inp.set(aPrev, zPrev.length);
    const pre = this.linear("img_in.0", inp), x = this.lnSilu("img_in.1", pre);
    const W = this.W, D = hPrev.length;
    const gi = (g) => this.affine(W[`gru.${g}_ih`], x, W[`gru.b${g}_ih`]);
    const gh = (g) => this.affine(W[`gru.${g}_hh`], hPrev, W[`gru.b${g}_hh`]);
    const ir = gi("r"), hr = gh("r"), iu = gi("u"), hu = gh("u"), inn = gi("n"), hn = gh("n");
    const r = new Float32Array(D), u = new Float32Array(D), n = new Float32Array(D), h = new Float32Array(D);
    for (let j = 0; j < D; j++) {
      r[j] = sigmoid(ir[j] + hr[j]);
      u[j] = sigmoid(iu[j] + hu[j]);
      n[j] = Math.tanh(inn[j] + r[j] * hn[j]);
      h[j] = (1 - u[j]) * n[j] + u[j] * hPrev[j];
    }
    return { inp, pre, x, hPrev: Float32Array.from(hPrev), r, u, n, h, hn, oneMinusU: u.map((v) => 1 - v) };
  }

  // 사전 ẑ_t ~ p(ẑ_t | h_t)
  prior(h) {
    const steps = this.mlp("prior_net", Float32Array.from(h), 1);
    const probs = this.categorical(steps[1].pre);
    return { steps, probs, z: this.argmax(probs) };
  }

  // 사후 z_t ~ q(z_t | h_t, e_t)
  posterior(h, e) {
    const inp = new Float32Array(h.length + e.length);
    inp.set(h); inp.set(e, h.length);
    const steps = this.mlp("post_net", inp, 1);
    const probs = this.categorical(steps[1].pre);
    return { steps, probs, z: this.argmax(probs) };
  }

  feat(h, z) {
    const f = new Float32Array(h.length + z.length);
    f.set(h); f.set(z, h.length);
    return f;
  }

  // 복원 관측 ô_t = dec(h_t, z_t), 0~1로 자름
  decoder(h, z) {
    const steps = this.mlp("decoder", this.feat(h, z), 2);
    const recon = steps[2].pre.map((v) => Math.min(1, Math.max(0, v)));
    return { steps, recon };
  }

  // 보상 예측 r̂_t = symexp(Σ_k softmax(ℓ^r)_k · β_k)
  reward(h, z) { return this.twohotHead("reward_head", h, z); }
  // 앞으로 받을 보상 합(return) 예측 R̂_t = symexp(Σ_k softmax(ℓ^R)_k · β_k). critic 망 (에이전트 쪽, 상상 속에서 학습)
  ret(h, z) { return this.twohotHead("critic", h, z); }
  // 두 은닉층 MLP → 255 구간 logits → 확률 → symlog 평균 → symexp
  twohotHead(name, h, z) {
    const steps = this.mlp(name, this.feat(h, z), 2);
    const logits = steps[2].pre;
    let mx = -Infinity;
    for (const v of logits) mx = Math.max(mx, v);
    const p = logits.map((v) => Math.exp(v - mx));
    const s = p.reduce((a, b) => a + b, 0);
    let m = 0;
    for (let k = 0; k < p.length; k++) { p[k] /= s; m += p[k] * this.bins[k]; }
    const value = Math.sign(m) * (Math.exp(Math.abs(m)) - 1);
    return { steps, probs: p, mean: m, value };
  }
}
