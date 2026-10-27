// Generates the TEMPORARY placeholder illustrations used by the design prototypes (public/design-preview/assets/img).
// They are simple vector drawings of the three real categories (hand-painted tote bags, crochet mandala wall art, pottery):
// NOT product photos, never to be mistaken for real work. The prototypes label every one of them "تصویر موقت".
// Run: node scripts/design/make-placeholders.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "../../public/design-preview/assets/img");
mkdirSync(OUT, { recursive: true });

const W = 800;
const H = 1000;
const rad = (d) => (d * Math.PI) / 180;
const pol = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];
const f = (n) => Math.round(n * 10) / 10;
const svg = (body, defs = "", bg = "none") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-hidden="true"><defs>${defs}</defs><rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg>\n`;

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

// ---------------------------------------------------------------- crochet mandala wall art
function mandala({ bg, c, hoop, tassels, scale = 1, dx = 0, dy = 0 }) {
  const cx = 400 + dx;
  const cy = 470 + dy;
  const s = scale;
  let g = "";
  const rings = [
    { kind: "scallop", n: 26, r: 262 * s, size: 33 * s, fill: c[0] },
    { kind: "petal", n: 22, r: 205 * s, size: 48 * s, fill: c[1] },
    { kind: "diamond", n: 18, r: 150 * s, size: 40 * s, fill: c[2] },
    { kind: "petal", n: 14, r: 100 * s, size: 34 * s, fill: c[3] },
    { kind: "bead", n: 9, r: 56 * s, size: 15 * s, fill: c[4] },
  ];
  g += `<circle cx="${cx}" cy="${cy + 14}" r="${300 * s}" fill="#000" opacity=".07"/>`;
  if (hoop) g += `<circle cx="${cx}" cy="${cy}" r="${306 * s}" fill="none" stroke="${hoop}" stroke-width="12"/>`;
  if (tassels) {
    for (let i = 0; i < 9; i++) {
      const x = cx - 130 + i * 32.5;
      const y0 = cy + 290 * s;
      g += `<path d="M${f(x)} ${f(y0)} q${i % 2 ? 6 : -6} 50 0 ${90 + (i % 3) * 18}" stroke="${c[i % 3]}" stroke-width="9" stroke-linecap="round" fill="none"/>`;
    }
  }
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const a = (360 / ring.n) * i;
      const [px, py] = pol(cx, cy, ring.r, a);
      if (ring.kind === "scallop") g += `<circle cx="${f(px)}" cy="${f(py)}" r="${ring.size}" fill="${ring.fill}" stroke="${bg}" stroke-width="3"/>`;
      if (ring.kind === "bead") g += `<circle cx="${f(px)}" cy="${f(py)}" r="${ring.size}" fill="${ring.fill}" stroke="${bg}" stroke-width="2"/>`;
      if (ring.kind === "petal") g += `<ellipse cx="0" cy="0" rx="${f(ring.size * 0.5)}" ry="${f(ring.size)}" transform="translate(${f(px)} ${f(py)}) rotate(${f(a - 90)})" fill="${ring.fill}" stroke="${bg}" stroke-width="3"/>`;
      if (ring.kind === "diamond") g += `<path d="M0 ${-ring.size} L${f(ring.size * 0.62)} 0 L0 ${ring.size} L${f(-ring.size * 0.62)} 0Z" transform="translate(${f(px)} ${f(py)}) rotate(${f(a - 90)})" fill="${ring.fill}" stroke="${bg}" stroke-width="3" stroke-linejoin="round"/>`;
    }
    // stitch texture: a dashed ring along each row, like rows of yarn stitches
    g += `<circle cx="${cx}" cy="${cy}" r="${f(ring.r)}" fill="none" stroke="#2b2118" stroke-opacity=".28" stroke-width="3.5" stroke-dasharray="2 9" stroke-linecap="round"/>`;
  }
  g += `<circle cx="${cx}" cy="${cy}" r="${24 * s}" fill="${c[0]}" stroke="${bg}" stroke-width="3"/>`;
  return svg(g, "", bg);
}

// ---------------------------------------------------------------- hand-painted tote bag
function tote({ bg, fabric, strap, ink, paint, motif }) {
  const defs = `<pattern id="w" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 .5H8M.5 0V8" stroke="${ink}" stroke-opacity=".07" stroke-width="1"/></pattern>`;
  let g = `<ellipse cx="400" cy="888" rx="240" ry="20" fill="#000" opacity=".09"/>`;
  g += `<path d="M300 400 C300 180 500 180 500 400" fill="none" stroke="${strap}" stroke-width="30" stroke-linecap="round" opacity=".55"/>`;
  g += `<path d="M285 405 C285 150 515 150 515 405" fill="none" stroke="${strap}" stroke-width="32" stroke-linecap="round"/>`;
  const body = "M196 392 L604 392 L622 846 Q624 876 594 876 L206 876 Q176 876 178 846 Z";
  g += `<path d="${body}" fill="${fabric}"/><path d="${body}" fill="url(#w)"/>`;
  g += `<path d="M190 430 L610 430" stroke="${ink}" stroke-opacity=".28" stroke-width="3" stroke-dasharray="9 7"/>`;
  g += `<path d="M184 842 L616 842" stroke="${ink}" stroke-opacity=".2" stroke-width="3" stroke-dasharray="9 7"/>`;
  const clip = `<clipPath id="b"><path d="${body}"/></clipPath>`;
  let art = "";
  if (motif === "flow") {
    const ys = [540, 612, 684, 756];
    ys.forEach((y, i) => {
      art += `<path d="M150 ${y} C230 ${y - 46} 300 ${y + 46} 380 ${y} S 530 ${y - 46} 650 ${y}" fill="none" stroke="${paint[i % paint.length]}" stroke-width="${i % 2 ? 20 : 28}" stroke-linecap="round"/>`;
    });
    [[250, 490], [520, 478], [330, 820], [470, 810]].forEach(([x, y], i) => (art += `<circle cx="${x}" cy="${y}" r="${9 + (i % 2) * 4}" fill="${paint[(i + 1) % paint.length]}"/>`));
  } else if (motif === "leaf") {
    art += `<path d="M400 850 C396 740 410 620 400 490" fill="none" stroke="${paint[0]}" stroke-width="12" stroke-linecap="round"/>`;
    for (let i = 0; i < 5; i++) {
      const y = 800 - i * 70;
      const s = 1 - i * 0.08;
      art += `<ellipse cx="0" cy="0" rx="${f(26 * s)}" ry="${f(62 * s)}" transform="translate(${f(400 - 52 * s)} ${y}) rotate(-52)" fill="${paint[(i + 1) % paint.length]}"/>`;
      art += `<ellipse cx="0" cy="0" rx="${f(26 * s)}" ry="${f(62 * s)}" transform="translate(${f(400 + 52 * s)} ${y - 34}) rotate(52)" fill="${paint[(i + 2) % paint.length]}"/>`;
    }
    art += `<circle cx="400" cy="486" r="30" fill="${paint[2 % paint.length]}"/><circle cx="400" cy="486" r="11" fill="${fabric}"/>`;
  } else {
    [190, 150, 110, 70].forEach((r, i) => (art += `<path d="M${400 - r} 850 A${r} ${r} 0 0 1 ${400 + r} 850" fill="none" stroke="${paint[i % paint.length]}" stroke-width="26"/>`));
    art += `<circle cx="400" cy="636" r="34" fill="${paint[paint.length - 1]}"/>`;
    [[240, 560], [560, 580], [300, 500], [510, 520]].forEach(([x, y], i) => (art += `<circle cx="${x}" cy="${y}" r="9" fill="${paint[i % paint.length]}"/>`));
  }
  g += `<g clip-path="url(#b)">${art}</g>`;
  return svg(g, defs + clip, bg);
}

