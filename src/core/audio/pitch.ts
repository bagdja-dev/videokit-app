// Geser nada (pitch) tanpa mengubah tempo: regangkan waktu dengan WSOLA (waveform-similarity overlap-add,
// cocok untuk suara bicara) lalu resample kembali ke panjang semula. Murni JS → hasil identik di pratinjau & render.
// Catatan: formant ikut bergeser, jadi pergeseran besar (> ±4 semiton) mulai terdengar tidak alami.

export const PITCH_LIMIT_SEMITONES = 6;

/** Regangkan durasi sebesar `factor` (>1 = lebih panjang) tanpa mengubah nada. */
export function timeStretch(x: Float32Array, sampleRate: number, factor: number): Float32Array {
  if (Math.abs(factor - 1) < 1e-4 || x.length === 0) return x.slice();
  const N = Math.max(256, Math.round(sampleRate * 0.04) & ~1); // frame 40 ms
  const Hs = N / 2;                                            // hop sintesis (overlap 50%)
  const Ha = Hs / factor;                                      // hop analisis
  const tol = Math.round(sampleRate * 0.012);                  // toleransi pencarian ±12 ms
  const outLen = Math.ceil(x.length * factor);
  const out = new Float32Array(outLen + N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); // Hann periodik: OLA 50% = 1
  const at = (i: number) => (i >= 0 && i < x.length ? x[i]! : 0);
  const STEP = 4; // korelasi dihitung tiap 4 sampel — cukup akurat untuk suara, ±4× lebih cepat

  let prevSrc = 0; // posisi sumber frame sebelumnya
  for (let k = 0; k * Hs < outLen; k++) {
    let src = Math.round(k * Ha);
    if (k > 0) {
      // Cari geseran di sekitar posisi ideal yang paling mirip dengan kelanjutan alami frame sebelumnya.
      const natural = prevSrc + Hs;
      let best = 0, bestScore = -Infinity;
      for (let d = -tol; d <= tol; d++) {
        const cand = src + d;
        let score = 0;
        for (let i = 0; i < Hs; i += STEP) score += at(natural + i) * at(cand + i);
        if (score > bestScore) { bestScore = score; best = d; }
      }
      src += best;
    }
    const o = k * Hs;
    for (let i = 0; i < N; i++) out[o + i]! += at(src + i) * win[i]!;
    prevSrc = src;
  }
  return out.subarray(0, outLen);
}

/** Resample linier ke panjang `len`. */
function resampleTo(x: Float32Array, len: number): Float32Array {
  const out = new Float32Array(len);
  if (x.length === 0 || len === 0) return out;
  const step = (x.length - 1) / Math.max(1, len - 1);
  for (let i = 0; i < len; i++) {
    const p = i * step, j = Math.floor(p), f = p - j;
    out[i] = x[j]! * (1 - f) + (x[Math.min(j + 1, x.length - 1)] ?? 0) * f;
  }
  return out;
}

/** Geser nada `semitones` (+ lebih tinggi/ringan, − lebih rendah/berat); panjang tetap sama. */
export function pitchShift(x: Float32Array, sampleRate: number, semitones: number): Float32Array {
  const st = Math.max(-PITCH_LIMIT_SEMITONES, Math.min(PITCH_LIMIT_SEMITONES, semitones));
  if (Math.abs(st) < 0.01) return x.slice();
  const ratio = 2 ** (st / 12);
  return resampleTo(timeStretch(x, sampleRate, ratio), x.length);
}
