// Dokumen project → Render Spec v1 (+ ASS). Fungsi murni; sumber file (Blob) disuplai pemanggil.
// Aturan visual (§3.5): visual cue tampil dari awal cue sampai cue berikutnya mulai (jeda ditahan);
// sebelum cue pertama memakai visual cue pertama. Cue tanpa visual → video latar, atau warna latar.
import { buildAss } from '@/core/subtitle/ass';
import type { AudioTrack, RenderSpecV1, VideoSegment } from '@/core/render';
import { OUTPUT_PRESETS, type SubtitleVideoProject } from './model';

export const TAIL_MS = 500;
const SUBS_KEY = '__subs';
const DUCKING = { attack_ms: 200, release_ms: 400 };

export interface RenderJob {
  spec: RenderSpecV1;
  ass: string;
  /** Kunci input yang harus disuplai sebagai Blob (mediaId), selain subtitle. */
  mediaIds: string[];
  subtitleKey: string;
}

export interface BuildOptions {
  /** Render sebagian (pratinjau): rentang waktu project [from, to). */
  range?: { from_ms: number; to_ms: number };
  /** Skala resolusi (pratinjau cepat), mis. 0.5. */
  scale?: number;
}

export class SpecBuildError extends Error {}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function projectDuration(p: SubtitleVideoProject): number {
  const last = p.cues.reduce((m, c) => Math.max(m, c.end_ms), 0);
  return last > 0 ? last + TAIL_MS : 0;
}

export function buildRenderJob(p: SubtitleVideoProject, opts: BuildOptions = {}): RenderJob {
  if (!p.cues.length) throw new SpecBuildError('Belum ada cue — unggah SRT terlebih dahulu');
  const preset = OUTPUT_PRESETS[p.preset];
  const scale = opts.scale ?? 1;
  const width = even(preset.width * scale), height = even(preset.height * scale);
  const full = projectDuration(p);
  const from = Math.max(0, opts.range?.from_ms ?? 0);
  const to = Math.min(full, opts.range?.to_ms ?? full);
  if (to - from < 100) throw new SpecBuildError('Rentang render terlalu pendek');
  const shift = (t: number) => Math.min(to, Math.max(from, t)) - from;

  const cues = [...p.cues].sort((a, b) => a.start_ms - b.start_ms);
  const inputs: RenderSpecV1['inputs'] = {};
  const requireMedia = (id: string) => {
    const m = p.media[id];
    if (!m) throw new SpecBuildError('Media yang dirujuk tidak ditemukan — unggah ulang');
    inputs[id] = { kind: m.kind };
  };

  // --- Visual: rentang tiap cue = [mulai cue, mulai cue berikutnya); cue pertama mulai dari 0.
  const segments: VideoSegment[] = [];
  cues.forEach((c, i) => {
    const a = i === 0 ? 0 : c.start_ms;
    const b = i + 1 < cues.length ? cues[i + 1]!.start_ms : full;
    if (b <= from || a >= to || b <= a) return;
    const sa = shift(a), sb = shift(b);
    if (sb <= sa) return;
    if (c.visual) {
      requireMedia(c.visual.mediaId);
      // titik mulai klip ikut bergeser bila pratinjau dimulai di tengah segmen
      const skipped = Math.max(0, from - a);
      segments.push({
        input: c.visual.mediaId, start_ms: sa, end_ms: sb, fit: c.visual.fit,
        source_in_ms: c.visual.sourceInMs + skipped, underflow: c.visual.underflow, keep_audio: c.visual.keepAudio,
      });
    } else if (!p.backgroundVideo) {
      segments.push({ color: p.backgroundColor, start_ms: sa, end_ms: sb });
    }
  });

  // --- Audio
  const duration = to - from;
  const audio: AudioTrack[] = [];
  for (const c of cues) {
    if (!c.audio || c.end_ms <= from || c.start_ms >= to) continue;
    requireMedia(c.audio.mediaId);
    // TODO pratinjau di tengah cue: audio cue dimulai dari awal, bukan dari titik tengah (diterima untuk MVP)
    audio.push({ input: c.audio.mediaId, role: 'voice', start_ms: shift(c.start_ms), end_ms: shift(c.end_ms), volume: c.audio.volume });
  }
  const bgCommon = { start_ms: 0, loop: true, fade_in_ms: from === 0 ? 500 : 0, fade_out_ms: to === full ? 1500 : 0, ducking: { level: p.duckingLevel, ...DUCKING } };
  if (p.music) {
    requireMedia(p.music.mediaId);
    audio.push({ input: p.music.mediaId, role: 'background', volume: p.music.volume, ...bgCommon });
  }
  let background: RenderSpecV1['background'];
  if (p.backgroundVideo) {
    requireMedia(p.backgroundVideo.mediaId);
    background = { input: p.backgroundVideo.mediaId, fit: p.backgroundVideo.fit };
    if (p.backgroundVideo.withAudio && p.media[p.backgroundVideo.mediaId]?.kind === 'video') {
      audio.push({ input: p.backgroundVideo.mediaId, role: 'background', volume: p.backgroundVideo.volume, ...bgCommon });
    }
  }

  // --- Subtitle (waktu relatif rentang)
  const assCues = cues
    .filter((c) => c.end_ms > from && c.start_ms < to)
    .map((c) => ({ start_ms: shift(c.start_ms), end_ms: shift(c.end_ms), lines: c.lines }));
  const designScaled = scale === 1 ? p.design : {
    ...p.design,
    marginV: Math.round(p.design.marginV * scale), marginH: Math.round(p.design.marginH * scale),
    slots: p.design.slots.map((s) => ({ ...s, size: Math.round(s.size * scale), outline: s.outline * scale, shadow: s.shadow * scale })),
  };
  // PlayRes = resolusi output; skala desain mengikuti agar pratinjau kecil proporsional.
  const ass = buildAss(assCues, designScaled, { width, height });
  inputs[SUBS_KEY] = { kind: 'subtitle' };

  const spec: RenderSpecV1 = {
    spec_version: 1,
    output: { width, height, fps: 30, duration_ms: duration, background_color: p.backgroundColor },
    inputs,
    ...(background ? { background } : {}),
    video_track: segments,
    audio_tracks: audio,
    subtitles: { input: SUBS_KEY, font_set: 'latin-v1' },
  };
  return { spec, ass, mediaIds: Object.keys(inputs).filter((k) => k !== SUBS_KEY), subtitleKey: SUBS_KEY };
}
