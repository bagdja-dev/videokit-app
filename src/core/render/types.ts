// Render Spec v1 — kontrak yang sama untuk executor browser (modul ini) dan executor server
// (bagdja-video-render). Lihat plan/video-render/overview.md §3.2.

export type Fit = 'cover' | 'contain' | 'blur';
export type Underflow = 'freeze' | 'loop';
export type InputKind = 'video' | 'image' | 'audio' | 'subtitle';

export interface RenderOutput {
  width: number;
  height: number;
  fps: number;
  duration_ms: number;
  background_color: string;
}

export interface RenderInput {
  kind: InputKind;
  /** URL yang bisa di-fetch browser (same-origin / CORS). Executor browser juga menerima Blob lewat RenderSources. */
  url?: string;
}

interface SegmentBase {
  start_ms: number;
  end_ms: number;
}

export interface MediaSegment extends SegmentBase {
  input: string;
  fit: Fit;
  /** Titik mulai di klip sumber (video). */
  source_in_ms?: number;
  /** Klip lebih pendek dari segmen. Default: freeze. */
  underflow?: Underflow;
  /** Pakai audio asli klip video (default mati, VideoKit §3.4). */
  keep_audio?: boolean;
}

export interface ColorSegment extends SegmentBase {
  color: string;
}

export type VideoSegment = MediaSegment | ColorSegment;

export interface Ducking {
  /** Gain latar saat voice berbunyi (0..1). */
  level: number;
  attack_ms: number;
  release_ms: number;
}

export interface AudioTrack {
  input: string;
  role: 'background' | 'voice';
  start_ms: number;
  /** Akhir pemutaran (default: start + durasi sumber, atau akhir video untuk loop). */
  end_ms?: number;
  loop?: boolean;
  volume?: number;
  fade_in_ms?: number;
  fade_out_ms?: number;
  ducking?: Ducking;
}

export interface RenderSpecV1 {
  spec_version: 1;
  output: RenderOutput;
  inputs: Record<string, RenderInput>;
  video_track: VideoSegment[];
  audio_tracks: AudioTrack[];
  subtitles?: { input: string; font_set: string };
}

/** Sumber input untuk executor browser: Blob/File lokal (tanpa upload) atau URL. */
export type RenderSource = Blob | string;
export type RenderSources = Record<string, RenderSource>;

export interface RenderProgress {
  stage: 'preparing' | 'subtitles' | 'audio' | 'video' | 'finalizing' | 'done';
  /** 0..1 */
  progress: number;
  frame?: number;
  totalFrames?: number;
}

export interface RenderResult {
  file: File;
  stats: {
    totalMs: number;
    videoMs: number;
    audioMs: number;
    realtimeFactor: number;
    bytes: number;
    audioCodec: 'aac' | 'opus';
  };
}

export const isColorSegment = (s: VideoSegment): s is ColorSegment => 'color' in s;
