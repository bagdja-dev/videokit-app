// Amplop gain musik latar: fade in/out + ducking selama track voice berbunyi.
// Titik linear yang sama dipakai Web Audio (browser) dan ekspresi volume ffmpeg (server).
import type { AudioTrack } from './types';

export interface GainPoint {
  t_ms: number;
  gain: number;
}

export function backgroundEnvelope(bg: AudioTrack, voices: AudioTrack[], durationMs: number, voiceDurationMs: (v: AudioTrack) => number): GainPoint[] {
  const d = bg.ducking;
  const spans = voices.map((v) => ({ start: v.start_ms, end: v.end_ms ?? v.start_ms + voiceDurationMs(v) }));
  const at = (t: number): number => {
    let g = 1;
    if (bg.fade_in_ms && t < bg.fade_in_ms) g = Math.min(g, t / bg.fade_in_ms);
    const fo = bg.fade_out_ms ?? 0;
    if (fo && t > durationMs - fo) g = Math.min(g, (durationMs - t) / fo);
    if (d) {
      let duck = 0;
      for (const v of spans) {
        const up = (t - (v.start - d.attack_ms)) / d.attack_ms;
        const down = (v.end + d.release_ms - t) / d.release_ms;
        duck = Math.max(duck, Math.max(0, Math.min(1, up, down)));
      }
      g *= 1 - (1 - d.level) * duck;
    }
    return Math.max(0, g) * (bg.volume ?? 1);
  };
  const ts = new Set<number>([0, durationMs]);
  if (bg.fade_in_ms) ts.add(bg.fade_in_ms);
  if (bg.fade_out_ms) ts.add(durationMs - bg.fade_out_ms);
  if (d) for (const v of spans) [v.start - d.attack_ms, v.start, v.end, v.end + d.release_ms].forEach((t) => ts.add(t));
  return [...ts]
    .filter((t) => t >= 0 && t <= durationMs)
    .sort((a, b) => a - b)
    .map((t) => ({ t_ms: t, gain: at(t) }));
}
