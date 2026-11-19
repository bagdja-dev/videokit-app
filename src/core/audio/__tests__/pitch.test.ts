import { describe, expect, it } from 'vitest';
import { pitchShift, timeStretch } from '../pitch';

const SR = 16_000;
const sine = (hz: number, seconds: number) => Float32Array.from({ length: SR * seconds }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR));
/** Perkiraan frekuensi dari jumlah persilangan nol (bagian tengah, hindari tepi). */
const freq = (x: Float32Array) => {
  const a = Math.floor(x.length * 0.2), b = Math.floor(x.length * 0.8);
  let n = 0;
  for (let i = a + 1; i < b; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) n++;
  return n / 2 / ((b - a) / SR);
};

describe('pitchShift', () => {
  it('+6 semiton menaikkan frekuensi ×√2, panjang tetap', () => {
    const y = pitchShift(sine(200, 1), SR, 6);
    expect(y.length).toBe(SR);
    expect(freq(y)).toBeGreaterThan(200 * Math.SQRT2 * 0.95);
    expect(freq(y)).toBeLessThan(200 * Math.SQRT2 * 1.05);
  });
  it('−4 semiton menurunkan frekuensi ±26%', () => {
    const y = pitchShift(sine(300, 1), SR, -4);
    expect(freq(y)).toBeGreaterThan(300 * 2 ** (-4 / 12) * 0.95);
    expect(freq(y)).toBeLessThan(300 * 2 ** (-4 / 12) * 1.05);
  });
  it('0 semiton = salinan asli; nilai dibatasi ±6', () => {
    const x = sine(200, 0.5);
    expect(pitchShift(x, SR, 0)).toEqual(x);
    expect(freq(pitchShift(sine(200, 1), SR, 40))).toBeLessThan(200 * 2 ** (6 / 12) * 1.05);
  });
});

describe('timeStretch', () => {
  it('memperpanjang durasi tanpa mengubah nada', () => {
    const y = timeStretch(sine(250, 1), SR, 1.5);
    expect(y.length).toBe(Math.ceil(SR * 1.5));
    expect(freq(y)).toBeGreaterThan(240);
    expect(freq(y)).toBeLessThan(260);
  });
});
