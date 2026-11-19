import { describe, expect, it } from 'vitest';
import { buildAss } from '@/core/subtitle/ass';
import { encodeWav, mixToMono } from '@/core/audio/wav';
import { clampCueTiming, createProject, fitCueToDuration, insertCueAt, insertCueRipple, MIN_CUE_MS, NEW_CUE_MS, shiftAllCues, shiftCuesFrom, type Cue } from '../model';

const cue = (id: string, start: number, end: number, extra: Partial<Cue> = {}): Cue => ({ id, start_ms: start, end_ms: end, lines: [id], ...extra });
const cues = [cue('a', 0, 2000), cue('b', 3000, 5000), cue('c', 5000, 8000)];

describe('clampCueTiming', () => {
  it('tidak boleh menembus cue tetangga', () => {
    expect(clampCueTiming(cues, 'b', 1500, 6000)).toEqual({ start_ms: 2000, end_ms: 5000 });
  });
  it('durasi minimal dijaga, sisi yang digeser yang mengalah', () => {
    // menggeser tepi kanan b hampir ke kiri → end = start + MIN
    expect(clampCueTiming(cues, 'b', 3000, 3050)).toEqual({ start_ms: 3000, end_ms: 3000 + MIN_CUE_MS });
    // menggeser tepi kiri c melewati kanan → start = end - MIN
    expect(clampCueTiming(cues, 'c', 7990, 8000)).toEqual({ start_ms: 8000 - MIN_CUE_MS, end_ms: 8000 });
  });
  it('cue pertama tidak boleh sebelum 0', () => {
    expect(clampCueTiming(cues, 'a', -500, 2000)).toEqual({ start_ms: 0, end_ms: 2000 });
  });
});

describe('insertCueAt', () => {
  it('di dalam cue → membelah; visual berlanjut dari titik belah', () => {
    const withVisual = [cue('a', 0, 4000, { visual: { mediaId: 'v', fit: 'cover', sourceInMs: 500, underflow: 'freeze', keepAudio: false } })];
    const r = insertCueAt(withVisual, 1500, 2)!;
    const a = r.cues.find((c) => c.id === 'a')!, n = r.cues.find((c) => c.id === r.id)!;
    expect(a.end_ms).toBe(1500);
    expect(n).toMatchObject({ start_ms: 1500, end_ms: 4000, lines: ['', ''] });
    expect(n.visual?.sourceInMs).toBe(2000);
  });
  it('di celah → mengisi sampai cue berikutnya (maks NEW_CUE_MS)', () => {
    const r = insertCueAt(cues, 2200, 1)!;
    expect(r.cues.find((c) => c.id === r.id)).toMatchObject({ start_ms: 2200, end_ms: 3000 });
  });
  it('sesudah cue terakhir → durasi NEW_CUE_MS', () => {
    const r = insertCueAt(cues, 9000, 1)!;
    expect(r.cues.find((c) => c.id === r.id)).toMatchObject({ start_ms: 9000, end_ms: 9000 + NEW_CUE_MS });
  });
  it('ruang terlalu sempit → null', () => {
    expect(insertCueAt(cues, 2950, 1)).toBeNull(); // celah 50 ms
    expect(insertCueAt(cues, 3100, 1)).toBeNull(); // terlalu dekat awal cue b
  });
});

describe('buildAss — override gaya per cue', () => {
  const p = createProject('t', '9x16');
  const out = { width: 1080, height: 1920 };
  it('tanpa override → hanya Slot1/Slot2', () => {
    const ass = buildAss([{ start_ms: 0, end_ms: 1000, lines: ['Halo', 'Hello'] }], p.design, out);
    expect(ass).not.toMatch(/Slot\do\d/);
  });
  it('override baris 1 → style turunan, dipakai sebagai style event; override sama dipakai ulang', () => {
    const ass = buildAss([
      { start_ms: 0, end_ms: 1000, lines: ['Merah', 'Red'], lineStyles: [{ color: '#FF0000', size: 90 }] },
      { start_ms: 1000, end_ms: 2000, lines: ['Merah lagi', 'Red again'], lineStyles: [{ size: 90, color: '#FF0000' }] },
      { start_ms: 2000, end_ms: 3000, lines: ['Biasa', 'Kotak'], lineStyles: [null, { box: true, boxColor: '#000000' }] },
    ], p.design, out);
    const styleLines = ass.split('\n').filter((l) => l.startsWith('Style:'));
    expect(styleLines.map((l) => l.split(',')[0])).toEqual(['Style: Slot1', 'Style: Slot2', 'Style: Slot1o1', 'Style: Slot2o2']);
    expect(styleLines[2]).toContain(',90,&H000000FF,'); // ukuran 90, warna merah (&HAABBGGRR)
    expect(styleLines[3]!.split(',')[15]).toBe('3'); // BorderStyle kotak pada override baris 2
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(events[0]).toContain(',Slot1o1,,');
    expect(events[1]).toContain(',Slot1o1,,');
    expect(events[2]).toContain(',Slot1,,');
    expect(events[2]).toContain('{\\rSlot2o2}Kotak');
  });
});

