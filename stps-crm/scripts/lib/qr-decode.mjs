// Minimaler QR-Decoder nur für Tests (Modulmatrix → Text): Formatinformation (BCH), Maske, Deinterleaving, Reed-Solomon-Fehlerkorrektur
// (Berlekamp-Massey), Byte-Modus. Absichtlich unabhängig von js/vendor/qr-encoder.js geschrieben (eigene Tabellen und Funktionsmuster),
// damit der Encoder nicht gegen sich selbst geprüft wird. Wird nicht ausgeliefert.

// Fehlerkorrektur Stufe M: [Codewörter pro Block, Anzahl Blöcke] je Version 1–40 (Quelle: ISO/IEC 18004, Tabelle 9)
const M_TABLE = [
  [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5],
  [30, 5], [22, 8], [22, 9], [24, 9], [24, 10], [28, 10], [28, 11], [26, 13], [26, 14], [26, 16],
  [26, 17], [28, 17], [28, 18], [28, 20], [28, 21], [28, 23], [28, 25], [28, 26], [28, 28], [28, 29],
  [28, 31], [28, 33], [28, 35], [28, 37], [28, 38], [28, 40], [28, 43], [28, 45], [28, 47], [28, 49],
];

const EXP = [], LOG = [];
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = (x << 1) ^ (x & 0x80 ? 0x11d : 0); } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const div = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);
const pow = (a, n) => EXP[(LOG[a] * n) % 255];

const evalPoly = (c, x) => { let r = 0; for (let i = c.length - 1; i >= 0; i--) r = mul(r, x) ^ c[i]; return r; }; // Koeffizienten niedrigstes Glied zuerst
const popcount = (v) => { let c = 0; while (v) { c += v & 1; v >>>= 1; } return c; };

function formatWord(data) { let r = data; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); return ((data << 10) | r) ^ 0x5412; }

export function totalCodewords(ver) {
  const size = ver * 4 + 17;
  // Anzahl Datenmodule = Gesamtfläche − Funktionsmuster; unabhängig über das Funktionsmuster-Raster berechnet
  const fn = functionMap(ver, size);
  let n = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x]) n++;
  return Math.floor(n / 8);
}

function functionMap(ver, size) {
  const f = Array.from({ length: size }, () => new Array(size).fill(false));
  const rect = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) f[y][x] = true; };
  rect(0, 0, 9, 9); rect(size - 8, 0, 8, 9); rect(0, size - 8, 9, 8); // Finder + Trennlinie + Formatbereich
  rect(6, 0, 1, size); rect(0, 6, size, 1); // Timing
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    const last = size - 7;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (2 * n - 2)) * 2;
    const pos = [6, ...Array.from({ length: n - 1 }, (_, i) => last - (n - 2 - i) * step)];
    for (const cy of pos) for (const cx of pos) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)) continue;
      rect(cx - 2, cy - 2, 5, 5);
    }
  }
  if (ver >= 7) { rect(size - 11, 0, 3, 6); rect(0, size - 11, 6, 3); }
  return f;
}

const MASK = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function readFormat(m, size) {
  // Kopie 1 (um den linken oberen Finder), Bit 14 … 0 in dieser Reihenfolge
  const pos1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]; // [row, col], Bit 14 → 0
  let w1 = 0;
  for (const [r, c] of pos1) w1 = (w1 << 1) | (m[r][c] ? 1 : 0);
  // Kopie 2: Bits 14…8 in Spalte 8 von unten, Bits 7…0 in Zeile 8 von rechts
  const pos2 = [];
  for (let i = 0; i < 7; i++) pos2.push([size - 1 - i, 8]); // Bit 14 … 8
  for (let i = 0; i < 8; i++) pos2.push([8, size - 8 + i]); // Bit 7 … 0
  let w2 = 0;
  for (const [r, c] of pos2) w2 = (w2 << 1) | (m[r][c] ? 1 : 0);
  let best = null;
  for (const w of [w1, w2]) {
    for (let data = 0; data < 32; data++) {
      const d = popcount(formatWord(data) ^ w);
      if (d <= 3 && (!best || d < best.d)) best = { d, data };
    }
  }
  if (!best) throw new Error("Formatinformation nicht lesbar");
  return { ecl: best.data >> 3, mask: best.data & 7 };
}

