import { describe, expect, it } from 'vitest';
import { validateSpec } from '@/core/render';
import { createProject, type SubtitleVideoProject } from '../model';
import { buildRenderJob, TAIL_MS } from '../spec-builder';

function project(): SubtitleVideoProject {
  const p = createProject('Uji', '9x16');
  p.media = {
    v1: { id: 'v1', name: 'a.mp4', kind: 'video', mimeType: 'video/mp4', sizeBytes: 1 },
    img: { id: 'img', name: 'b.png', kind: 'image', mimeType: 'image/png', sizeBytes: 1 },
    bgm: { id: 'bgm', name: 'm.mp3', kind: 'audio', mimeType: 'audio/mpeg', sizeBytes: 1 },
    vo: { id: 'vo', name: 'n.mp3', kind: 'audio', mimeType: 'audio/mpeg', sizeBytes: 1 },
    bgv: { id: 'bgv', name: 'bg.mp4', kind: 'video', mimeType: 'video/mp4', sizeBytes: 1 },
  };
  p.cues = [
    { id: 'c1', start_ms: 500, end_ms: 3000, lines: ['Satu', 'One'], visual: { mediaId: 'v1', fit: 'blur', sourceInMs: 0, underflow: 'freeze', keepAudio: false } },
    { id: 'c2', start_ms: 3500, end_ms: 6000, lines: ['Dua'], audio: { mediaId: 'vo', volume: 1 } },
    { id: 'c3', start_ms: 6000, end_ms: 9000, lines: ['Tiga'], visual: { mediaId: 'img', fit: 'contain', sourceInMs: 0, underflow: 'freeze', keepAudio: false } },
  ];
  return p;
}

describe('buildRenderJob', () => {
  it('visual menahan sampai cue berikutnya; cue tanpa visual tanpa latar → warna; spec valid', () => {
    const job = buildRenderJob(project());
    expect(job.spec.output).toMatchObject({ width: 1080, height: 1920, duration_ms: 9000 + TAIL_MS });
    expect(job.spec.video_track).toEqual([
      expect.objectContaining({ input: 'v1', start_ms: 0, end_ms: 3500 }),
      expect.objectContaining({ color: '#000000', start_ms: 3500, end_ms: 6000 }),
      expect.objectContaining({ input: 'img', start_ms: 6000, end_ms: 9500 }),
    ]);
    expect(job.spec.audio_tracks).toEqual([expect.objectContaining({ input: 'vo', role: 'voice', start_ms: 3500, end_ms: 6000 })]);
    expect(validateSpec(job.spec)).toEqual([]);
    expect(job.ass).toContain('Satu\\N{\\rSlot2}One');
  });

  it('video latar dengan audio: rentang kosong jadi latar, audionya track latar kedua', () => {
    const p = project();
    p.music = { mediaId: 'bgm', volume: 0.8 };
    p.backgroundVideo = { mediaId: 'bgv', fit: 'cover', withAudio: true, volume: 0.4 };
    const job = buildRenderJob(p);
    expect(job.spec.background).toEqual({ input: 'bgv', fit: 'cover' });
    expect(job.spec.video_track.some((s) => 'color' in s)).toBe(false);
    expect(job.spec.audio_tracks.filter((a) => a.role === 'background').map((a) => [a.input, a.volume])).toEqual([['bgm', 0.8], ['bgv', 0.4]]);
    expect(validateSpec(job.spec)).toEqual([]);
    p.backgroundVideo.withAudio = false;
    expect(buildRenderJob(p).spec.audio_tracks.some((a) => a.input === 'bgv')).toBe(false);
  });

  it('pratinjau rentang: waktu digeser, titik mulai klip ikut maju, resolusi diskalakan', () => {
    const job = buildRenderJob(project(), { range: { from_ms: 1000, to_ms: 4000 }, scale: 0.5 });
    expect(job.spec.output).toMatchObject({ width: 540, height: 960, duration_ms: 3000 });
    expect(job.spec.video_track[0]).toMatchObject({ input: 'v1', start_ms: 0, end_ms: 2500, source_in_ms: 1000 });
    expect(validateSpec(job.spec)).toEqual([]);
  });

  it('menolak project tanpa cue', () => {
    expect(() => buildRenderJob(createProject('x', '16x9'))).toThrow(/SRT/);
  });
});
