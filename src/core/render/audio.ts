// Mix audio di MAIN THREAD (OfflineAudioContext tidak tersedia di worker), dirender per potongan
// agar video panjang tidak menahan seluruh PCM di RAM (10 menit stereo float ≈ 230 MB).
import { backgroundEnvelope } from './envelope';
import type { AudioTrack, RenderSources, RenderSpecV1 } from './types';
import { isColorSegment } from './types';

export const AUDIO_SAMPLE_RATE = 48_000;
const CHUNK_SECONDS = 20;

export interface AudioChunk {
  /** Detik awal potongan di timeline output. */
  timestamp: number;
  /** Planar: kanal kiri lalu kanan. */
  data: Float32Array;
  frames: number;
}

interface Scheduled {
  buffer: AudioBuffer;
  /** Posisi mulai di timeline output (detik). */
  at: number;
  /** Titik mulai di buffer sumber (detik). */
  offset: number;
  /** Lama pemutaran (detik). */
  length: number;
  loop: boolean;
  volume: number;
  envelope?: { t_ms: number; gain: number }[];
}

async function loadBuffer(src: Blob | string, ctx: BaseAudioContext): Promise<AudioBuffer> {
  const bytes = typeof src === 'string' ? await (await fetch(src)).arrayBuffer() : await src.arrayBuffer();
  return ctx.decodeAudioData(bytes);
}

/** Susun jadwal semua sumber audio (latar, voice, audio asli klip). */
async function schedule(spec: RenderSpecV1, sources: RenderSources): Promise<Scheduled[]> {
  const decodeCtx = new OfflineAudioContext(2, 1, AUDIO_SAMPLE_RATE);
  const durationS = spec.output.duration_ms / 1000;
  const cache = new Map<string, Promise<AudioBuffer>>();
  const get = (key: string) => {
    const src = sources[key];
    if (!src) throw new Error(`Sumber audio "${key}" tidak diberikan`);
    if (!cache.has(key)) cache.set(key, loadBuffer(src, decodeCtx));
    return cache.get(key)!;
  };

  const out: Scheduled[] = [];
  const voices: AudioTrack[] = spec.audio_tracks.filter((a) => a.role === 'voice');
  const voiceDur = new Map<AudioTrack, number>();
  for (const v of voices) {
    const buf = await get(v.input);
    const end = Math.min(v.end_ms ?? v.start_ms + buf.duration * 1000, spec.output.duration_ms);
    voiceDur.set(v, end - v.start_ms);
    out.push({ buffer: buf, at: v.start_ms / 1000, offset: 0, length: (end - v.start_ms) / 1000, loop: false, volume: v.volume ?? 1 });
  }
  // Audio asli klip (keep_audio) ikut men-duck musik latar seperti voice.
  const duckers: AudioTrack[] = [...voices];
  for (const seg of spec.video_track) {
    if (isColorSegment(seg) || !seg.keep_audio) continue;
    const buf = await get(seg.input).catch(() => null); // klip tanpa audio → lewati
    if (!buf) continue;
    const length = (seg.end_ms - seg.start_ms) / 1000;
    out.push({ buffer: buf, at: seg.start_ms / 1000, offset: (seg.source_in_ms ?? 0) / 1000, length, loop: false, volume: 1 });
    const pseudo: AudioTrack = { input: seg.input, role: 'voice', start_ms: seg.start_ms, end_ms: seg.end_ms };
    duckers.push(pseudo);
    voiceDur.set(pseudo, seg.end_ms - seg.start_ms);
  }
  const bg = spec.audio_tracks.find((a) => a.role === 'background');
  if (bg) {
    const buf = await get(bg.input);
    const end = bg.end_ms ?? (bg.loop ? spec.output.duration_ms : Math.min(bg.start_ms + buf.duration * 1000, spec.output.duration_ms));
    out.push({
      buffer: buf, at: bg.start_ms / 1000, offset: 0, length: Math.min(end / 1000, durationS) - bg.start_ms / 1000,
      loop: !!bg.loop, volume: 1,
      envelope: backgroundEnvelope(bg, duckers, spec.output.duration_ms, (v) => voiceDur.get(v) ?? 0),
    });
  }
  return out;
}

/** Render audio per potongan CHUNK_SECONDS; memanggil onChunk berurutan dari awal sampai akhir. */
export async function renderAudioChunks(
  spec: RenderSpecV1,
  sources: RenderSources,
  onChunk: (chunk: AudioChunk) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<void> {
  const plan = await schedule(spec, sources);
  const durationS = spec.output.duration_ms / 1000;
  for (let c0 = 0; c0 < durationS - 1e-9; c0 += CHUNK_SECONDS) {
    signal?.throwIfAborted();
    const c1 = Math.min(durationS, c0 + CHUNK_SECONDS);
    const frames = Math.round((c1 - c0) * AUDIO_SAMPLE_RATE);
    const ctx = new OfflineAudioContext(2, frames, AUDIO_SAMPLE_RATE);
    for (const s of plan) {
      const sEnd = s.at + s.length;
      if (sEnd <= c0 || s.at >= c1) continue;
      const node = ctx.createBufferSource();
      node.buffer = s.buffer;
      node.loop = s.loop;
      const gain = ctx.createGain();
      gain.gain.value = s.volume;
      if (s.envelope) {
        // Amplop dalam waktu lokal potongan; nilai di awal potongan diinterpolasi dari titik global.
        const local = (tMs: number) => tMs / 1000 - c0;
        const env = s.envelope;
        const gainAt = (tMs: number) => {
          for (let i = 0; i < env.length - 1; i++) {
            const a = env[i]!, b = env[i + 1]!;
            if (tMs >= a.t_ms && tMs <= b.t_ms) return b.t_ms === a.t_ms ? b.gain : a.gain + ((b.gain - a.gain) * (tMs - a.t_ms)) / (b.t_ms - a.t_ms);
          }
          return env[env.length - 1]!.gain;
        };
        gain.gain.setValueAtTime(gainAt(c0 * 1000), 0);
        for (const p of env) if (p.t_ms > c0 * 1000 && p.t_ms <= c1 * 1000) gain.gain.linearRampToValueAtTime(p.gain, local(p.t_ms));
        gain.gain.linearRampToValueAtTime(gainAt(c1 * 1000), c1 - c0);
      }
      node.connect(gain).connect(ctx.destination);
      const startLocal = Math.max(0, s.at - c0);
      const skipped = Math.max(0, c0 - s.at);
      const dur = Math.min(sEnd, c1) - Math.max(s.at, c0);
      let offset = s.offset + skipped;
      if (s.loop && s.buffer.duration > 0) offset %= s.buffer.duration;
      node.start(startLocal, offset, s.loop ? undefined : dur);
      if (s.loop) node.stop(startLocal + dur);
    }
    const rendered = await ctx.startRendering();
    const data = new Float32Array(frames * 2);
    data.set(rendered.getChannelData(0), 0);
    data.set(rendered.getChannelData(1), frames);
    await onChunk({ timestamp: c0, data, frames });
  }
}