// ---------------------------------------------------------------- pottery
function vessel({ cx, base, profile, clay, glaze, glazeTo, ink, id, rings = true }) {
  // profile: right-hand outline listed from the foot up to the rim as [dx, heightAboveBase]; mirrored for the left side.
  profile = [...profile].reverse();
  const right = profile.map(([dx, dy]) => [cx + dx, base - dy]);
  const left = [...profile].reverse().map(([dx, dy]) => [cx - dx, base - dy]);
  const top = right[0];
  const d = `${smooth(right)} L${f(left[0][0])} ${f(left[0][1])} ${smooth(left).replace(/^M[^C]*/, "")} L${f(top[0] - 2 * profile[0][0])} ${f(top[1])} Z`;
  const topY = top[1];
  const height = base - topY;
  const gy = topY + height * glazeTo;
  let g = `<ellipse cx="${cx}" cy="${base + 6}" rx="${f(Math.max(...profile.map((p) => p[0])) * 0.95)}" ry="12" fill="#000" opacity=".12"/>`;
  g += `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="${clay}"/>`;
  let drip = `M${cx - 400} ${topY - 20} H${cx + 400} V${gy}`;
  for (let i = 0; i < 9; i++) {
    const x = cx + 400 - (i + 0.5) * 100;
    const dd = 16 + ((i * 37) % 54);
    drip += ` Q${x + 30} ${gy + dd} ${x} ${gy + dd * 0.35} T${x - 50} ${gy}`;
  }
  drip += " Z";
  g += `<g clip-path="url(#${id})"><path d="${drip}" fill="${glaze}"/>`;
  if (rings) for (let i = 1; i < 14; i++) g += `<path d="M${cx - 300} ${f(topY + (height / 14) * i)} H${cx + 300}" stroke="#fff" stroke-opacity=".16" stroke-width="3"/>`;
  g += `<path d="M${cx - Math.max(...profile.map((p) => p[0])) * 0.55} ${topY + 20} V${base - 12}" stroke="#fff" stroke-opacity=".22" stroke-width="16" stroke-linecap="round"/></g>`;
  g += `<path d="${d}" fill="none" stroke="${ink}" stroke-opacity=".18" stroke-width="2"/>`;
  return g;
}

