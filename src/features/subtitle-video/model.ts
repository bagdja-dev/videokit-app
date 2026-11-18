// Dokumen project tool "Video dari Subtitle" (VideoKit overview §3). Disimpan utuh sebagai satu dokumen
// (D3: JSONB di server nanti; IndexedDB di MVP lokal). File media disimpan terpisah, dirujuk lewat mediaId.
import type { LineStyleOverride, SlotStyle, SubtitleDesign } from '@/core/subtitle/ass';
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
  /** Override gaya per baris khusus cue ini (indeks = baris); null/kosong = ikut gaya global (tab Display). */
  lineStyles?: Array<LineStyleOverride | null>;
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

/**
 * Gaya default per baris (tab Display). Default 2 (Baris 1 & 2); baris cue yang melebihi jumlah gaya memakai gaya
 * baris TERAKHIR. Gaya baris berikutnya ditambahkan pengguna secara eksplisit, tidak lagi otomatis.
 */
export const MIN_STYLE_SLOTS = 2;

/** Batas D4 (direvisi 17 Nov 2026). */
export const LIMITS = { maxCues: 1500, maxMediaBytes: 2 * 1024 ** 3 } as const;

// ── Operasi timeline (murni; dipakai store & diuji unit) ──────────────────────────────────────────────

/** Durasi minimal cue (ms) & durasi cue baru hasil sisip. */
export const MIN_CUE_MS = 200;
export const NEW_CUE_MS = 2000;

export const sortCues = (cues: Cue[]): Cue[] => [...cues].sort((a, b) => a.start_ms - b.start_ms);

/**
 * Batasi waktu cue agar tidak tumpang tindih tetangga & tidak lebih pendek dari MIN_CUE_MS.
 * Dipakai saat menggeser tepi blok di timeline maupun mengetik waktu.
 */
export function clampCueTiming(cues: Cue[], cueId: string, start: number, end: number): { start_ms: number; end_ms: number } {
  const sorted = sortCues(cues);
  const i = sorted.findIndex((c) => c.id === cueId);
  const prevEnd = i > 0 ? sorted[i - 1]!.end_ms : 0;
  const nextStart = i >= 0 && i + 1 < sorted.length ? sorted[i + 1]!.start_ms : Number.POSITIVE_INFINITY;
  let s = Math.max(prevEnd, Math.round(start));
  let e = Math.min(nextStart, Math.round(end));
  if (e - s < MIN_CUE_MS) {
    // pertahankan sisi yang sedang tidak digeser
    const cur = sorted[i];
    if (cur && s !== cur.start_ms) s = Math.max(prevEnd, e - MIN_CUE_MS);
    else e = Math.min(nextStart, s + MIN_CUE_MS);
  }
  return { start_ms: s, end_ms: e };
}

/**
 * Sisipkan cue baru pada waktu `t`:
 * - di dalam cue → cue itu DIBELAH di `t` (bagian kedua jadi cue baru tanpa teks, visual ikut dilanjutkan);
 * - di celah → cue baru mengisi celah sampai NEW_CUE_MS (atau sampai cue berikutnya);
 * - sesudah cue terakhir → cue baru NEW_CUE_MS.
 * Mengembalikan null bila ruang < MIN_CUE_MS.
 */
export function insertCueAt(cues: Cue[], t: number, lineCount: number): { cues: Cue[]; id: string } | null {
  const time = Math.max(0, Math.round(t));
  const sorted = sortCues(cues);
  const inside = sorted.find((c) => time > c.start_ms && time < c.end_ms);
  const blank = (): string[] => Array.from({ length: Math.max(1, lineCount) }, () => '');
  if (inside) {
    if (time - inside.start_ms < MIN_CUE_MS || inside.end_ms - time < MIN_CUE_MS) return null;
    const id = newId();
    const visual = inside.visual ? { ...inside.visual, sourceInMs: inside.visual.sourceInMs + (time - inside.start_ms) } : undefined;
    const second: Cue = { id, start_ms: time, end_ms: inside.end_ms, lines: blank(), visual };
    return { cues: [...cues.map((c) => (c.id === inside.id ? { ...c, end_ms: time } : c)), second], id };
  }
  const next = sorted.find((c) => c.start_ms >= time);
  const end = Math.min(time + NEW_CUE_MS, next ? next.start_ms : Number.POSITIVE_INFINITY);
  if (end - time < MIN_CUE_MS) return null;
  const id = newId();
  return { cues: [...cues, { id, start_ms: time, end_ms: end, lines: blank() }], id };
}

/**
 * Geser semua cue sebesar `deltaMs` (positif = lebih lambat, negatif = lebih cepat). Visual/audio cue ikut karena
 * melekat pada cue. Geser mundur dibatasi agar cue pertama tidak sebelum 0. Mengembalikan delta yang benar-benar dipakai.
 */
export function shiftAllCues(cues: Cue[], deltaMs: number): { cues: Cue[]; applied: number } {
  if (!cues.length) return { cues, applied: 0 };
  const first = Math.min(...cues.map((c) => c.start_ms));
  const applied = Math.max(-first, Math.round(deltaMs));
  if (applied === 0) return { cues, applied: 0 };
  return { cues: cues.map((c) => ({ ...c, start_ms: c.start_ms + applied, end_ms: c.end_ms + applied })), applied };
}

/**
 * Geser cue `fromCueId` BESERTA semua cue sesudahnya sebesar `deltaMs` (ripple). Geser mundur dibatasi oleh akhir
 * cue sebelumnya (tidak tumpang tindih) dan 0. Mengembalikan delta yang benar-benar dipakai.
 */
export function shiftCuesFrom(cues: Cue[], fromCueId: string, deltaMs: number): { cues: Cue[]; applied: number } {
  const sorted = sortCues(cues);
  const i = sorted.findIndex((c) => c.id === fromCueId);
  if (i < 0) return { cues, applied: 0 };
  const from = sorted[i]!.start_ms;
  const floor = i > 0 ? sorted[i - 1]!.end_ms : 0;
  const applied = Math.max(floor - from, Math.round(deltaMs));
  if (applied === 0) return { cues, applied: 0 };
  const moving = new Set(sorted.slice(i).map((c) => c.id));
  return { cues: cues.map((c) => (moving.has(c.id) ? { ...c, start_ms: c.start_ms + applied, end_ms: c.end_ms + applied } : c)), applied };
}

/**
 * Sisipkan cue baru (durasi `durationMs`) DAN geser cue sesudahnya agar muat — selalu berhasil, tanpa perlu celah.
 * Di dalam cue → cue baru tepat SETELAH cue itu; di celah → di posisi `t`. Cue yang mulai di/sesudah titik sisip
 * bergeser sebesar durasi cue baru.
 */
export function insertCueRipple(cues: Cue[], t: number, lineCount: number, durationMs = NEW_CUE_MS): { cues: Cue[]; id: string } {
  const time = Math.max(0, Math.round(t));
  const inside = cues.find((c) => time >= c.start_ms && time < c.end_ms);
  const at = inside ? inside.end_ms : time;
  const shifted = cues.map((c) => (c.start_ms >= at ? { ...c, start_ms: c.start_ms + durationMs, end_ms: c.end_ms + durationMs } : c));
  const id = newId();
  const lines = Array.from({ length: Math.max(1, lineCount) }, () => '');
  return { cues: [...shifted, { id, start_ms: at, end_ms: at + durationMs, lines }], id };
}
