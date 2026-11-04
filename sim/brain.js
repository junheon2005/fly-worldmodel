// 커넥톰 뇌 시뮬레이션 (브라우저용). flybrain/connectome_rnn.py의 step()과 같은 계산.
//
//   감각 = 관측 + 적응세기 × (관측 − 적응기준) [냄새 칸만], 0 이상
//   감각뉴런 입력 = 감각 × 입력가중치
//   substeps번:  rate = tanh(relu(v))
//               v += alpha × (−v + Σ rate[pre]·w + 감각뉴런입력 + bias)
//   행동 출력 = 하행뉴런 rate × readout
//
// 가중치는 flybrain/export_web.py가 미리 계산해 둔 web/data/brain.bin을 쓴다.

export class FlyBrain {
  static async load(base = "data/") {
    const [meta, buf] = await Promise.all([
      fetch(base + "brain.json").then((r) => r.json()),
      fetch(base + "brain.bin").then((r) => r.arrayBuffer()),
    ]);
    return new FlyBrain(meta, buf);
  }

  constructor(meta, buf) {
    this.meta = meta;
    this.n = meta.n;
    this.obsDim = meta.obs_dim;
    this.actDim = meta.act_dim;
    this.substeps = meta.substeps;
    this.adaptRate = meta.adapt_rate;
    this.adaptGain = meta.adapt_gain;
    const view = (name) => {
      const a = meta.arrays[name];
      const len = a.shape.reduce((x, y) => x * y, 1);
      const Type = a.dtype === "int32" ? Int32Array : Float32Array;
      return new Type(buf, a.offset, len);
    };
    for (const name of Object.keys(meta.arrays)) this[name] = view(name);
    this.nIn = this.in_neurons.length;
    this.nRead = this.readout_neurons.length;

    this.v = new Float32Array(this.n);           // 막전위
    this.adapted = new Float32Array(this.obsDim); // 냄새 적응 기준값
    this.rate = new Float32Array(this.n);
    this.ext = new Float32Array(this.n);          // 감각뉴런 외부 입력
    this.sensed = new Float32Array(this.obsDim);
    this.out = new Float32Array(this.actDim);
    this.clamp = new Float32Array(this.n).fill(NaN); // 뉴런 강제 설정 (NaN = 자유)
    // 반사 점프 (실험용, 기본 끔): 점프 출력을 학습된 변환 대신 Giant Fiber(DNp01) 발화율로 정한다.
    // 실제 초파리 회로(Giant Fiber → 점프)에 근거하지만, Python 학습·평가·월드모델 학습에는 쓰이지 않았다.
    // 끄면 Python 뇌와 같은 행동(tanh(출력))을 낸다.
    this.gfJump = false;
    this.gfThreshold = 0.25;
    this.giantFiber = Int32Array.from(meta.groups.out_escape);
  }

  reset() {
    this.v.fill(0);
    this.adapted.fill(0);
    this.rate.fill(0);
  }

  // 상태 저장/복원 (상상 롤아웃용)
  getState() {
    return { v: this.v.slice(), adapted: this.adapted.slice() };
  }
  setState(s) {
    this.v.set(s.v);
    this.adapted.set(s.adapted);
  }

  step(obs) {
    const { n, v, rate, ext, sensed, ptr, col, val, alpha, bias, clamp } = this;

    // 1) 냄새 적응
    for (let j = 0; j < this.obsDim; j++) {
      const o = obs[j];
      let s = o + this.adaptGain * (o - this.adapted[j]) * this.adapt_mask[j];
      sensed[j] = s > 0 ? s : 0;
      this.adapted[j] += this.adaptRate * (o - this.adapted[j]);
    }
    // 2) 감각뉴런 입력
    ext.fill(0);
    for (let k = 0; k < this.nIn; k++) {
      let d = 0;
      const row = k * this.obsDim;
      for (let j = 0; j < this.obsDim; j++) d += sensed[j] * this.in_w[row + j];
      ext[this.in_neurons[k]] = d;
    }
    // 3) 뉴런 동역학
    for (let s = 0; s < this.substeps; s++) {
      for (let i = 0; i < n; i++) rate[i] = v[i] > 0 ? Math.tanh(v[i]) : 0;
      for (let i = 0; i < n; i++) {
        let syn = 0;
        for (let k = ptr[i], end = ptr[i + 1]; k < end; k++) syn += rate[col[k]] * val[k];
        v[i] += alpha[i] * (-v[i] + syn + ext[i] + bias[i]);
        if (clamp[i] === clamp[i]) v[i] = clamp[i];   // NaN이 아니면 강제값
      }
    }
    for (let i = 0; i < n; i++) rate[i] = v[i] > 0 ? Math.tanh(v[i]) : 0;
    // 4) 하행뉴런 → 행동
    for (let a = 0; a < this.actDim; a++) {
      let o = this.readout_b[a];
      const row = a * this.nRead;
      for (let k = 0; k < this.nRead; k++) o += rate[this.readout_neurons[k]] * this.readout_w[row + k];
      this.out[a] = o;
    }
    return { out: this.out, rate };
  }

  // Giant Fiber 중 가장 강한 발화율
  giantFiberRate() {
    let m = 0;
    for (const i of this.giantFiber) m = Math.max(m, this.rate[i]);
    return m;
  }

  // 행동 값 (−1~1). 점프 칸은 Giant Fiber가 문턱값을 넘으면 0.5 이상이 되도록
  action() {
    const a = Array.from(this.out, Math.tanh);
    if (this.gfJump) a[2] = Math.max(-1, Math.min(1, 0.5 + 6 * (this.giantFiberRate() - this.gfThreshold)));
    return a;
  }
}