function pottery({ bg, shelf, clay, glazes, ink, layout }) {
  let g = `<rect x="0" y="876" width="${W}" height="${H - 876}" fill="${shelf}"/><rect x="0" y="868" width="${W}" height="10" fill="#000" opacity=".1"/>`;
  const bottle = [[34, 0], [78, 6], [104, 60], [112, 150], [96, 270], [58, 360], [34, 420], [30, 470], [40, 500]].map(([a, b]) => [a, b]);
  const jar = [[120, 0], [150, 20], [170, 80], [164, 180], [120, 260], [66, 306], [56, 340], [68, 352]];
  const bowl = [[150, 0], [172, 26], [152, 80], [96, 124], [70, 142]];
  const cup = [[62, 0], [72, 20], [72, 100], [60, 130], [54, 138]];
  const make = (shape, cx, id, i, o = {}) => vessel({ cx, base: 868, profile: shape.map(([a, b]) => [a * (o.k ?? 1), b * (o.k ?? 1)]), clay, glaze: glazes[i % glazes.length], glazeTo: o.to ?? 0.6, ink, id, rings: true });
  let objects = "";
  if (layout === 1) objects = make(bottle, 420, "v1", 0, { to: 0.62 }) + make(cup, 215, "v2", 1, { to: 0.5 }) + make(bowl, 560, "v3", 2, { to: 0.7, k: 0.82 });
  if (layout === 2) objects = make(jar, 400, "v1", 1, { to: 0.55 }) + make(bottle, 190, "v2", 0, { to: 0.7 }) + make(cup, 620, "v3", 2, { to: 0.45 });
  if (layout === 3) objects = make(bowl, 290, "v1", 2, { to: 0.5, k: 0.82 }) + make(bottle, 560, "v2", 1, { to: 0.58 }) + make(cup, 150, "v3", 0, { to: 0.6 });
  // Objects are scaled up around the shelf line so they fill the frame.
  g += `<g transform="translate(400 868) scale(1.2) translate(-400 -868)">${objects}</g>`;
  return svg(g, "", bg);
}