describe('shiftAllCues', () => {
  it('geser maju semua cue', () => {
    const r = shiftAllCues(cues, 1500);
    expect(r.applied).toBe(1500);
    expect(r.cues.map((c) => [c.start_ms, c.end_ms])).toEqual([[1500, 3500], [4500, 6500], [6500, 9500]]);
  });
  it('geser mundur dibatasi agar cue pertama tidak sebelum 0', () => {
    const late = cues.map((c) => ({ ...c, start_ms: c.start_ms + 700, end_ms: c.end_ms + 700 }));
    const r = shiftAllCues(late, -5000);
    expect(r.applied).toBe(-700);
    expect(r.cues[0]!.start_ms).toBe(0);
  });
  it('tanpa cue / delta 0 → tidak berubah', () => {
    expect(shiftAllCues([], 1000).applied).toBe(0);
    expect(shiftAllCues(cues, 0).cues).toBe(cues);
  });
});

describe('ripple: insertCueRipple & shiftCuesFrom', () => {
  const tight = [cue('a', 0, 2000), cue('b', 2000, 4000), cue('c', 4000, 6000)];
  it('sisip & geser di dalam cue → setelah cue itu, sisanya mundur', () => {
    const r = insertCueRipple(tight, 1000, 2);
    const by = (id: string) => r.cues.find((c) => c.id === id)!;
    expect(by(r.id)).toMatchObject({ start_ms: 2000, end_ms: 4000, lines: ['', ''] });
    expect([by('a').start_ms, by('b').start_ms, by('c').start_ms]).toEqual([0, 4000, 6000]);
  });
  it('sisip & geser di celah / akhir', () => {
    const r = insertCueRipple(cues, 2500, 1, 1000);
    expect(r.cues.find((c) => c.id === r.id)).toMatchObject({ start_ms: 2500, end_ms: 3500 });
    expect(r.cues.find((c) => c.id === 'b')!.start_ms).toBe(4000);
    expect(r.cues.find((c) => c.id === 'a')!.start_ms).toBe(0);
  });
  it('geser dari cue b ke belakang; cue a tidak ikut', () => {
    const r = shiftCuesFrom(cues, 'b', 1500);
    expect(r.cues.map((c) => [c.id, c.start_ms])).toEqual([['a', 0], ['b', 4500], ['c', 6500]]);
  });
  it('geser mundur dibatasi akhir cue sebelumnya', () => {
    const r = shiftCuesFrom(cues, 'b', -5000);
    expect(r.applied).toBe(-1000);
    expect(r.cues.find((c) => c.id === 'b')!.start_ms).toBe(2000);
  });
});

describe('fitCueToDuration', () => {
  const mk = (id: string, s: number, e: number): Cue => ({ id, start_ms: s, end_ms: e, lines: [''] });
  it('memanjangkan cue di celah tanpa menggeser yang lain', () => {
    const r = fitCueToDuration([mk('a', 0, 1000), mk('b', 5000, 6000)], 'a', 3000);
    expect(r.changed).toBe(true);
    expect(r.cues.find((c) => c.id === 'a')).toMatchObject({ start_ms: 0, end_ms: 3000 });
    expect(r.cues.find((c) => c.id === 'b')).toMatchObject({ start_ms: 5000, end_ms: 6000 });
  });
  it('menggeser cue sesudahnya sebesar kekurangannya', () => {
    const r = fitCueToDuration([mk('a', 0, 1000), mk('b', 1500, 2500), mk('c', 3000, 4000)], 'a', 2000);
    expect(r.cues.map((c) => [c.start_ms, c.end_ms])).toEqual([[0, 2000], [2000, 3000], [3500, 4500]]);
  });
  it('tidak memendekkan cue', () => {
    const cues = [mk('a', 0, 4000)];
    expect(fitCueToDuration(cues, 'a', 1000)).toEqual({ cues, changed: false });
  });
});

describe('encodeWav', () => {
  it('header RIFF PCM16 mono & sampel terklip', () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 2]), 48000);
    const v = new DataView(buf);
    const str = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(buf.byteLength).toBe(44 + 8);
    expect([str(0), str(8), str(12), str(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(16);
    expect([1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([32767, -32768, 32767]);
  });
  it('mixToMono merata-rata kanal', () => {
    expect(Array.from(mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
  });
});
