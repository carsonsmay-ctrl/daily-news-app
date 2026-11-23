#!/usr/bin/env node
// Generates the PWA icons (PNG + SVG) with no image dependencies: a tiny rasterizer + PNG encoder.
// Design: navy tile, a white "page" with a bold headline bar and text lines, and a green sunrise dot.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
fs.mkdirSync(OUT, { recursive: true });

const NAVY = [15, 42, 61];
const PAPER = [246, 244, 239];
const INK = [15, 42, 61];
const LINE = [150, 163, 175];
const GREEN = [60, 160, 98];

// Shapes in a 0..1 coordinate space. `pad` shrinks the artwork toward the centre (for maskable icons).
function shapes(pad) {
  const s = (v) => pad + v * (1 - 2 * pad);
  const rect = (x, y, w, h, r, color) => ({ kind: "rect", x: s(x), y: s(y), w: w * (1 - 2 * pad), h: h * (1 - 2 * pad), r: r * (1 - 2 * pad), color });
  return [
    rect(0.2, 0.17, 0.6, 0.66, 0.06, PAPER),
    { kind: "circle", cx: s(0.69), cy: s(0.3), r: 0.065 * (1 - 2 * pad), color: GREEN },
    rect(0.28, 0.25, 0.32, 0.09, 0.02, INK),
    rect(0.28, 0.43, 0.44, 0.045, 0.02, LINE),
    rect(0.28, 0.53, 0.44, 0.045, 0.02, LINE),
    rect(0.28, 0.63, 0.3, 0.045, 0.02, LINE),
  ];
}

function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function render(size, { pad = 0, cornerRadius = 0 } = {}) {
  const SS = 4; // supersampling for anti-aliasing
  const list = shapes(pad);
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (cornerRadius && !insideRoundRect(u, v, 0, 0, 1, 1, cornerRadius)) continue;
          let c = NAVY;
          for (const sh of list) {
            if (sh.kind === "rect" ? insideRoundRect(u, v, sh.x, sh.y, sh.w, sh.h, sh.r) : (u - sh.cx) ** 2 + (v - sh.cy) ** 2 <= sh.r ** 2) c = sh.color;
          }
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const cov = a / n / 255;
      px[i] = cov ? Math.round(r / n / cov) : 0;
      px[i + 1] = cov ? Math.round(g / n / cov) : 0;
      px[i + 2] = cov ? Math.round(b / n / cov) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function svg() {
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  const body = shapes(0)
    .map((s) =>
      s.kind === "rect"
        ? `<rect x="${(s.x * 512).toFixed(1)}" y="${(s.y * 512).toFixed(1)}" width="${(s.w * 512).toFixed(1)}" height="${(s.h * 512).toFixed(1)}" rx="${(s.r * 512).toFixed(1)}" fill="${hex(s.color)}"/>`
        : `<circle cx="${(s.cx * 512).toFixed(1)}" cy="${(s.cy * 512).toFixed(1)}" r="${(s.r * 512).toFixed(1)}" fill="${hex(s.color)}"/>`,
    )
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n  <rect width="512" height="512" rx="112" fill="${hex(NAVY)}"/>\n  ${body}\n</svg>\n`;
}

const files = {
  "icon-192.png": render(192, { cornerRadius: 0.22 }),
  "icon-512.png": render(512, { cornerRadius: 0.22 }),
  "icon-maskable-512.png": render(512, { pad: 0.1 }), // full-bleed, artwork inside the 80% safe zone
  "apple-touch-icon.png": render(180), // iOS rounds the corners itself
  "favicon-32.png": render(32, { cornerRadius: 0.22 }),
  "icon.svg": svg(),
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`wrote public/icons/${name}`);
}