function avatar({ bg, a, b, c, kind }) {
  let g = `<rect width="${W}" height="${H}" fill="${bg}"/>`;
  if (kind === 1) g += `<path d="M180 760 V470 A220 220 0 0 1 620 470 V760Z" fill="${a}"/><circle cx="400" cy="470" r="86" fill="${b}"/>`;
  if (kind === 2) g += `<circle cx="400" cy="500" r="250" fill="${a}"/><path d="M180 520 C300 380 500 640 620 480" stroke="${b}" stroke-width="44" fill="none" stroke-linecap="round"/><circle cx="520" cy="360" r="42" fill="${c}"/>`;
  if (kind === 3) g += `<rect x="190" y="300" width="420" height="420" rx="40" fill="${a}" transform="rotate(8 400 500)"/><circle cx="400" cy="500" r="120" fill="${b}"/><circle cx="400" cy="500" r="44" fill="${c}"/>`;
  return svg(g, "", bg);
}

// ---------------------------------------------------------------- palettes: A = warm natural / B = bold playful
const A = {
  mandala: [
    { bg: "#E6D7BC", c: ["#B5603B", "#C8A15A", "#6F7048", "#EFE4D0", "#8C4A2E"], hoop: "#8A6A4A" },
    { bg: "#D3D6BC", c: ["#6F7048", "#EFE4D0", "#B5603B", "#C8A15A", "#3A2B20"], tassels: true },
    { bg: "#EBD9C6", c: ["#8C4A2E", "#D9B98A", "#A7AE8C", "#B5603B", "#EFE4D0"], hoop: "#6F5239", scale: 0.92, dy: 20 },
  ],
  tote: [
    { bg: "#E9DCC4", fabric: "#EFE4D0", strap: "#C8B28A", ink: "#3A2B20", paint: ["#B5603B", "#6F7048", "#C8A15A"], motif: "flow" },
    { bg: "#D8DCC2", fabric: "#F1E7D3", strap: "#8C8F63", ink: "#3A2B20", paint: ["#6F7048", "#B5603B", "#C8A15A"], motif: "leaf" },
    { bg: "#EAD3C0", fabric: "#EDE0C8", strap: "#B5603B", ink: "#3A2B20", paint: ["#B5603B", "#C8A15A", "#6F7048", "#3A2B20"], motif: "arch" },
  ],
  pottery: [
    { bg: "#E4D5BC", shelf: "#B39A72", clay: "#CDA982", glazes: ["#6F7048", "#B5603B", "#EFE4D0"], ink: "#3A2B20", layout: 1 },
    { bg: "#D5D9C0", shelf: "#A58E69", clay: "#D8B48C", glazes: ["#B5603B", "#6F7048", "#C8A15A"], ink: "#3A2B20", layout: 2 },
    { bg: "#EAD6C4", shelf: "#B39A72", clay: "#C9A27A", glazes: ["#EFE4D0", "#8C4A2E", "#6F7048"], ink: "#3A2B20", layout: 3 },
  ],
  avatar: [
    { bg: "#E6D7BC", a: "#B5603B", b: "#EFE4D0", c: "#6F7048", kind: 1 },
    { bg: "#D3D6BC", a: "#6F7048", b: "#EFE4D0", c: "#B5603B", kind: 2 },
    { bg: "#EBD9C6", a: "#C8A15A", b: "#8C4A2E", c: "#EFE4D0", kind: 3 },
  ],
};
const B = {
  mandala: [
    { bg: "#F4B63A", c: ["#E8573D", "#3446C4", "#FFF6E6", "#1F1B2E", "#F4A9B8"], hoop: "#1F1B2E" },
    { bg: "#8FD0B5", c: ["#3446C4", "#FFF6E6", "#E8573D", "#F4B63A", "#1F1B2E"], tassels: true },
    { bg: "#F4A9B8", c: ["#1F1B2E", "#F4B63A", "#3446C4", "#FFF6E6", "#E8573D"], hoop: "#3446C4", scale: 0.92, dy: 20 },
  ],
  tote: [
    { bg: "#B9A6E8", fabric: "#FFF6E6", strap: "#1F1B2E", ink: "#1F1B2E", paint: ["#E8573D", "#3446C4", "#F4B63A"], motif: "flow" },
    { bg: "#8FD0B5", fabric: "#FFF6E6", strap: "#3446C4", ink: "#1F1B2E", paint: ["#3446C4", "#E8573D", "#F4B63A"], motif: "leaf" },
    { bg: "#F4B63A", fabric: "#FFF6E6", strap: "#E8573D", ink: "#1F1B2E", paint: ["#E8573D", "#3446C4", "#8FD0B5", "#1F1B2E"], motif: "arch" },
  ],
  pottery: [
    { bg: "#E8573D", shelf: "#1F1B2E", clay: "#F6E3C4", glazes: ["#3446C4", "#F4B63A", "#8FD0B5"], ink: "#1F1B2E", layout: 1 },
    { bg: "#3446C4", shelf: "#1F1B2E", clay: "#F6E3C4", glazes: ["#E8573D", "#8FD0B5", "#F4B63A"], ink: "#1F1B2E", layout: 2 },
    { bg: "#F4A9B8", shelf: "#1F1B2E", clay: "#F6E3C4", glazes: ["#3446C4", "#E8573D", "#F4B63A"], ink: "#1F1B2E", layout: 3 },
  ],
  avatar: [
    { bg: "#F4B63A", a: "#3446C4", b: "#FFF6E6", c: "#E8573D", kind: 1 },
    { bg: "#8FD0B5", a: "#E8573D", b: "#1F1B2E", c: "#FFF6E6", kind: 2 },
    { bg: "#B9A6E8", a: "#F4B63A", b: "#3446C4", c: "#FFF6E6", kind: 3 },
  ],
};

