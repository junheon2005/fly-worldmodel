// 범례 창: 머리줄의 "Legend" 단추를 누르면 뜬다. 색 · 왼쪽 그림 · 계산 화면 · 3D 뇌 · 게임 · 기호를 한곳에 모았다.
// 색은 palette.js에서 가져와 "한 색 = 한 뜻" 규칙이 화면과 똑같이 보이게 한다.
// 기호 표는 explorer.js의 계산 화면 표기와 같아야 한다 (한 기호 = 한 뜻).
import { PAL, rgb } from "./palette.js";

const COLORS = [
  [PAL.real, "Real: what actually happened (now, the path so far). Arrows in real play."],
  [PAL.dream, "Made by the world model: imagination, reconstruction ô<sub>t</sub>, predictions. Arrows while imagining."],
  [PAL.food, "Food · food odor"],
  [PAL.co2, "CO₂"],
  [PAL.pred, "Predator · approaching object (looming)"],
  [PAL.action, "Walking actions and the descending neurons that drive them"],
  [PAL.jump, "Jump · escape (Giant Fiber)"],
  [PAL.calm, "No particular sense (calm)"],
];

// [기호(KaTeX), 뜻]. 뜻은 지금은 한국어로 적는다
const WM_SYMBOLS = [
  ["o_t", "관측: 36개 값 (먹이 냄새 왼쪽·오른쪽, CO₂ 왼쪽·오른쪽, 왼눈 16칸 + 오른눈 16칸)"],
  ["\\hat o_t", "복원한 관측 (Decoder 출력)"],
  ["a_t", "행동: 전진, 회전, 점프"],
  ["r_t,\\ \\hat r_t", "실제 보상, 예측한 보상 (Reward 헤드)"],
  ["\\hat R_t", "예측한 return: 지금부터 앞으로 받을 보상의 합 (Return 헤드, critic)"],
  ["e_t", "인코더 출력"],
  ["h_t", "결정적 상태: GRU의 기억 (256개 값)"],
  ["z_t", "확률적 상태: 16개 그룹 × 16개 범주, 그룹마다 범주 하나"],
  ["\\hat z_t", "관측 없이 사전 분포(prior)가 추측한 z<sub>t</sub>"],
  ["p(\\hat z_t\\mid h_t)", "사전 분포 (prior): h<sub>t</sub>만 보고 z<sub>t</sub>를 추측"],
  ["q(z_t\\mid h_t,e_t)", "사후 분포 (posterior): e<sub>t</sub>를 통해 관측까지 보고 z<sub>t</sub>를 정함"],
  ["g_t", "GRU 입력: [z<sub>t−1</sub>; a<sub>t−1</sub>]으로 만듦"],
  ["\\Gamma_u,\\ \\Gamma_r", "GRU 업데이트 게이트, 리셋 게이트"],
  ["\\tilde h_t", "GRU 후보 상태"],
  ["W^{m}_{k},\\ b^{m}_{k}", "모듈 m의 k번째 층 가중치와 편향 (m: e 인코더, d 디코더, p 사전, q 사후, r 보상, R return / GRU 안에서는 g, u, r, c)"],
  ["y^{m}_{k}\\to x^{m}_{k}", "한 층의 값: LN · SiLU 전 → 후"],
  ["\\ell^{r},\\ \\ell^{R}", "255개 구간 각각의 점수 (보상, return)"],
  ["\\beta_k", "symlog 눈금 위의 구간 중심값. 구간 확률로 낸 평균을 symexp로 원래 크기로 되돌림"],
  ["\\mathrm{LN},\\ \\mathrm{SiLU},\\ \\sigma,\\ \\odot", "LayerNorm(정규화), SiLU(y) = y·σ(y), 시그모이드, 원소끼리 곱"],
];
const BRAIN_SYMBOLS = [
  ["\\kappa", "적응 세기: 냄새 4칸은 8, 나머지는 0"],
  ["c_t", "입력의 최근 평균 (적응에 씀)"],
  ["s_t", "적응을 거친 감각 입력"],
  ["U,\\ M", "입력 가중치, 각 감각이 자기 뉴런에만 닿게 하는 연결 허용 표(mask)"],
  ["I_t", "감각뉴런 580개로 들어가는 입력"],
  ["W", "FlyWire 연결, 15,000 × 15,000 (0이 아닌 연결 382,539개)"],
  ["\\rho_t", "발화율, 0~1"],
  ["\\theta", "기저 입력, 세포 종류마다 하나"],
  ["u_t", "각 뉴런으로 들어오는 입력의 합"],
  ["v", "막전위"],
  ["\\alpha", "새는 정도(leak), 세포 종류마다 하나"],
  ["\\rho_{\\mathrm{DN}}", "하행뉴런 1,276개의 발화율"],
  ["B,\\ d", "읽기 가중치와 편향: 하행뉴런 → 행동"],
  ["m_t", "tanh 전의 운동 출력"],
];

const tex = (el, s) => {
  if (window.katex) window.katex.render(s, el, { throwOnError: false });
  else el.textContent = s;
};
const symRows = (list) => list.map(([s, d]) => `<div class="lg-tex" data-tex="${s.replace(/"/g, "&quot;")}"></div><div>${d}</div>`).join("");

export function setupLegend() {
  const btn = document.getElementById("legend-btn"), dlg = document.getElementById("legend-dlg");
  if (!btn || !dlg) return;
  document.getElementById("lg-colors").innerHTML =
    COLORS.map(([c, d]) => `<div class="lg-row"><i class="lg-sw" style="background:${rgb(c)}"></i><span>${d}</span></div>`).join("");
  document.getElementById("lg-sym-wm").innerHTML = symRows(WM_SYMBOLS);
  document.getElementById("lg-sym-br").innerHTML = symRows(BRAIN_SYMBOLS);
  let rendered = false;
  btn.addEventListener("click", () => {
    if (!rendered && window.katex) {        // KaTeX는 늦게 불러오므로 처음 열 때 기호를 그린다
      for (const el of dlg.querySelectorAll("[data-tex]")) tex(el, el.dataset.tex);
      rendered = true;
    }
    dlg.showModal();
    btn.blur();
  });
  dlg.querySelector(".lg-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });   // 창 바깥(어두운 바탕)을 누르면 닫힘
}
