// 화면 전체가 함께 쓰는 색 규칙. 한 색은 어느 칸에서나 한 가지 뜻만 가진다.
//
//   food    초록   먹이 · 먹이 냄새     게임의 먹이, 감각 막대, 상태 지도 "near food", 먹이 냄새 뉴런
//   co2     노랑   CO2                 게임의 CO2 구름, 감각 막대, 상태 지도 "CO2", CO2 뉴런
//   pred    빨강   포식자 · 다가오는 물체  게임의 포식자, 눈 신호, 상태 지도 "predator", LPLC2/LC4 뉴런
//   calm    회색   특별한 감각이 없는 상태
//   real    검정   실제로 일어난 것      지금 위치, 지나온 경로, 실제 플레이에서 흐르는 화살표
//   dream   파랑   월드모델이 만든 것     상상한 앞날, 복원한 감각, 상상 모드에서 흐르는 화살표
//   action  주황   걷기 행동            회전·전진·후진과 그 하행뉴런
//   jump    자홍   점프 · 도망          점프 출력, Giant Fiber, 도망 성공 기록
//
// 값의 크기만 나타낼 때(발화율, 월드모델 내부 값)는 색을 쓰지 않고 회색 농도로만 그린다.
// 월드모델 = 보라, 뇌 = 청록은 구조 그림의 틀과 칸 제목에만 쓴다 (explorer.js, style.css).
export const PAL = {
  food: [63, 154, 82],
  co2: [179, 155, 20],
  pred: [214, 69, 69],
  calm: [120, 130, 150],
  real: [27, 30, 38],
  dream: [42, 120, 214],
  action: [224, 122, 44],
  jump: [190, 60, 150],
};

// 어두운 배경(게임 화면, 3D 뇌)에서는 같은 색상을 더 밝게 쓴다
export const PAL_DARK = {
  food: [70, 215, 105],
  co2: [225, 205, 70],
  pred: [240, 80, 80],
  calm: [150, 158, 175],
  real: [245, 246, 248],
  dream: [120, 175, 255],
  action: [245, 150, 70],
  jump: [240, 100, 200],
};

export const rgb = (c, a) => (a == null ? `rgb(${c.join(",")})` : `rgba(${c.join(",")},${a})`);
export const unit = (c) => c.map((v) => v / 255);

// 값 0~1을 옅은 회색 → 색 c로 (칸 채우기용)
export const PALE = [232, 234, 238];
export const shade = (c, t, from = PALE) => {
  const u = Math.min(1, Math.max(0, t || 0));
  return `rgb(${from.map((v, i) => Math.round(v + (c[i] - v) * u)).join(",")})`;
};

// CSS 변수(--food 등)도 여기 값으로 맞춘다. style.css의 :root에는 첫 화면용으로 같은 값이 적혀 있다
if (typeof document !== "undefined") {
  for (const [k, c] of Object.entries(PAL)) document.documentElement.style.setProperty(`--${k}`, rgb(c));
}
