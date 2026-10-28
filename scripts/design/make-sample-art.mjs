// Generates the TEMPORARY sample illustrations used until real product photography exists (public/sample/*.svg).
// They are simple vector drawings of the three real categories (hand-painted tote bags, crochet mandala wall art, ceramics)
// plus two studio scenes and abstract avatars. They are NOT photos and are never presented as real work: every place that
// shows one labels it «تصویر موقت». Palette follows the approved visual reference.
// Run: node scripts/design/make-sample-art.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "../../public/sample");
mkdirSync(OUT, { recursive: true });

const W = 800;
const H = 1000;
const rad = (d) => (d * Math.PI) / 180;
const pol = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];
const f = (n) => Math.round(n * 10) / 10;
const svg = (body, defs = "", bg = "none", w = W, h = H) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>\n`;

const C = {
  cream: "#F4E9D8", cream2: "#EBDAC0", blush: "#EAD3BA", ink: "#2A1D14",
  teal: "#1D4D4A", tealD: "#12302F", leaf: "#2F8077", leaf2: "#5B8A5A", sage: "#C9D3BC",
  clay: "#A9472A", orange: "#D9663A", cobalt: "#2F5E9E", cobaltD: "#223F6E", sky: "#8FB6D9",
  mustard: "#D9A441", olive: "#7A8456", stone: "#B49B7C", wood: "#8A6A4A", woodD: "#6B4E34", white: "#FBF6EC",
};

/** Smooth open curve through points (Catmull-Rom -> cubic Bezier). */
function smooth(points) {
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

// ---------------------------------------------------------------- small drawing parts
function flower(cx, cy, r, petal, center, n = 7, rot = 0, ring) {
  let g = "";
  for (let i = 0; i < n; i++) {
    const a = rot + (360 / n) * i;
    const [px, py] = pol(cx, cy, r * 0.62, a);
    g += `<ellipse rx="${f(r * 0.4)}" ry="${f(r * 0.62)}" transform="translate(${f(px)} ${f(py)}) rotate(${f(a - 90)})" fill="${petal}"/>`;
  }
  if (ring) g += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.46)}" fill="${ring}"/>`;
  g += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.3)}" fill="${center}"/>`;
  return g;
}
function leaf(x, y, len, angle, color) {
  const w = len * 0.28;
  return `<path d="M0 0 C${f(w)} ${f(-len * 0.3)} ${f(w)} ${f(-len * 0.7)} 0 ${f(-len)} C${f(-w)} ${f(-len * 0.7)} ${f(-w)} ${f(-len * 0.3)} 0 0Z" transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)})" fill="${color}"/>`;
}
const stem = (d, color = C.leaf, w = 7) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
const tassel = (x, y, color, len = 90) => {
  let g = `<rect x="${x - 7}" y="${y}" width="14" height="22" rx="4" fill="${color}"/>`;
  for (let i = -3; i <= 3; i++) g += `<path d="M${x + i * 3.2} ${y + 20} q${i * 1.6} ${len * 0.5} ${i * 2.2} ${len}" stroke="${color}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
  return g;
};

// ---------------------------------------------------------------- hand-painted tote bags
function tote({ bg, fabric, strap, paint, motif, tasselColor }) {
  const defs = `<pattern id="w" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 .5H8M.5 0V8" stroke="${C.ink}" stroke-opacity=".06" stroke-width="1"/></pattern><clipPath id="b"><path d="M196 392 L604 392 L622 846 Q624 876 594 876 L206 876 Q176 876 178 846 Z"/></clipPath>`;
  const body = "M196 392 L604 392 L622 846 Q624 876 594 876 L206 876 Q176 876 178 846 Z";
  let g = `<ellipse cx="400" cy="890" rx="250" ry="20" fill="#000" opacity=".12"/>`;
  g += `<path d="M300 400 C300 180 500 180 500 400" fill="none" stroke="${strap}" stroke-width="30" stroke-linecap="round" opacity=".55"/>`;
  g += `<path d="M285 405 C285 150 515 150 515 405" fill="none" stroke="${strap}" stroke-width="32" stroke-linecap="round"/>`;
  g += `<path d="${body}" fill="${fabric}"/><path d="${body}" fill="url(#w)"/>`;
  g += `<path d="M190 430 L610 430" stroke="${C.ink}" stroke-opacity=".25" stroke-width="3" stroke-dasharray="9 7"/>`;
  let art = "";
  if (motif === "bouquet") {
    const [a, b, c] = paint; // a = big flowers, b = blue flowers, c = leaves
    art += stem("M400 860 C396 780 360 720 325 640", c.stem, 8) + stem("M400 860 C410 770 450 700 492 610", c.stem, 8) + stem("M400 860 C400 760 405 680 400 560", c.stem, 8);
    [[372, 760, -50], [430, 740, 48], [352, 690, -38], [470, 668, 40], [398, 640, -20], [405, 600, 24]].forEach(([x, y, ang], i) => (art += leaf(x, y, 92 - i * 6, ang, i % 2 ? c.leaf : c.leaf2)));
    art += flower(322, 612, 66, a, C.ink, 8, 10);
    art += flower(494, 588, 54, b, C.white, 7, 0, C.white);
    art += flower(402, 540, 44, a, C.ink, 7, 24);
    art += flower(270, 700, 26, C.mustard, C.clay, 6) + flower(540, 700, 26, C.mustard, C.clay, 6);
  } else if (motif === "allover") {
    const [a, b, c] = paint;
    const spots = [[270, 520], [400, 500], [530, 520], [330, 610], [470, 610], [260, 700], [400, 700], [540, 700], [330, 790], [470, 790]];
    spots.forEach(([x, y], i) => {
      art += leaf(x - 30, y + 30, 54, -60, c.leaf2) + leaf(x + 30, y + 30, 54, 60, c.leaf);
      art += i % 2 ? flower(x, y, 30, b, C.white, 6, 0, C.white) : flower(x, y, 34, a, C.ink, 7, 12);
    });
  } else {
    const [a, b, c] = paint;
    [220, 170, 120, 70].forEach((r, i) => (art += `<path d="M${400 - r} 860 A${r} ${r} 0 0 1 ${400 + r} 860" fill="none" stroke="${[a, b, c.leaf, C.mustard][i]}" stroke-width="30"/>`));
    art += `<circle cx="400" cy="640" r="34" fill="${C.clay}"/>`;
    [[250, 560], [560, 580], [310, 500], [510, 520]].forEach(([x, y], i) => (art += flower(x, y, 18, [a, b][i % 2], C.ink, 5)));
  }
  g += `<g clip-path="url(#b)">${art}</g>`;
  g += tassel(232, 410, tasselColor);
  return svg(g, defs, bg);
}

