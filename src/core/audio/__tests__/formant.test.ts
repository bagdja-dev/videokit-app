import { describe, expect, it } from 'vitest';
import { estimatePeriods, formantFactor, formantShift } from '../formant';

const SR = 16_000, F0 = 150, PEAK = 1000;
/** Suara sintetis: harmonik 150 Hz dengan selubung spektrum (formant) berpuncak di 1 kHz. */
const voice = () => Float32Array.from({ length: SR }, (_, i) => {
  let s = 0;
  for (let k = 1; k * F0 < SR / 2; k++) s += Math.exp(-(((k * F0 - PEAK) / 350) ** 2)) * Math.sin((2 * Math.PI * k * F0 * i) / SR);
  return s * 0.3;
});
/** Pusat spektrum (Hz): DFT rapat tiap 10 Hz (50–4000 Hz) dengan jendela Hann pada bagian tengah sinyal. */
const centroid = (x: Float32Array) => {
  const a = Math.floor(x.length * 0.2), b = Math.floor(x.length * 0.8), n = b - a;
  let num = 0, den = 0;
  for (let hz = 50; hz <= 4000; hz += 10) {
    const w = (2 * Math.PI * hz) / SR;
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const v = x[a + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
      re += v * Math.cos(w * i); im += v * Math.sin(w * i);
    }
    const e = re * re + im * im;
    num += e * hz; den += e;
  }
  return num / den;
};
const medianPeriodHz = (x: Float32Array) => {
  const p = Array.from(estimatePeriods(x, SR).periods).filter((v) => v > 0).sort((u, v) => u - v);
  return SR / p[Math.floor(p.length / 2)]!;
};

describe('formantShift', () => {
  it('deteksi periode suara sintetis ≈ 150 Hz', () => {
    expect(medianPeriodHz(voice())).toBeGreaterThan(140);
    expect(medianPeriodHz(voice())).toBeLessThan(160);
  });
  it('+1 (tebal): pusat spektrum turun ±×0,79, nada & panjang tetap', () => {
    const x = voice(), y = formantShift(x, SR, 1);
    expect(y.length).toBe(x.length);
    const ratio = centroid(y) / centroid(x);
    expect(ratio).toBeGreaterThan(formantFactor(1) * 0.9);
    expect(ratio).toBeLessThan(formantFactor(1) * 1.1);
    expect(medianPeriodHz(y)).toBeGreaterThan(140);
    expect(medianPeriodHz(y)).toBeLessThan(160);
  });
  it('−1 (tipis): pusat spektrum naik, nada tetap', () => {
    const x = voice(), y = formantShift(x, SR, -1);
    const ratio = centroid(y) / centroid(x);
    expect(ratio).toBeGreaterThan(formantFactor(-1) * 0.9);
    expect(ratio).toBeLessThan(formantFactor(-1) * 1.1);
    expect(medianPeriodHz(y)).toBeGreaterThan(140);
    expect(medianPeriodHz(y)).toBeLessThan(160);
  });
  it('0 = salinan asli', () => {
    const x = voice();
    expect(formantShift(x, SR, 0)).toEqual(x);
  });
});
