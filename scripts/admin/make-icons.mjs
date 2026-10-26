// Generates the PWA icons (PNG) with a tiny dependency-free rasteriser: a woven wall-hanging motif in the brand
// colours. Deterministic, so the committed files can be regenerated and diffed:  npm run admin:icons
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BARK = [0x2e, 0x23, 0x18];
const SAND = [0xdd, 0xcd, 0xb0];
const IVORY = [0xfd, 0xfb, 0xf6];
const OLIVE = [0x7a, 0x84, 0x56];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Colour at (x, y) in a unit square [0,1]²; `scale` shrinks the motif for maskable icons (safe zone). */
function motif(x, y, scale) {
  const u = (x - 0.5) / scale;
  const v = (y - 0.5) / scale;
  const diamond = Math.abs(u) + Math.abs(v - 0.02);
  if (diamond < 0.17) return OLIVE; // centre of the pattern
  if (diamond < 0.3) return IVORY;
  if (diamond < 0.38) return SAND;
  const inPanel = Math.abs(u) < 0.34 && v > -0.4 && v < 0.3;
  if (inPanel) return null;
  // rod across the top and fringe below the panel
  if (Math.abs(u) < 0.42 && v > -0.46 && v < -0.4) return SAND;
  if (v >= 0.3 && v < 0.5 && Math.abs(u) < 0.34) return Math.floor((u + 0.34) / 0.068) % 2 === 0 ? SAND : null;
  return null;
}

function icon(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 3; // 3x3 supersampling
  const radius = maskable ? 0 : 0.2; // maskable icons are full-bleed; the OS applies its own mask
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          // rounded-square mask
          const dx = Math.max(Math.abs(x - 0.5) - (0.5 - radius), 0);
          const dy = Math.max(Math.abs(y - 0.5) - (0.5 - radius), 0);
          if (radius > 0 && dx * dx + dy * dy > radius * radius) continue;
          const c = motif(x, y, maskable ? 0.72 : 0.92) ?? BARK;
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      const cover = a / (255 * n);
      rgba[i] = cover ? Math.round(r / (cover * n)) : 0;
      rgba[i + 1] = cover ? Math.round(g / (cover * n)) : 0;
      rgba[i + 2] = cover ? Math.round(b / (cover * n)) : 0;
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return png(size, rgba);
}

const dir = join(import.meta.dirname, "../../admin/public/icons");
mkdirSync(dir, { recursive: true });
for (const [name, size, maskable] of [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["icon-maskable-512.png", 512, true], ["apple-touch-icon.png", 180, true]]) {
  writeFileSync(join(dir, name), icon(size, { maskable }));
  console.log("wrote", name);
}
