// Fungsi murni penentuan waktu — wajib identik dengan executor server agar frame sama.
import type { MediaSegment, RenderSpecV1, VideoSegment } from './types';
import { isColorSegment } from './types';

export const totalFrames = (spec: RenderSpecV1): number =>
  Math.round((spec.output.duration_ms * spec.output.fps) / 1000);

/** Rentang indeks frame [first, last) milik sebuah segmen. */
export function segmentFrameRange(seg: VideoSegment, fps: number): { first: number; last: number } {
  return { first: Math.round((seg.start_ms * fps) / 1000), last: Math.round((seg.end_ms * fps) / 1000) };
}

/**
 * Waktu sumber (detik) untuk frame output pada tOutMs.
 * Klip lebih pendek dari segmen: freeze di frame terakhir (default) atau loop.
 */
export function sourceTimeFor(seg: MediaSegment, tOutMs: number, clipDurationS: number, fps: number): number {
  const rel = (tOutMs - seg.start_ms + (seg.source_in_ms ?? 0)) / 1000;
  const last = Math.max(0, clipDurationS - 1 / fps);
  if (rel <= last) return rel;
  if (seg.underflow === 'loop' && clipDurationS > 0) return rel % clipDurationS;
  return last;
}

export interface SpecIssue {
  path: string;
  message: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Validasi struktural spec sebelum render (overview §3.2): tanpa lubang, tanpa tumpang tindih. */
export function validateSpec(spec: RenderSpecV1): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const o = spec.output;
  if (spec.spec_version !== 1) issues.push({ path: 'spec_version', message: 'Hanya spec_version 1 yang didukung' });
  if (!(o.width > 0 && o.height > 0) || o.width % 2 || o.height % 2) {
    issues.push({ path: 'output', message: 'Lebar/tinggi harus positif dan genap (H.264 4:2:0)' });
  }
  if (!(o.fps > 0 && o.fps <= 60)) issues.push({ path: 'output.fps', message: 'fps harus 1–60' });
  if (!(o.duration_ms > 0)) issues.push({ path: 'output.duration_ms', message: 'Durasi harus > 0' });
  if (!HEX.test(o.background_color)) issues.push({ path: 'output.background_color', message: 'Warna harus #RRGGBB' });

  const segs = [...spec.video_track].sort((a, b) => a.start_ms - b.start_ms);
  let cursor = 0;
  segs.forEach((s, i) => {
    const p = `video_track[${i}]`;
    if (s.start_ms !== cursor) {
      issues.push({ path: p, message: s.start_ms > cursor ? `Lubang ${cursor}–${s.start_ms} ms` : `Tumpang tindih di ${s.start_ms} ms` });
    }
    if (!(s.end_ms > s.start_ms)) issues.push({ path: p, message: 'end_ms harus > start_ms' });
    if (isColorSegment(s)) {
      if (!HEX.test(s.color)) issues.push({ path: `${p}.color`, message: 'Warna harus #RRGGBB' });
    } else {
      const inp = spec.inputs[s.input];
      if (!inp) issues.push({ path: `${p}.input`, message: `Input "${s.input}" tidak ada` });
      else if (inp.kind !== 'video' && inp.kind !== 'image') issues.push({ path: `${p}.input`, message: 'Segmen visual harus video/gambar' });
      if (!['cover', 'contain', 'blur'].includes(s.fit)) issues.push({ path: `${p}.fit`, message: 'fit tidak dikenal' });
    }
    cursor = Math.max(cursor, s.end_ms);
  });
  if (cursor !== o.duration_ms) issues.push({ path: 'video_track', message: `Segmen harus menutup 0–${o.duration_ms} ms (berakhir di ${cursor})` });

  spec.audio_tracks.forEach((a, i) => {
    const inp = spec.inputs[a.input];
    if (!inp || inp.kind !== 'audio') issues.push({ path: `audio_tracks[${i}].input`, message: `Input audio "${a.input}" tidak ada` });
  });
  if (spec.audio_tracks.filter((a) => a.role === 'background').length > 1) {
    issues.push({ path: 'audio_tracks', message: 'Maksimal satu track latar' });
  }
  if (spec.subtitles && spec.inputs[spec.subtitles.input]?.kind !== 'subtitle') {
    issues.push({ path: 'subtitles.input', message: 'Input subtitle tidak ada' });
  }
  return issues;
}
