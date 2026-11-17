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

  const hasBackground = !!spec.background;
  if (spec.background) {
    const bg = spec.inputs[spec.background.input];
    if (!bg || (bg.kind !== 'video' && bg.kind !== 'image')) issues.push({ path: 'background.input', message: 'Latar harus input video/gambar' });
  }
  const segs = [...spec.video_track].sort((a, b) => a.start_ms - b.start_ms);
  let cursor = 0;
  segs.forEach((s, i) => {
    const p = `video_track[${i}]`;
    if (s.start_ms < cursor) issues.push({ path: p, message: `Tumpang tindih di ${s.start_ms} ms` });
    // Tanpa lapisan latar, segmen wajib menutup seluruh durasi; dengan latar, rentang kosong menampilkan latar.
    else if (s.start_ms > cursor && !hasBackground) issues.push({ path: p, message: `Lubang ${cursor}–${s.start_ms} ms` });
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
  if (cursor > o.duration_ms || (!hasBackground && cursor !== o.duration_ms)) {
    issues.push({ path: 'video_track', message: `Segmen harus menutup 0–${o.duration_ms} ms (berakhir di ${cursor})` });
  }

  spec.audio_tracks.forEach((a, i) => {
    const inp = spec.inputs[a.input];
    if (!inp || (inp.kind !== 'audio' && inp.kind !== 'video')) issues.push({ path: `audio_tracks[${i}].input`, message: `Input audio "${a.input}" tidak ada` });
  });
  (spec.overlays ?? []).forEach((ov, i) => {
    const p = `overlays[${i}]`;
    if (ov.type !== 'avatar') { issues.push({ path: `${p}.type`, message: 'Jenis overlay tidak dikenal' }); return; }
    if (spec.inputs[ov.input]?.kind !== 'avatar') issues.push({ path: `${p}.input`, message: 'Input avatar (.vrm) tidak ada' });
    if (spec.inputs[ov.motion]?.kind !== 'motion') issues.push({ path: `${p}.motion`, message: 'Input motion track tidak ada' });
    if (!(ov.end_ms > ov.start_ms) || ov.start_ms < 0 || ov.end_ms > o.duration_ms) issues.push({ path: p, message: 'Rentang overlay di luar durasi' });
    if (!(ov.placement.width >= 0.1 && ov.placement.width <= 1)) issues.push({ path: `${p}.placement.width`, message: 'Lebar avatar harus 0.1–1' });
    if (ov.camera && !(ov.camera.zoom >= 0.5 && ov.camera.zoom <= 2.5 && Math.abs(ov.camera.offset_x) <= 0.5 && Math.abs(ov.camera.offset_y) <= 0.5)) {
      issues.push({ path: `${p}.camera`, message: 'Bingkai di luar batas (zoom 0.5–2.5, geser ±0.5)' });
    }
    if (ov.background && !HEX.test(ov.background)) issues.push({ path: `${p}.background`, message: 'Warna harus #RRGGBB' });
  });
  if ((spec.overlays?.length ?? 0) > 1) issues.push({ path: 'overlays', message: 'Versi ini hanya mendukung satu avatar per video' });
  if (spec.subtitles && spec.inputs[spec.subtitles.input]?.kind !== 'subtitle') {
    issues.push({ path: 'subtitles.input', message: 'Input subtitle tidak ada' });
  }
  return issues;
}
