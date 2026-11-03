#!/usr/bin/env node
// Generates the two static test assets deterministically (same bytes every run), so they can be committed and verified:
//   web/img/product.png    ~300 KB   a valid PNG full of incompressible noise (like a real product photo's weight)
//   web/data/catalog.json  ~100 KB   obviously fake products (no real names, prices or artists)
// Pure Node, no dependencies. Run: node scripts/make-assets.mjs
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Small deterministic PRNG (mulberry32): the assets never change between runs or machines. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function makePng(width = 320, height = 320, seed = 20261103) {
  const rand = prng(seed);
  const row = 1 + width * 3; // filter byte + RGB
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < width * 3; x++) raw[y * row + 1 + x] = Math.floor(rand() * 256);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}

export function makeCatalog(count = 400, seed = 7) {
  const rand = prng(seed);
  const words = ["نمونه", "آزمایشی", "فرضی", "تست", "اتصال"];
  const products = Array.from({ length: count }, (_, i) => ({
    id: `probe-${String(i + 1).padStart(4, "0")}`,
    slug: `probe-item-${i + 1}`,
    name: `${words[i % words.length]} شمارهٔ ${i + 1}`,
    isDemo: true,
    priceToman: null,
    image: "/img/product.png",
    note: Buffer.from(Array.from({ length: 48 }, () => Math.floor(rand() * 256))).toString("base64"),
  }));
  return `${JSON.stringify({ probe: true, notice: "داده‌های کاملاً فرضی برای آزمون اتصال؛ هیچ محصول یا قیمت واقعی نیست", products }, null, 1)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(join(ROOT, "web/img"), { recursive: true });
  mkdirSync(join(ROOT, "web/data"), { recursive: true });
  const png = makePng();
  const catalog = makeCatalog();
  writeFileSync(join(ROOT, "web/img/product.png"), png);
  writeFileSync(join(ROOT, "web/data/catalog.json"), catalog);
  console.log(`product.png ${png.length} bytes sha256 ${createHash("sha256").update(png).digest("hex").slice(0, 16)}…`);
  console.log(`catalog.json ${Buffer.byteLength(catalog)} bytes`);
}
