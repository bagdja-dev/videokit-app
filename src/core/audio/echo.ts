// Gema di ujung kalimat: potongan terakhir ucapan (±0,6 dtk, "kata terakhir") dipantulkan beberapa kali,
// makin pelan & makin redup. Satu audio cue = satu kalimat, jadi gema muncul di akhir tiap cue.
// Murni JS (diproses sebelum rangkaian node) → identik di Coba dengar, pratinjau, dan render.

export const END_ECHO_REPEATS = 4;
export const END_ECHO_DEFAULT_DELAY_MS = 350;
const SEGMENT_MS = 600;

/** Panjang ekor maksimum yang ditambahkan setelah akhir ucapan (ms). */
export const endEchoTailMs = (delayMs: number): number => END_ECHO_REPEATS * delayMs + 100;

/** Indeks sampel akhir ucapan (blok 10 ms terakhir yang cukup keras), atau -1 bila hening. */
export function speechEnd(x: Float32Array, sampleRate: number): number {
  const block = Math.max(1, Math.round(sampleRate * 0.01));
  const n = Math.floor(x.length / block);
  const rms = new Float32Array(n);
  let peak = 0;
  for (let b = 0; b < n; b++) {
    let e = 0;
    for (let i = b * block; i < (b + 1) * block; i++) e += x[i]! * x[i]!;
    rms[b] = Math.sqrt(e / block);
    peak = Math.max(peak, rms[b]!);
  }
  if (peak < 1e-4) return -1;
  for (let b = n - 1; b >= 0; b--) if (rms[b]! >= peak * 0.08) return Math.min(x.length, (b + 1) * block);
  return -1;
}

/**
 * Tambahkan gema ujung kalimat. `amount` 0–1 (kekuatan pantulan pertama ≈ 0,6 × amount), `delayMs` jarak antar-pantulan.
 * Hasil bisa lebih panjang dari input (ekor gema setelah ucapan berakhir).
 */
export function endEcho(x: Float32Array, sampleRate: number, amount: number, delayMs = END_ECHO_DEFAULT_DELAY_MS): Float32Array {
  const a = Math.max(0, Math.min(1, amount));
  const end = speechEnd(x, sampleRate);
  if (a < 0.01 || end <= 0) return x.slice();
  const delay = Math.round((Math.max(100, Math.min(1000, delayMs)) / 1000) * sampleRate);
  const segLen = Math.min(end, Math.round((SEGMENT_MS / 1000) * sampleRate));
  const segStart = end - segLen;
  const fadeIn = Math.round(sampleRate * 0.08), fadeOut = Math.round(sampleRate * 0.04);
  const seg = new Float32Array(segLen);
  for (let i = 0; i < segLen; i++) {
    const w = Math.min(1, i / fadeIn, (segLen - i) / fadeOut);
    seg[i] = x[segStart + i]! * w;
  }
  const outLen = Math.max(x.length, end + END_ECHO_REPEATS * delay);
  const out = new Float32Array(outLen);
  out.set(x);
  let lp = 0;
  for (let r = 1; r <= END_ECHO_REPEATS; r++) {
    const gain = 0.6 * a * 0.55 ** (r - 1);
    // Tiap pantulan makin redup: low-pass satu kutub yang makin rendah (seperti pantulan dari jauh).
    const k = Math.exp((-2 * Math.PI * Math.max(1200, 6000 / r)) / sampleRate);
    lp = 0;
    const at = segStart + r * delay;
    for (let i = 0; i < segLen; i++) {
      lp = (1 - k) * seg[i]! + k * lp;
      const o = at + i;
      if (o < outLen) out[o]! += lp * gain;
    }
  }
  return out;
}
