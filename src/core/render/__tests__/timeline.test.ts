import { describe, expect, it } from 'vitest';
import { segmentFrameRange, sourceTimeFor, totalFrames, validateSpec } from '../timeline';
import type { MediaSegment, RenderSpecV1 } from '../types';

const base = (): RenderSpecV1 => ({
  spec_version: 1,
  output: { width: 1080, height: 1920, fps: 30, duration_ms: 10_000, background_color: '#000000' },
  inputs: { a: { kind: 'video' }, img: { kind: 'image' }, bgm: { kind: 'audio' }, subs: { kind: 'subtitle' } },
  video_track: [
    { input: 'a', start_ms: 0, end_ms: 4000, fit: 'blur' },
    { input: 'img', start_ms: 4000, end_ms: 9500, fit: 'contain' },
    { color: '#101820', start_ms: 9500, end_ms: 10_000 },
  ],
  audio_tracks: [{ input: 'bgm', role: 'background', start_ms: 0, loop: true }],
  subtitles: { input: 'subs', font_set: 'latin-v1' },
});

describe('validateSpec', () => {
  it('menerima spec yang menutup seluruh durasi', () => {
    expect(validateSpec(base())).toEqual([]);
  });

  it('menolak lubang dan tumpang tindih', () => {
    const gap = base();
    gap.video_track[1] = { input: 'img', start_ms: 4500, end_ms: 9500, fit: 'contain' };
    expect(validateSpec(gap).map((i) => i.message)).toContain('Lubang 4000–4500 ms');

    const overlap = base();
    overlap.video_track[1] = { input: 'img', start_ms: 3500, end_ms: 9500, fit: 'contain' };
    expect(validateSpec(overlap).some((i) => i.message.startsWith('Tumpang tindih'))).toBe(true);
  });

  it('menolak segmen yang tidak sampai akhir durasi', () => {
    const s = base();
    s.video_track.pop();
    expect(validateSpec(s).some((i) => i.path === 'video_track')).toBe(true);
  });

  it('menolak resolusi ganjil, input hilang, dan dua track latar', () => {
    const s = base();
    s.output.width = 1081;
    s.video_track[0] = { input: 'missing', start_ms: 0, end_ms: 4000, fit: 'cover' };
    s.audio_tracks.push({ input: 'bgm', role: 'background', start_ms: 0 });
    const paths = validateSpec(s).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['output', 'video_track[0].input', 'audio_tracks']));
  });
});

describe('sourceTimeFor', () => {
  const seg: MediaSegment = { input: 'a', start_ms: 6000, end_ms: 12_000, fit: 'cover', source_in_ms: 500 };

  it('memetakan waktu output ke waktu sumber dengan source_in', () => {
    expect(sourceTimeFor(seg, 6000, 8, 30)).toBeCloseTo(0.5);
    expect(sourceTimeFor(seg, 7000, 8, 30)).toBeCloseTo(1.5);
  });

  it('freeze di frame terakhir bila klip habis', () => {
    expect(sourceTimeFor(seg, 11_900, 2, 30)).toBeCloseTo(2 - 1 / 30);
  });

  it('loop bila underflow=loop', () => {
    expect(sourceTimeFor({ ...seg, underflow: 'loop', source_in_ms: 0 }, 6000 + 2500, 2, 30)).toBeCloseTo(0.5);
  });
});

describe('frame', () => {
  it('menghitung total frame dan rentang segmen', () => {
    expect(totalFrames(base())).toBe(300);
    expect(segmentFrameRange({ color: '#000000', start_ms: 9500, end_ms: 10_000 }, 30)).toEqual({ first: 285, last: 300 });
  });
});
