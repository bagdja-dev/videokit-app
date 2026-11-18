// Status pemutaran pratinjau langsung (posisi, main/jeda) — dipisah dari store dokumen agar pembaruan posisi
// ±10×/detik tidak memicu render ulang editor & tidak masuk riwayat undo.
import { create } from 'zustand';

interface PlaybackState {
  /** Posisi putar (ms, waktu output). */
  timeMs: number;
  playing: boolean;
  /** Permintaan lompat dari UI (timeline/klik cue); player mengonsumsinya lalu menyetel null. */
  seekRequest: number | null;
  seek(ms: number): void;
  setPlaying(playing: boolean): void;
  toggle(): void;
  /** Dipanggil player saat posisi berjalan. */
  report(ms: number): void;
  consumeSeek(): number | null;
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  timeMs: 0,
  playing: false,
  seekRequest: null,
  seek: (ms) => set({ seekRequest: Math.max(0, ms), timeMs: Math.max(0, ms) }),
  setPlaying: (playing) => set({ playing }),
  toggle: () => set({ playing: !get().playing }),
  report: (ms) => set({ timeMs: ms }),
  consumeSeek: () => {
    const r = get().seekRequest;
    if (r !== null) set({ seekRequest: null });
    return r;
  },
}));

export const formatTime = (ms: number): string => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
