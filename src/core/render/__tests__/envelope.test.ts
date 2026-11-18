import { describe, expect, it } from 'vitest';
import { backgroundEnvelope } from '../envelope';
import type { AudioTrack } from '../types';

const bg: AudioTrack = {
  input: 'bgm', role: 'background', start_ms: 0, loop: true, volume: 0.8,
  fade_in_ms: 500, fade_out_ms: 1500, ducking: { level: 0.25, attack_ms: 200, release_ms: 400 },
};
const voice: AudioTrack = { input: 'vo', role: 'voice', start_ms: 2000, end_ms: 4000 };
const gainAt = (pts: { t_ms: number; gain: number }[], t: number) => pts.find((p) => p.t_ms === t)?.gain;

describe('backgroundEnvelope', () => {
  const pts = backgroundEnvelope(bg, [voice], 30_000, () => 2000);

  it('fade in dari 0 dan fade out ke 0', () => {
    expect(gainAt(pts, 0)).toBe(0);
    expect(gainAt(pts, 500)).toBeCloseTo(0.8);
    expect(gainAt(pts, 30_000)).toBe(0);
  });

  it('turun ke level ducking selama voice, naik lagi setelah release', () => {
    expect(gainAt(pts, 1800)).toBeCloseTo(0.8);
    expect(gainAt(pts, 2000)).toBeCloseTo(0.8 * 0.25);
    expect(gainAt(pts, 4000)).toBeCloseTo(0.8 * 0.25);
    expect(gainAt(pts, 4400)).toBeCloseTo(0.8);
  });

  it('titik terurut dan berada di dalam durasi', () => {
    const ts = pts.map((p) => p.t_ms);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(Math.min(...ts)).toBe(0);
    expect(Math.max(...ts)).toBe(30_000);
  });

  it('memakai durasi sumber bila voice tanpa end_ms', () => {
    const p = backgroundEnvelope(bg, [{ ...voice, end_ms: undefined }], 30_000, () => 1000);
    expect(gainAt(p, 3000)).toBeCloseTo(0.8 * 0.25);
    expect(gainAt(p, 3400)).toBeCloseTo(0.8);
  });
});