// ---------------------------------------------------------------- crochet mandala wall art
function mandala({ bg, c, hoop, fringe, scale = 1, dy = 0 }) {
  const cx = 400;
  const cy = 450 + dy;
  const s = scale;
  let g = `<circle cx="${cx}" cy="${cy + 14}" r="${312 * s}" fill="#000" opacity=".1"/>`;
  // fringe first so the disc overlaps its roots
  if (fringe) {
    for (let i = 0; i < 17; i++) {
      const x = cx - 192 + i * 24;
      const y0 = cy + Math.sqrt(Math.max(0, (300 * s) ** 2 - (x - cx) ** 2)) - 8;
      g += tassel(x, y0, fringe[i % fringe.length], 70 + ((i * 29) % 5) * 12);
    }
  }
  if (hoop) g += `<circle cx="${cx}" cy="${cy}" r="${312 * s}" fill="none" stroke="${hoop}" stroke-width="12"/>`;
  const rings = [
    { kind: "scallop", n: 28, r: 270 * s, size: 34 * s, fill: c[0] },
    { kind: "petal", n: 24, r: 212 * s, size: 50 * s, fill: c[1] },
    { kind: "diamond", n: 20, r: 154 * s, size: 42 * s, fill: c[2] },
    { kind: "petal", n: 16, r: 102 * s, size: 36 * s, fill: c[3] },
    { kind: "bead", n: 10, r: 56 * s, size: 15 * s, fill: c[4] },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const a = (360 / ring.n) * i;
      const [px, py] = pol(cx, cy, ring.r, a);
      if (ring.kind === "scallop" || ring.kind === "bead") g += `<circle cx="${f(px)}" cy="${f(py)}" r="${ring.size}" fill="${ring.fill}" stroke="${bg}" stroke-width="3"/>`;
      if (ring.kind === "petal") g += `<ellipse rx="${f(ring.size * 0.5)}" ry="${f(ring.size)}" transform="translate(${f(px)} ${f(py)}) rotate(${f(a - 90)})" fill="${ring.fill}" stroke="${bg}" stroke-width="3"/>`;
      if (ring.kind === "diamond") g += `<path d="M0 ${-ring.size} L${f(ring.size * 0.62)} 0 L0 ${ring.size} L${f(-ring.size * 0.62)} 0Z" transform="translate(${f(px)} ${f(py)}) rotate(${f(a - 90)})" fill="${ring.fill}" stroke="${bg}" stroke-width="3" stroke-linejoin="round"/>`;
    }
    g += `<circle cx="${cx}" cy="${cy}" r="${f(ring.r)}" fill="none" stroke="${C.ink}" stroke-opacity=".28" stroke-width="3.5" stroke-dasharray="2 9" stroke-linecap="round"/>`;
  }
  g += `<circle cx="${cx}" cy="${cy}" r="${24 * s}" fill="${c[0]}" stroke="${bg}" stroke-width="3"/>`;
  return svg(g, "", bg);
}

