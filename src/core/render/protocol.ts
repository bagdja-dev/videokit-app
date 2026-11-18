// Pesan antara render.ts (main thread) dan compositor.worker.ts.
import type { RenderProgress, RenderSources, RenderSpecV1 } from './types';

export interface WorkerSubtitleLayer {
  start_ms: number;
  end_ms: number;
  bitmap: ImageBitmap;
}

export type ToWorker =
  | {
      type: 'start';
      spec: RenderSpecV1;
      /** Blob atau URL absolut. */
      sources: RenderSources;
      subtitles: WorkerSubtitleLayer[];
      audioCodec: 'aac' | 'opus';
      /** 'opfs' = tulis bertahap ke file; 'memory' = tahan di RAM lalu kirim balik (tanpa OPFS). */
      storage: 'opfs' | 'memory';
      opfsFileName: string;
    }
  | { type: 'audio-chunk'; timestamp: number; data: Float32Array; frames: number }
  | { type: 'audio-end' }
  | { type: 'cancel' };

export type FromWorker =
  | { type: 'progress'; progress: RenderProgress }
  | { type: 'done'; bytes: number; videoMs: number; buffer?: ArrayBuffer }
  | { type: 'error'; message: string };

export const OPFS_DIR = 'videokit-renders';
