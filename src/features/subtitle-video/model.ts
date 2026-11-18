// Dokumen project tool "Video dari Subtitle" (VideoKit overview §3). Disimpan utuh sebagai satu dokumen
// (D3: JSONB di server nanti; IndexedDB di MVP lokal). File media disimpan terpisah, dirujuk lewat mediaId.
import type { SlotStyle, SubtitleDesign } from '@/core/subtitle/ass';
import type { Fit, Underflow } from '@/core/render';

export const DOCUMENT_SCHEMA_VERSION = 1;

export type OutputPreset = '9x16' | '16x9' | '1x1' | '4x5';

export const OUTPUT_PRESETS: Record<OutputPreset, { label: string; width: number; height: number; hint: string }> = {
  '9x16': { label: 'Vertikal 9:16', width: 1080, height: 1920, hint: 'TikTok, Reels, Shorts' },
  '16x9': { label: 'Landscape 16:9', width: 1920, height: 1080, hint: 'YouTube' },
  '1x1': { label: 'Persegi 1:1', width: 1080, height: 1080, hint: 'Feed' },
  '4x5': { label: 'Portrait 4:5', width: 1080, height: 1350, hint: 'Feed IG' },
};

export type MediaKind = 'video' | 'image' | 'audio';

export interface MediaRef {
  id: string;
  name: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
}

export interface CueVisual {
  mediaId: string;
  fit: Fit;
  /** Titik mulai klip (video). */
  sourceInMs: number;
  underflow: Underflow;
  /** Pakai audio asli klip (default mati, §3.4). */
  keepAudio: boolean;
}

export interface CueAudio {
  mediaId: string;
  /** 0–1 */
  volume: number;
}

export interface Cue {
  id: string;
  start_ms: number;
  end_ms: number;
  /** Satu baris per slot bahasa. */
  lines: string[];
  visual?: CueVisual;
  audio?: CueAudio;
}

export interface BackgroundMusic {
  mediaId: string;
  volume: number;
}

export interface BackgroundVideo {
  mediaId: string;
  fit: Fit;
  /** Centang "with audio": audio video latar ikut di-mix (loop, fade, ducking). */
  withAudio: boolean;
  volume: number;
}

export interface SubtitleVideoProject {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  preset: OutputPreset;
  backgroundColor: string;
  cues: Cue[];
  design: SubtitleDesign;
  music?: BackgroundMusic;
  backgroundVideo?: BackgroundVideo;
  /** Ducking latar saat audio cue / audio asli klip berbunyi. */
  duckingLevel: number;
  media: Record<string, MediaRef>;
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const defaultSlot = (index: number): SlotStyle => (index === 0
  ? { label: 'Bahasa 1', font: 'Poppins', bold: true, italic: false, size: 72, color: '#FFFFFF', outlineColor: '#000000', outline: 4, shadow: 2, box: false, boxColor: '#000000', boxOpacity: 60 }
  : { label: `Bahasa ${index + 1}`, font: 'Poppins', bold: false, italic: true, size: 48, color: '#FFE066', outlineColor: '#000000', outline: 3, shadow: 1, box: false, boxColor: '#000000', boxOpacity: 60 });

export function createProject(title: string, preset: OutputPreset): SubtitleVideoProject {
  const now = Date.now();
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    preset,
    backgroundColor: '#000000',
    cues: [],
    design: { anchor: 'bottom', marginV: preset === '16x9' ? 80 : 260, marginH: 80, slots: [defaultSlot(0), defaultSlot(1)] },
    duckingLevel: 0.25,
    media: {},
  };
}

/** Jumlah slot yang dibutuhkan = baris terbanyak di antara cue (minimal 1). */
export const slotsNeeded = (cues: Cue[]): number => Math.max(1, ...cues.map((c) => c.lines.length));

/** Batas D4 (direvisi 17 Nov 2026). */
export const LIMITS = { maxCues: 1500, maxMediaBytes: 2 * 1024 ** 3 } as const;