// ---------------------------------------------------------------- ceramics
function vessel({ cx, base, profile, clay, glaze, glazeTo = 0.6, id, decor, k = 1 }) {
  profile = [...profile].map(([a, b]) => [a * k, b * k]).reverse(); // rim first
  const right = profile.map(([dx, dy]) => [cx + dx, base - dy]);
  const left = [...profile].reverse().map(([dx, dy]) => [cx - dx, base - dy]);
  const top = right[0];
  const d = `${smooth(right)} L${f(left[0][0])} ${f(left[0][1])} ${smooth(left).replace(/^M[^C]*/, "")} L${f(cx - profile[0][0])} ${f(top[1])} Z`;
  const topY = top[1];
  const height = base - topY;
  const gy = topY + height * glazeTo;
  const wide = Math.max(...profile.map((p) => p[0]));
  let g = `<ellipse cx="${cx}" cy="${base + 6}" rx="${f(wide * 0.95)}" ry="12" fill="#000" opacity=".16"/>`;
  g += `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="${clay}"/>`;
  let drip = `M${cx - 500} ${topY - 20} H${cx + 500} V${gy}`;
  for (let i = 0; i < 10; i++) {
    const x = cx + 500 - (i + 0.5) * 100;
    const dd = 14 + ((i * 37) % 50);
    drip += ` Q${x + 30} ${gy + dd} ${x} ${gy + dd * 0.35} T${x - 50} ${gy}`;
  }
  drip += " Z";
  g += `<g clip-path="url(#${id})"><path d="${drip}" fill="${glaze}"/>`;
  if (decor === "ornament") {
    // ceramic-blue ornament: bands, dot rows and small diamonds
    for (let i = 0; i < 5; i++) g += `<path d="M${cx - 400} ${f(topY + height * (0.18 + i * 0.12))} H${cx + 400}" stroke="${C.white}" stroke-opacity=".7" stroke-width="3"/>`;
    for (let row = 0; row < 3; row++) for (let i = -9; i <= 9; i++) g += `<circle cx="${cx + i * 22 + (row % 2) * 11}" cy="${f(topY + height * (0.3 + row * 0.12))}" r="5" fill="${C.white}" opacity=".85"/>`;
    for (let i = -4; i <= 4; i++) g += `<path d="M${cx + i * 46} ${f(topY + height * 0.46)} l9 11 -9 11 -9 -11z" fill="${C.sky}"/>`;
  } else {
    for (let i = 1; i < 14; i++) g += `<path d="M${cx - 400} ${f(topY + (height / 14) * i)} H${cx + 400}" stroke="#fff" stroke-opacity=".14" stroke-width="3"/>`;
  }
  g += `<path d="M${cx - wide * 0.55} ${topY + 24} V${base - 14}" stroke="#fff" stroke-opacity=".22" stroke-width="16" stroke-linecap="round"/></g>`;
  g += `<path d="${d}" fill="none" stroke="${C.ink}" stroke-opacity=".18" stroke-width="2"/>`;
  return g;
}
const VASE = [[34, 0], [78, 6], [104, 60], [112, 150], [96, 270], [58, 360], [34, 420], [30, 470], [40, 500]];
const POT = [[70, 0], [150, 40], [200, 150], [195, 260], [120, 330], [60, 370], [52, 400], [70, 415]];
const JAR = [[120, 0], [150, 20], [170, 80], [164, 180], [120, 260], [66, 306], [56, 340], [68, 352]];
const BOWL = [[150, 0], [172, 26], [152, 80], [96, 124], [70, 142]];
const CUP = [[62, 0], [72, 20], [72, 100], [60, 130], [54, 138]];