function rsCorrect(block, eccLen) {
  const n = block.length;
  const S = [];
  let any = false;
  for (let j = 0; j < eccLen; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s = mul(s, EXP[j]) ^ block[i]; // Horner, höchstes Glied zuerst
    S.push(s);
    if (s) any = true;
  }
  if (!any) return { data: block.slice(0, n - eccLen), fixed: 0 };
  // Berlekamp-Massey (Koeffizienten niedrigstes Glied zuerst)
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let i = 0; i < eccLen; i++) {
    let d = S[i];
    for (let k = 1; k <= L; k++) d ^= mul(C[k] || 0, S[i - k]);
    if (!d) { m++; continue; }
    const T = C.slice();
    const coef = div(d, b);
    const need = B.length + m;
    while (C.length < need) C.push(0);
    for (let k = 0; k < B.length; k++) C[k + m] ^= mul(coef, B[k]);
    if (2 * L <= i) { L = i + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  if (L > eccLen / 2) throw new Error("Zu viele Fehler");
  // Ω = S·Λ mod x^eccLen
  const omega = new Array(eccLen).fill(0);
  for (let i = 0; i < eccLen; i++) for (let k = 0; k <= Math.min(i, C.length - 1); k++) omega[i] ^= mul(C[k], S[i - k]);
  const out = block.slice();
  let fixed = 0;
  for (let k = 0; k < n; k++) { // Fehler an Potenz k (Index n−1−k im Block)
    const xInv = EXP[(255 - (k % 255)) % 255];
    if (evalPoly(C, xInv)) continue;
    const om = evalPoly(omega, xInv);
    const dC = C.slice(1).map((v, i) => (i % 2 === 0 ? v : 0)); // formale Ableitung: ungerade Potenzen
    const dl = evalPoly(dC, xInv);
    out[n - 1 - k] ^= mul(EXP[k % 255], div(om, dl));
    fixed++;
  }
  if (fixed !== L) throw new Error("Fehlerkorrektur fehlgeschlagen");
  for (let j = 0; j < eccLen; j++) { let s = 0; for (let i = 0; i < n; i++) s = mul(s, EXP[j]) ^ out[i]; if (s) throw new Error("Restfehler"); }
  return { data: out.slice(0, n - eccLen), fixed };
}

/** @param {boolean[][]} m Modulmatrix [Zeile][Spalte], true = dunkel → { text, version, mask, corrected } */
export function decodeMatrix(m) {
  const size = m.length;
  const ver = (size - 17) / 4;
  if (!Number.isInteger(ver) || ver < 1 || ver > 40) throw new Error(`Ungültige Grösse ${size}`);
  const { ecl, mask } = readFormat(m, size);
  if (ecl !== 0) throw new Error(`Fehlerkorrekturstufe ${ecl} ≠ M`);
  const fn = functionMap(ver, size);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const c = right - j;
      const r = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (fn[r][c]) continue;
      bits.push(Boolean(m[r][c]) !== MASK[mask](r, c) ? 1 : 0);
    }
  }
  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  const [eccLen, nb] = M_TABLE[ver - 1];
  const total = words.length;
  const shortCount = nb - (total % nb);
  const shortLen = Math.floor(total / nb);
  const lens = Array.from({ length: nb }, (_, i) => shortLen + (i < shortCount ? 0 : 1)); // Blocklänge inkl. ECC
  const blocks = lens.map(() => []);
  let k = 0;
  const maxData = shortLen - eccLen + 1;
  for (let i = 0; i < maxData; i++) for (let b = 0; b < nb; b++) if (i < lens[b] - eccLen) blocks[b].push(words[k++]);
  for (let i = 0; i < eccLen; i++) for (let b = 0; b < nb; b++) blocks[b].push(words[k++]);
  let corrected = 0;
  const data = [];
  for (let b = 0; b < nb; b++) { const r = rsCorrect(blocks[b], eccLen); corrected += r.fixed; data.push(...r.data); }
  // Datenstrom: Modus 0100, Zähler (8/16 Bit), Bytes
  const stream = data.map((v) => v.toString(2).padStart(8, "0")).join("");
  if (stream.slice(0, 4) !== "0100") throw new Error(`Modus ${stream.slice(0, 4)} ≠ Byte`);
  const cb = ver <= 9 ? 8 : 16;
  const n = parseInt(stream.slice(4, 4 + cb), 2);
  const bytes = [];
  for (let i = 0; i < n; i++) bytes.push(parseInt(stream.slice(4 + cb + i * 8, 12 + cb + i * 8), 2));
  return { text: Buffer.from(bytes).toString("utf8"), version: ver, mask, corrected };
}
