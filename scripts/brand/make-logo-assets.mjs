// Derives the web assets of the OFFICIAL logo from the untouched original (brand/original/jaryan-ma-logo-official.jpg).
//   node scripts/brand/make-logo-assets.mjs
// Nothing is redrawn: the cream shapes are extracted by colour (alpha = how far a pixel is from the burgundy field towards the cream
// of the logo), so anti-aliased edges and the hairlines stay exactly as designed. The script prints a fidelity check: the transparent
// logo laid back on the sampled burgundy must reproduce the original pixels. Dev tool only (uses `sharp`, which ships with Next.js).
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const SRC = "brand/original/jaryan-ma-logo-official.jpg";
const OUT = "public/brand";
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const px = (x, y) => [data[(y * W + x) * 3], data[(y * W + x) * 3 + 1], data[(y * W + x) * 3 + 2]];

// 1. Sample the real colours: the most common colour, and the most common light colour.
const votes = new Map();
const lightVotes = new Map();
for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
  const p = px(x, y);
  const key = p.join(",");
  votes.set(key, (votes.get(key) ?? 0) + 1);
  if (p[0] + p[1] + p[2] > 540) lightVotes.set(key, (lightVotes.get(key) ?? 0) + 1);
}
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
const bg = top(votes);
const cream = top(lightVotes);
const near = (p, c, tol) => Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol && Math.abs(p[2] - c[2]) <= tol;
console.log(`sampled burgundy ${hex(bg)}  cream ${hex(cream)}`);

// 2. The artwork is the area inside the black screenshot bars: rows that are burgundy edge to edge.
const rowIsField = (y) => { for (let x = 0; x < W; x += 10) if (!near(px(x, y), bg, 14) && !(px(x, y)[0] > 120)) return false; return near(px(2, y), bg, 14) && near(px(W - 3, y), bg, 14); };
let y0 = 0; while (!rowIsField(y0)) y0++;
let y1 = H - 1; while (!rowIsField(y1)) y1--;
y0 += 2; y1 -= 2; // clear of the bar's soft edge
const AH = y1 - y0 + 1;
console.log(`artwork area: ${W}x${AH} (rows ${y0}..${y1} of ${H})`);

// 3. Alpha = projection of the pixel on the burgundy->cream line.
const d = cream.map((v, i) => v - bg[i]);
const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
const alpha = new Float32Array(W * AH);
for (let y = 0; y < AH; y++) for (let x = 0; x < W; x++) {
  const p = px(x, y + y0);
  let t = ((p[0] - bg[0]) * d[0] + (p[1] - bg[1]) * d[1] + (p[2] - bg[2]) * d[2]) / dd;
  t = t < 0.03 ? 0 : t > 0.985 ? 1 : t; // JPEG noise in the flat field is not part of the logo
  alpha[y * W + x] = t;
}

// 4. Bounding box of the mark (with a small margin), so no empty square is left around it.
let minX = W, minY = AH, maxX = 0, maxY = 0;
for (let y = 0; y < AH; y++) for (let x = 0; x < W; x++) if (alpha[y * W + x] > 0.08) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
const m = 6;
minX = Math.max(0, minX - m); minY = Math.max(0, minY - m); maxX = Math.min(W - 1, maxX + m); maxY = Math.min(AH - 1, maxY + m);
const cw = maxX - minX + 1;
const ch = maxY - minY + 1;
console.log(`mark box: ${cw}x${ch}`);

const build = (color) => {
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const o = (y * cw + x) * 4;
    out[o] = color[0]; out[o + 1] = color[1]; out[o + 2] = color[2];
    out[o + 3] = Math.round(alpha[(y + minY) * W + x + minX] * 255);
  }
  return out;
};
mkdirSync(OUT, { recursive: true });
const png = (buf, file, height) =>
  sharp(buf, { raw: { width: cw, height: ch, channels: 4 } }).resize({ height, kernel: "lanczos3" }).png({ compressionLevel: 9, palette: false }).toFile(`${OUT}/${file}`);

// Cream (the logo's own colours, for burgundy fields) and burgundy (the same shapes reversed, for light surfaces).
for (const [name, color] of [["cream", cream], ["burgundy", bg]]) {
  const buf = build(color);
  await png(buf, `jaryan-ma-mark-${name}.png`, 960);
  await png(buf, `jaryan-ma-mark-${name}-240.png`, 240);
}

// 5. Fidelity check: lay the cream mark back on the sampled burgundy and compare with the original pixels.
const cream960 = build(cream);
let sum = 0; let worst = 0;
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
  const a = cream960[(y * cw + x) * 4 + 3] / 255;
  const p = px(x + minX, y + minY + y0);
  for (let k = 0; k < 3; k++) { const v = Math.round(bg[k] * (1 - a) + cream[k] * a); const e = Math.abs(v - p[k]); sum += e; if (e > worst) worst = e; }
}
console.log(`fidelity: mean abs error ${(sum / (cw * ch * 3)).toFixed(3)} / 255, worst ${worst} (JPEG noise only)`);

// 6. App icons: the ORIGINAL square artwork (burgundy field and all), cropped to a square and scaled, never redrawn.
const side = Math.min(W, AH);
const sx = Math.floor((W - side) / 2);
const sy = Math.floor((AH - side) / 2) + y0;
const square = () => sharp(SRC).extract({ left: sx, top: sy, width: side, height: side });
await square().resize(512, 512, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toFile("src/app/icon.png");
await square().resize(180, 180, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toFile("src/app/apple-icon.png");
await square().resize(1200, 1200, { kernel: "lanczos3" }).jpeg({ quality: 90, mozjpeg: true }).toFile(`${OUT}/jaryan-ma-logo-square.jpg`);

console.log(JSON.stringify({ width: cw, height: ch, ratio: +(cw / ch).toFixed(4) }));
console.log("done");