function blossoms(cx, topY) {
  let g = "";
  const stems = [[-120, -190], [-62, -250], [0, -285], [62, -250], [118, -190], [-32, -175], [40, -185]];
  stems.forEach(([dx, dy]) => {
    g += stem(`M${cx} ${topY + 10} C${cx + dx * 0.2} ${topY + dy * 0.4} ${cx + dx * 0.9} ${topY + dy * 0.6} ${cx + dx} ${topY + dy}`, C.leaf2, 6);
  });
  stems.forEach(([dx, dy], i) => (g += leaf(cx + dx * 0.55, topY + dy * 0.5, 70, dx < 0 ? -55 : 55, i % 2 ? C.leaf : C.leaf2)));
  stems.forEach(([dx, dy], i) => (g += flower(cx + dx, topY + dy, 34 + (i % 3) * 4, C.white, C.mustard, 6, i * 11)));
  return g;
}

function vaseScene() {
  let g = `<circle cx="400" cy="470" r="360" fill="#FFFFFF" opacity=".06"/>`;
  g += `<path d="M150 900 Q160 820 260 810 H560 Q650 820 660 900 V1000 H150Z" fill="${C.stone}"/><path d="M200 830 q60 -14 140 -8" stroke="#fff" stroke-opacity=".3" stroke-width="6" fill="none" stroke-linecap="round"/>`;
  g += vessel({ cx: 400, base: 812, profile: POT, clay: C.cobalt, glaze: C.cobaltD, glazeTo: 0.0, id: "p1", decor: "ornament", k: 0.95 });
  g += blossoms(400, 812 - 415 * 0.95);
  return svg(g, "", C.teal);
}
function shelfScene({ bg, shelf, items }) {
  let g = `<rect x="0" y="876" width="${W}" height="${H - 876}" fill="${shelf}"/><rect x="0" y="868" width="${W}" height="10" fill="#000" opacity=".12"/>`;
  g += `<g transform="translate(400 868) scale(1.2) translate(-400 -868)">${items.map((it, i) => vessel({ base: 868, id: `v${i}`, ...it })).join("")}</g>`;
  return svg(g, "", bg);
}

