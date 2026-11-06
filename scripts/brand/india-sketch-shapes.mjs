// Line-art Indian monuments and everyday icons for the launch intro, drawn as polylines so each stroke's length is
// known (the intro draws every stroke like a pencil). Each shape sits in its own box: origin at the bottom centre,
// y grows downwards, so things above the baseline have negative y.

const arc = (cx, cy, r, a0, a1, n = 18) => Array.from({ length: n + 1 }, (_, i) => {
  const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const line = (...p) => p;

// Onion dome: base width w at y, height h, pointed top and a finial.
const onion = (cx, y, w, h) => {
  const half = t => {
    const b = Math.sin(Math.PI * t);
    return (w / 2) * b * (1 + 0.35 * b) * (1 - 0.15 * t) * Math.min(1, t / 0.08) * Math.min(1, (1 - t) * 6);
  };
  const ts = Array.from({ length: 25 }, (_, i) => i / 24);
  const left = ts.slice(1).map(t => [cx - half(t), y - h * t]);
  const right = ts.slice(1, -1).reverse().map(t => [cx + half(t), y - h * t]);
  return [[[cx - w / 2, y], ...left, ...right, [cx + w / 2, y]], line([cx, y - h], [cx, y - h - 18])];
};
const archWin = (cx, y, w, h) => [[[cx - w / 2, y], [cx - w / 2, y - h + w / 2], ...arc(cx, y - h + w / 2, w / 2, 180, 360, 12), [cx + w / 2, y]]];
const minaret = (cx, y, w, h) => [rect(cx - w / 2, y - h, w, h), line([cx - w / 2 - 4, y - h * 0.4], [cx + w / 2 + 4, y - h * 0.4]),
  line([cx - w / 2 - 4, y - h * 0.75], [cx + w / 2 + 4, y - h * 0.75]), ...onion(cx, y - h, w + 6, w * 1.1)];

// Pencil hatching inside a rectangle: 45° strokes, spacing d (the shaded side of a building).
const hatch = (x, y, w, h, d = 9) => {
  const out = [];
  for (let c = -h; c < w; c += d) {
    const s0 = Math.max(0, -c), s1 = Math.min(h, w - c);
    if (s1 > s0) out.push([[x + c + s0, y + h - s0], [x + c + s1, y + h - s1]]);
  }
  return out;
};

const taj = () => [
  rect(-170, -18, 340, 18), rect(-110, -150, 220, 132), ...archWin(0, -18, 64, 110),
  ...archWin(-70, -18, 30, 50), ...archWin(70, -18, 30, 50), ...archWin(-70, -80, 30, 50), ...archWin(70, -80, 30, 50),
  line([-110, -150], [110, -150]), rect(-46, -172, 92, 22), ...onion(0, -172, 120, 120),
  ...onion(-80, -150, 34, 34), ...onion(80, -150, 34, 34),
  ...minaret(-150, -18, 16, 190), ...minaret(150, -18, 16, 190),
  ...hatch(40, -150, 70, 132, 10), ...hatch(143, -205, 14, 187, 7),
];
const indiaGate = () => [
  rect(-80, -230, 160, 230), ...archWin(0, 0, 70, 170), rect(-92, -252, 184, 22), rect(-70, -272, 140, 20), rect(-48, -288, 96, 16),
  line([-80, -40], [80, -40]), ...hatch(35, -230, 45, 230, 9),
];
const gateway = () => [
  rect(-150, -150, 300, 150), ...archWin(0, 0, 90, 130), ...archWin(-95, 0, 40, 70), ...archWin(95, 0, 40, 70),
  line([-150, -150], [150, -150]), ...[-150, -75, 75, 150].flatMap(x => [rect(x - 12, -200, 24, 50), ...onion(x, -200, 26, 26)]),
  ...archWin(-95, -86, 30, 44), ...archWin(95, -86, 30, 44), ...hatch(90, -150, 60, 150, 10),
];
const charminar = () => [
  rect(-90, -130, 180, 130), ...archWin(0, 0, 80, 110), line([-90, -150], [90, -150]), rect(-90, -150, 180, 20),
  ...[-90, 90].flatMap(x => [rect(x - 11, -260, 22, 260), line([x - 15, -170], [x + 15, -170]), line([x - 15, -215], [x + 15, -215]), ...onion(x, -260, 24, 30)]),
  ...onion(0, -150, 60, 40), ...hatch(50, -130, 40, 130, 9), ...hatch(80, -260, 20, 110, 7),
];
const qutub = () => {
  const s = []; let w0 = 52, y = 0;
  for (let i = 0; i < 5; i++) {
    const h = 70 - i * 4, w1 = w0 - 7;
    s.push([[-w0 / 2, y], [-w1 / 2, y - h], [w1 / 2, y - h], [w0 / 2, y]], line([-w1 / 2 - 6, y - h], [w1 / 2 + 6, y - h]));
    for (let k = -1; k <= 1; k++) s.push(line([k * w0 / 5, y], [k * w1 / 5, y - h]));
    y -= h; w0 = w1;
  }
  return [...s, ...onion(0, y, w0, 18)];
};
const lotus = () => [
  ...Array.from({ length: 7 }, (_, j) => { const i = j - 3, cx = i * 34, h = 120 - Math.abs(i) * 22, w = 60;
    return [[cx - w / 2, 0], [cx - w / 4, -h * 0.7], [cx, -h], [cx + w / 4, -h * 0.7], [cx + w / 2, 0]]; }),
  line([-150, 0], [150, 0]), line([-170, 12], [170, 12]),
];
const hawaMahal = () => {
  const s = [];
  for (let r = 0; r < 6; r++) { const w = 260 - r * 34, y = -r * 40;
    s.push(rect(-w / 2, y - 40, w, 40));
    for (let x = -w / 2 + 18; x < w / 2 - 6; x += 26) s.push(...archWin(x + 4, y - 6, 12, 24)); }
  return [...s, ...onion(0, -240, 34, 26)];
};
const temple = () => [
  rect(-60, -70, 120, 70), ...archWin(0, 0, 36, 56), [[-50, -70], [-34, -150], [-14, -200], [0, -220], [14, -200], [34, -150], [50, -70]],
  line([-38, -130], [38, -130]), line([-24, -175], [24, -175]), line([0, -220], [0, -246]), [[0, -246], [18, -240], [0, -234]],
];
const palm = () => [[[0, 0], [4, -50], [10, -100], [14, -150]],
  ...[[-70, -120], [-50, -170], [10, -190], [60, -170], [70, -125]].map(([x, y]) => [[14, -150], [14 + (x - 14) * 0.5, -150 + (y + 150) * 0.5 - 18], [x, y]]),
  line([-30, 0], [40, 0])];
const lamp = () => [line([0, 0], [0, -150]), [[0, -150], [10, -165], [34, -168]], [[24, -168], [44, -168], [40, -158], [28, -158], [24, -168]], line([-14, 0], [14, 0])];
const ground = () => [line([-560, 0], [560, 0]), ...Array.from({ length: 29 }, (_, i) => line([-540 + i * 38, 8], [-522 + i * 38, 8]))];

// Everyday India.
const toran = () => {          // marigold garland: a sagging string with flowers and hanging leaves
  const str = Array.from({ length: 41 }, (_, i) => [-560 + 28 * i, 70 * (1 - Math.pow(i / 20 - 1, 2))]);
  const s = [str];
  for (let i = 2; i < 40; i += 3) { const [x, y] = str[i]; s.push(arc(x, y + 10, 9, 0, 360, 12), [[x - 9, y + 20], [x, y + 46], [x + 9, y + 20]]); }
  return s;
};
const moon = () => [arc(0, 0, 70, 40, 320, 34), arc(28, 0, 51.8, 299.6, 60.4, 26)];
const auto = () => [
  [[-70, -20], [-70, -80], [-40, -110], [60, -110], [80, -80], [80, -20]], line([-70, -20], [80, -20]),
  line([-40, -110], [-40, -20]), line([30, -110], [30, -40]), arc(-45, -6, 16, 0, 360, 20), arc(55, -6, 16, 0, 360, 20),
  line([80, -60], [100, -60]),
];
const chai = () => [[[-30, -70], [-24, 0], [24, 0], [30, -70]], line([-30, -70], [30, -70]), arc(38, -40, 14, -90, 90, 10)];
const steam = () => [[[-10, -84], [-16, -100], [-8, -116], [-14, -132]], [[8, -84], [2, -100], [10, -116], [4, -132]]];
const kite = () => [[[0, -120], [50, -60], [0, 0], [-50, -60], [0, -120]], line([0, -120], [0, 0]), line([-50, -60], [50, -60]),
  [[0, 0], [10, 30], [-6, 60], [12, 90], [-4, 120]]];
const diya = () => [[[-50, -10], [-30, 6], [30, 6], [50, -10], [-50, -10]], [[0, -14], [-9, -34], [0, -60], [9, -34], [0, -14]]];
const rangoli = () => [
  ...Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return [[0, -50], [46 * Math.cos(a), -50 + 46 * Math.sin(a)]]; }),
  arc(0, -50, 46, 0, 360, 36), arc(0, -50, 22, 0, 360, 24),
];

export const SHAPES = { taj, indiaGate, gateway, charminar, qutub, lotus, hawaMahal, temple, palm, lamp, ground, toran, moon, auto, chai, steam, kite, diya, rangoli };
