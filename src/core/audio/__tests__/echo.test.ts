import { describe, expect, it } from 'vitest';
import { END_ECHO_REPEATS, endEcho, speechEnd } from '../echo';

const SR = 16_000;
/** 1 dtk "ucapan" (sinus 220 Hz) lalu 0,5 dtk hening. */
const clip = () => Float32Array.from({ length: SR * 1.5 }, (_, i) => (i < SR ? 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR) : 0));
const rms = (x: Float32Array, a: number, b: number) => { let e = 0; for (let i = a; i < b; i++) e += x[i]! ** 2; return Math.sqrt(e / (b - a)); };

describe('endEcho', () => {
  it('mendeteksi akhir ucapan (bukan akhir berkas)', () => {
    expect(Math.abs(speechEnd(clip(), SR) - SR)).toBeLessThanOrEqual(SR * 0.01);
  });
  it('menambah pantulan setelah ucapan berakhir, makin pelan, dan memperpanjang klip bila perlu', () => {
    const delay = 300, d = (delay / 1000) * SR;
    const y = endEcho(clip(), SR, 1, delay);
    expect(y.length).toBe(SR + END_ECHO_REPEATS * d);
    const e1 = rms(y, SR + 0.05 * SR, SR + d), e3 = rms(y, SR + 2 * d + 0.05 * SR, SR + 3 * d);
    expect(e1).toBeGreaterThan(0.05);
    expect(e3).toBeLessThan(e1);
    // bagian awal ucapan tidak berubah
    expect(Array.from(y.subarray(0, SR * 0.3))).toEqual(Array.from(clip().subarray(0, SR * 0.3)));
  });
  it('0 / klip hening = salinan asli', () => {
    expect(endEcho(clip(), SR, 0)).toEqual(clip());
    const silent = new Float32Array(SR);
    expect(endEcho(silent, SR, 1)).toEqual(silent);
  });
});