// ---------------------------------------------------------------- studio scenes + avatars
function studioBrushes() {
  let g = `<rect x="0" y="760" width="${W}" height="240" fill="${C.wood}"/>`;
  for (let i = 0; i < 4; i++) g += `<path d="M0 ${790 + i * 55} H${W}" stroke="${C.woodD}" stroke-opacity=".5" stroke-width="3"/>`;
  g += `<path d="M120 760 q-60 -160 -10 -300 M120 760 q40 -120 100 -200 M120 760 q-100 -60 -80 -170" fill="none" stroke="${C.leaf}" stroke-width="10" stroke-linecap="round"/>`;
  [[110, 470, -20], [210, 560, 40], [50, 600, -70], [150, 640, 15]].forEach(([x, y, a], i) => (g += leaf(x, y, 120, a, i % 2 ? C.leaf2 : C.leaf)));
  g += `<rect x="90" y="740" width="60" height="30" rx="6" fill="${C.clay}"/>`;
  // glass jar with brushes
  g += `<rect x="400" y="560" width="150" height="230" rx="22" fill="#fff" opacity=".35" stroke="${C.ink}" stroke-opacity=".3" stroke-width="3"/>`;
  [[430, -14, C.orange], [458, -4, C.cobalt], [486, 6, C.mustard], [514, 16, C.leaf]].forEach(([x, a, col]) => (g += `<g transform="rotate(${a} ${x} 700)"><rect x="${x - 6}" y="380" width="12" height="320" rx="6" fill="${C.woodD}"/><rect x="${x - 9}" y="350" width="18" height="52" rx="9" fill="${col}"/></g>`));
  g += `<rect x="400" y="650" width="150" height="140" rx="20" fill="#fff" opacity=".3"/>`;
  // paint pots + a small tote
  [[640, C.orange], [700, C.cobalt], [580, C.mustard]].forEach(([x, col], i) => (g += `<g><ellipse cx="${x}" cy="${800 + i * 4}" rx="34" ry="12" fill="#000" opacity=".15"/><rect x="${x - 30}" y="${742 + i * 4}" width="60" height="52" rx="10" fill="${C.cream}"/><rect x="${x - 30}" y="${742 + i * 4}" width="60" height="16" rx="8" fill="${col}"/></g>`));
  g += `<path d="M250 790 L250 700 L360 700 L360 790 Z" fill="${C.cream}" stroke="${C.ink}" stroke-opacity=".2"/><path d="M270 700 C270 650 340 650 340 700" fill="none" stroke="${C.clay}" stroke-width="10" stroke-linecap="round"/>`;
  return svg(g, "", C.blush);
}
function studioWheel() {
  let g = `<rect x="0" y="780" width="${W}" height="220" fill="${C.woodD}"/>`;
  g += `<ellipse cx="400" cy="800" rx="260" ry="46" fill="#000" opacity=".2"/><ellipse cx="400" cy="770" rx="250" ry="52" fill="${C.ink}" opacity=".85"/><ellipse cx="400" cy="752" rx="210" ry="38" fill="${C.stone}"/>`;
  g += vessel({ cx: 400, base: 748, profile: BOWL, clay: C.clay, glaze: C.clay, glazeTo: 0.0, id: "wb", k: 1.25 });
  g += `<path d="M560 600 q60 -40 100 10" stroke="${C.ink}" stroke-width="5" fill="none"/><circle cx="640" cy="690" r="34" fill="${C.mustard}"/><circle cx="628" cy="682" r="5" fill="${C.clay}"/><circle cx="652" cy="700" r="5" fill="${C.clay}"/>`;
  g += `<path d="M110 700 q-50 -160 10 -300 M110 700 q50 -110 120 -170" fill="none" stroke="${C.leaf2}" stroke-width="9" stroke-linecap="round"/>`;
  [[120, 420, -10], [190, 560, 42], [70, 600, -60]].forEach(([x, y, a], i) => (g += leaf(x, y, 120, a, i % 2 ? C.leaf : C.leaf2)));
  return svg(g, "", C.teal);
}
function avatar({ bg, a, b, c, kind }) {
  let g = "";
  if (kind === 1) g += `<path d="M180 760 V470 A220 220 0 0 1 620 470 V760Z" fill="${a}"/><circle cx="400" cy="470" r="86" fill="${b}"/>`;
  if (kind === 2) g += `<circle cx="400" cy="500" r="250" fill="${a}"/><path d="M180 520 C300 380 500 640 620 480" stroke="${b}" stroke-width="44" fill="none" stroke-linecap="round"/><circle cx="520" cy="360" r="42" fill="${c}"/>`;
  if (kind === 3) g += `<rect x="190" y="300" width="420" height="420" rx="40" fill="${a}" transform="rotate(8 400 500)"/><circle cx="400" cy="500" r="120" fill="${b}"/><circle cx="400" cy="500" r="44" fill="${c}"/>`;
  return svg(g, "", bg, 800, 800);
}