for (const [key, P] of [["a", A], ["b", B]]) {
  P.mandala.forEach((o, i) => writeFileSync(join(OUT, `${key}-mandala-${i + 1}.svg`), mandala(o)));
  P.tote.forEach((o, i) => writeFileSync(join(OUT, `${key}-tote-${i + 1}.svg`), tote(o)));
  P.pottery.forEach((o, i) => writeFileSync(join(OUT, `${key}-pottery-${i + 1}.svg`), pottery(o)));
  P.avatar.forEach((o, i) => writeFileSync(join(OUT, `${key}-avatar-${i + 1}.svg`), avatar(o)));
}

// The brand mark: one continuous line ("جریان"): a thread that spirals in like a coil of yarn / clay, then flows out as a brush stroke.
function mark({ stroke, accent, width }) {
  let d = "";
  const pts = [];
  for (let t = 0; t <= 5.2; t += 0.1) {
    const r = 6 + t * 5.2;
    pts.push([48 - r * Math.cos(t * 1.9 + 0.6) * -1 + 0, 48 + r * Math.sin(t * 1.9 + 0.6)]);
  }
  d = smooth(pts.map(([x, y]) => [x, y]));
  const tail = ` C${f(pts.at(-1)[0] + 20)} ${f(pts.at(-1)[1] + 30)} 96 70 112 56 S 140 40 150 54`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 96" width="160" height="96" role="img" aria-hidden="true"><path d="${d}${tail}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="48" cy="48" r="${width * 0.9}" fill="${accent}"/></svg>\n`;
}
writeFileSync(join(OUT, "mark-a.svg"), mark({ stroke: "#B5603B", accent: "#6F7048", width: 3.2 }));
writeFileSync(join(OUT, "mark-b.svg"), mark({ stroke: "#3446C4", accent: "#E8573D", width: 8 }));
console.log("placeholders written to", OUT);
