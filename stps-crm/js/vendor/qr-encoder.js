/*!
 * qr-encoder.js – small QR Code (Model 2) encoder, byte mode, versions 1–40, error correction level M.
 *
 * MIT License
 * Copyright (c) 2026 STPS CRM contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
 * persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Written from ISO/IEC 18004 (data layout, Reed-Solomon over GF(256)/0x11D, mask penalty rules). No dependencies,
 * no DOM access (runs in browsers and Node). Only what the Swiss QR-bill needs is implemented: UTF-8 bytes, level M.
 */

// Error-correction codewords per block and number of blocks, level M, index = version − 1.
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const NUM_BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

/** Number of data+ecc modules (without function patterns) of a version, in bits */
function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const rawCodewords = (ver) => Math.floor(rawModules(ver) / 8);
/** Data codewords (capacity) of a version at level M */
export const dataCapacity = (ver) => rawCodewords(ver) - ECC_PER_BLOCK[ver - 1] * NUM_BLOCKS[ver - 1];

// ------------------------------------------------------------ Reed-Solomon over GF(2^8), polynomial x^8+x^4+x^3+x^2+1

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gmul(g[j], EXP[i]);
    }
    g = next;
  }
  return g; // highest power first, leading coefficient 1
}

function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const d of data) {
    const factor = d ^ rem.shift();
    rem.push(0);
    if (factor) for (let i = 0; i < degree; i++) rem[i] ^= gmul(gen[i + 1], factor);
  }
  return rem;
}

// ------------------------------------------------------------ Bits

function utf8(text) {
  if (typeof TextEncoder !== "undefined") return [...new TextEncoder().encode(String(text))];
  return [...Buffer.from(String(text), "utf8")];
}

function buildCodewords(bytes, ver) {
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4); // byte mode
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCapacity(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; out.length < dataCapacity(ver); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Data codewords → data + ecc codewords, split into blocks and interleaved */
function interleave(data, ver) {
  const nb = NUM_BLOCKS[ver - 1], eccLen = ECC_PER_BLOCK[ver - 1];
  const raw = rawCodewords(ver);
  const shortCount = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - eccLen + (i < shortCount ? 0 : 1);
    const d = data.slice(k, k + len);
    k += len;
    blocks.push({ d, e: rsRemainder(d, eccLen) });
  }
  const out = [];
  const maxData = shortLen - eccLen + 1;
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

// ------------------------------------------------------------ Matrix

function alignPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const pos = [6];
  for (let p = size - 7, i = n - 1; i >= 1; i--, p -= step) pos.splice(1, 0, p);
  return pos;
}

function formatBits(mask) {
  const data = mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function penalty(m, size) {
  let p = 0;
  // runs of ≥ 5 equal modules in rows and columns
  for (let a = 0; a < size; a++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const cur = horizontal ? m[a][b] : m[b][a];
        const prev = horizontal ? m[a][b - 1] : m[b - 1][a];
        if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1;
      }
    }
  }
  // 2×2 blocks
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
  }
  // finder-like patterns 1:1:3:1:1 with four light modules on one side
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let a = 0; a < size; a++) {
    for (let b = 0; b + 11 <= size; b++) {
      let h1 = true, h2 = true, v1 = true, v2 = true;
      for (let k = 0; k < 11; k++) {
        const hv = m[a][b + k] ? 1 : 0, vv = m[b + k][a] ? 1 : 0;
        if (hv !== A[k]) h1 = false;
        if (hv !== B[k]) h2 = false;
        if (vv !== A[k]) v1 = false;
        if (vv !== B[k]) v2 = false;
      }
      p += 40 * ((h1 ? 1 : 0) + (h2 ? 1 : 0) + (v1 ? 1 : 0) + (v2 ? 1 : 0));
    }
  }
  // dark proportion
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = size * size;
  p += 10 * (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1);
  return p;
}

/**
 * Encode text (UTF-8, byte mode) at error correction level M.
 * @param {string} text
 * @param {{minVersion?:number, maxVersion?:number}} [opt]
 * @returns {{version:number, size:number, mask:number, modules:boolean[][]}} modules[y][x] = true for dark
 */
export function encode(text, { minVersion = 1, maxVersion = 40 } = {}) {
  const bytes = utf8(text);
  let ver = minVersion;
  for (; ver <= maxVersion; ver++) {
    const used = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    if (used <= dataCapacity(ver) * 8) break;
  }
  if (ver > maxVersion) throw new RangeError("Text too long for a QR code");
  const size = ver * 4 + 17;
  const all = interleave(buildCodewords(bytes, ver), ver);

  const mods = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mods[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); } // timing
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) { // finder + separator
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  const ap = alignPositions(ver);
  for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mask) => {
    const bits = formatBits(mask), bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // always-dark module
  };
  drawFormat(0); // reserve the area
  if (ver >= 7) {
    const bits = versionBits(ver);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark); set(b, a, dark);
    }
  }

  // data placement (zig-zag, right to left in column pairs, skipping the vertical timing pattern)
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && bitIdx < all.length * 8) {
          mods[y][x] = ((all[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
          bitIdx++;
        }
      }
    }
  }

  // choose the mask with the lowest penalty
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const trial = mods.map((row) => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) trial[y][x] = !trial[y][x];
    // draw the format bits into the trial before scoring
    const bits = formatBits(mask), bit = (i) => ((bits >>> i) & 1) !== 0;
    const put = (x, y, d) => { trial[y][x] = d; };
    for (let i = 0; i <= 5; i++) put(8, i, bit(i));
    put(8, 7, bit(6)); put(8, 8, bit(7)); put(7, 8, bit(8));
    for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
    put(8, size - 8, true);
    const score = penalty(trial, size);
    if (!best || score < best.score) best = { score, mask, modules: trial };
  }
  return { version: ver, size, mask: best.mask, modules: best.modules };
}

/**
 * SVG path (one `M x y h w v1 h-w z` per horizontal run of dark modules) in module units, for use as <path d="…"/>.
 */
export function toPath(modules) {
  const parts = [];
  for (let y = 0; y < modules.length; y++) {
    const row = modules[y];
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let w = 1;
      while (x + w < row.length && row[x + w]) w++;
      parts.push(`M${x} ${y}h${w}v1h-${w}z`);
      x += w - 1;
    }
  }
  return parts.join("");
}