// ---------------------------------------------------------------- write everything
const out = (name, text) => writeFileSync(join(OUT, `${name}.svg`), text);

out("tote-1", tote({ bg: "#EAD3BA", fabric: "#F4E9D8", strap: "#C8B28A", motif: "bouquet", paint: [C.orange, C.cobalt, { stem: C.leaf, leaf: C.leaf, leaf2: C.leaf2 }], tasselColor: C.clay }));
out("tote-2", tote({ bg: C.teal, fabric: "#F4E9D8", strap: C.clay, motif: "allover", paint: [C.orange, C.cobalt, { stem: C.leaf, leaf: C.leaf, leaf2: C.leaf2 }], tasselColor: C.mustard }));
out("tote-3", tote({ bg: "#D3D8BF", fabric: "#EFE3CB", strap: C.olive, motif: "arch", paint: [C.clay, C.cobalt, { stem: C.leaf, leaf: C.leaf, leaf2: C.leaf2 }], tasselColor: C.cobalt }));

out("mandala-1", mandala({ bg: "#EAD3BA", c: [C.orange, C.cobalt, C.cream, C.ink, C.mustard], hoop: null, fringe: [C.cobalt, C.cream, C.orange] }));
out("mandala-2", mandala({ bg: C.teal, c: [C.cobalt, C.cream, C.orange, C.mustard, C.ink], hoop: C.wood, fringe: [C.cream, C.orange, C.mustard], scale: 0.95 }));
out("mandala-3", mandala({ bg: "#D3D8BF", c: [C.clay, C.mustard, C.cream, C.cobalt, C.ink], hoop: null, fringe: [C.clay, C.cream], scale: 0.92, dy: 10 }));

out("vase-1", vaseScene());
out("vase-2", shelfScene({ bg: "#EAD3BA", shelf: C.wood, items: [{ cx: 235, profile: CUP, clay: C.cream, glaze: C.clay, glazeTo: 0.5, k: 0.9 }, { cx: 395, profile: BOWL, clay: C.cream, glaze: "#3AA6A0", glazeTo: 0.8, k: 0.85 }, { cx: 585, profile: VASE, clay: C.cream, glaze: C.cobalt, glazeTo: 0.6, decor: "ornament", k: 0.78 }] }));
out("vase-3", shelfScene({ bg: "#D3D8BF", shelf: C.wood, items: [{ cx: 215, profile: VASE, clay: C.cream, glaze: C.clay, glazeTo: 0.62, k: 0.78 }, { cx: 400, profile: POT, clay: C.cream, glaze: C.cobalt, glazeTo: 0.6, decor: "ornament", k: 0.62 }, { cx: 585, profile: JAR, clay: C.cream, glaze: C.mustard, glazeTo: 0.55, k: 0.62 }] }));

out("studio-1", studioBrushes());
out("studio-2", studioWheel());

out("artist-1", avatar({ bg: "#EAD3BA", a: C.clay, b: C.cream, c: C.leaf, kind: 1 }));
out("artist-2", avatar({ bg: "#D3D8BF", a: C.leaf, b: C.cream, c: C.orange, kind: 2 }));
out("artist-3", avatar({ bg: "#DCE7F4", a: C.mustard, b: C.cobalt, c: C.cream, kind: 3 }));
console.log("sample art written to", OUT);
