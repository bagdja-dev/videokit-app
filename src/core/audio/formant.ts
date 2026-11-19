// Geser formant (ketebalan suara) TANPA mengubah nada: PSOLA dengan grain yang di-resample.
// - Periode nada dideteksi per 10 ms (autokorelasi pada sinyal 12 kHz) → tanda grain berjarak 1 periode.
// - Tiap grain (2 periode, jendela Hann) dibaca dengan laju `f`: isi spektrumnya (formant) bergeser ×f.
// - Grain ditempatkan di posisi asal, jadi jarak antar-grain (= nada) tidak berubah.
// Bagian tak bersuara (desis, "s", jeda) memakai grain 5 ms tetap.

/** amount −1…+1: + lebih tebal (formant turun), − lebih tipis (formant naik). */
export const formantFactor = (amount: number): number => 2 ** (-Math.max(-1, Math.min(1, amount)) / 3);

const DET_RATE = 12_000;
const MIN_HZ = 60, MAX_HZ = 400;

/** Periode nada (sampel asli, pecahan) per blok `hop` sampel; 0 = tak bersuara. */
export function estimatePeriods(x: Float32Array, sampleRate: number): { hop: number; periods: Float32Array } {
  const D = Math.max(1, Math.round(sampleRate / DET_RATE));
  const rate = sampleRate / D;
  const ds = new Float32Array(Math.floor(x.length / D));
  for (let i = 0; i < ds.length; i++) {
    let s = 0;
    for (let k = 0; k < D; k++) s += x[i * D + k]!;
    ds[i] = s / D;
  }
  const W = Math.round(rate * 0.03), hop = Math.round(rate * 0.01);
  const minLag = Math.floor(rate / MAX_HZ), maxLag = Math.ceil(rate / MIN_HZ);
  let peak = 0;
  for (let i = 0; i < ds.length; i++) peak = Math.max(peak, Math.abs(ds[i]!));
  const frames = Math.max(1, Math.ceil(ds.length / hop));
  const raw = new Float32Array(frames);
  const r = new Float32Array(maxLag + 1);
  for (let f = 0; f < frames; f++) {
    const s0 = f * hop;
    if (s0 + W + maxLag >= ds.length) { raw[f] = 0; continue; }
    let e0 = 0;
    for (let i = 0; i < W; i++) e0 += ds[s0 + i]! ** 2;
    if (Math.sqrt(e0 / W) < peak * 0.03) { raw[f] = 0; continue; } // hening/sangat pelan
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0, e1 = 0;
      for (let i = 0; i < W; i++) { const b = ds[s0 + i + lag]!; c += ds[s0 + i]! * b; e1 += b * b; }
      r[lag] = c / Math.sqrt(e0 * e1 + 1e-12);
      if (r[lag]! > best) best = r[lag]!;
    }
    if (best < 0.5) { raw[f] = 0; continue; }
    // Hindari salah oktaf: ambil lag TERKECIL yang hampir sebaik puncaknya.
    let lag = minLag;
    while (lag < maxLag && r[lag]! < best * 0.85) lag++;
    while (lag < maxLag && r[lag + 1]! > r[lag]!) lag++; // naik ke puncak lokal
    // Interpolasi parabola → periode pecahan (periode bulat membuat grain bergeser fase sedikit demi sedikit).
    let frac = 0;
    if (lag > minLag && lag < maxLag) {
      const a = r[lag - 1]!, b = r[lag]!, c = r[lag + 1]!;
      const den = a - 2 * b + c;
      if (den < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
    }
    raw[f] = (lag + frac) * D;
  }
  // Median 3 frame agar tanda grain tidak meloncat-loncat.
  const periods = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = raw[Math.max(0, f - 1)]!, b = raw[f]!, c = raw[Math.min(frames - 1, f + 1)]!;
    periods[f] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  return { hop: hop * D, periods };
}

/** Geser formant sebesar `amount` (−1…+1); nada & panjang tetap. */
export function formantShift(x: Float32Array, sampleRate: number, amount: number): Float32Array {
  const f = formantFactor(amount);
  if (Math.abs(f - 1) < 1e-3 || x.length === 0) return x.slice();
  const { hop, periods } = estimatePeriods(x, sampleRate);
  const unvoiced = Math.round(sampleRate * 0.005);
  const out = new Float32Array(x.length);
  const norm = new Float32Array(x.length);
  const at = (p: number) => {
    const j = Math.floor(p), t = p - j;
    if (j < 0 || j + 1 >= x.length) return 0;
    return x[j]! * (1 - t) + x[j + 1]! * t;
  };
  for (let m = 0; m < x.length;) {
    const P = periods[Math.min(periods.length - 1, Math.floor(m / hop))]! || unvoiced;
    const o0 = Math.max(0, Math.ceil(m - P)), o1 = Math.min(x.length - 1, Math.floor(m + P));
    for (let o = o0; o <= o1; o++) {
      const j = o - m; // pecahan: tanda grain tidak harus di sampel bulat
      const w = 0.5 + 0.5 * Math.cos((Math.PI * j) / P); // Hann sepanjang 2P, puncak di tanda grain
      out[o]! += at(m + j * f) * w;
      norm[o]! += w;
    }
    m += P;
  }
  for (let i = 0; i < out.length; i++) if (norm[i]! > 1e-3) out[i]! /= norm[i]!;
  return out;
}
