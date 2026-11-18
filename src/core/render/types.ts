// Render Spec v1 — kontrak yang sama untuk executor browser (modul ini) dan executor server
// (bagdja-video-render). Lihat plan/video-render/overview.md §3.2.

export type Fit = 'cover' | 'contain' | 'blur';
export type Underflow = 'freeze' | 'loop';
/** `avatar` = file .vrm, `motion` = motion track v1 (tool Avatar Rekam). */
export type InputKind = 'video' | 'image' | 'audio' | 'subtitle' | 'avatar' | 'motion';

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
  /** Input audio, atau video (memakai track audionya, mis. audio video latar). */
  input: string;
  /** background: di-loop/fade/ducking (musik latar, audio video latar). voice: narasi/audio cue. */
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

/**
 * Lapisan latar (video/gambar) sepanjang durasi, di-loop, di bawah semua segmen.
 * Bila ada: rentang tanpa segmen menampilkan latar, dan area kosong segmen `contain` / piksel transparan
 * memperlihatkan latar (bukan background_color). Audionya, bila dipakai, didaftarkan sebagai audio track
 * role `background` dengan input yang sama.
 */
export interface BackgroundLayer {
  input: string;
  fit?: Fit;
}

export type AvatarAnchor = 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left' | 'center';

export interface AvatarPlacement {
  anchor: AvatarAnchor;
  /** Lebar kotak avatar sebagai fraksi lebar output (0.1–1). */
  width: number;
  /** Rasio lebar/tinggi kotak avatar (default 3/4 — potret dada ke atas). */
  aspect?: number;
  /** Jarak dari tepi sebagai fraksi sisi terpendek output (default 0.03). */
  margin?: number;
}

/**
 * Lapisan avatar (plan/videokit/avatar-record/overview.md §6.2): avatar VRM digambar per frame dari motion track,
 * ditumpuk di atas video dan di bawah subtitle. Hanya executor browser (AV-D5).
 */
export interface AvatarOverlay {
  type: 'avatar';
  input: string;
  motion: string;
  start_ms: number;
  end_ms: number;
  /** Waktu motion track yang dipakai pada start_ms (potong awal rekaman). */
  motion_offset_ms?: number;
  placement: AvatarPlacement;
  /** null/undefined = transparan. */
  background?: string | null;
  framing?: 'bust' | 'head';
  /** Bingkai manual per avatar (zoom 0.5–2.5, offset −0.5..0.5 relatif tinggi avatar). */
  camera?: { zoom: number; offset_x: number; offset_y: number };
  mirror?: boolean;
  /** Pose netral saat kalibrasi (radian & nilai blendshape istirahat). */
  calibration?: { head: { pitch: number; yaw: number; roll: number }; rest: Record<string, number> };
}

export interface RenderSpecV1 {
  spec_version: 1;
  output: RenderOutput;
  inputs: Record<string, RenderInput>;
  background?: BackgroundLayer;
  video_track: VideoSegment[];
  audio_tracks: AudioTrack[];
  subtitles?: { input: string; font_set: string };
  overlays?: AvatarOverlay[];
}

/** Sumber input untuk executor browser: Blob/File lokal (tanpa upload) atau URL. */
export type RenderSource = Blob | string;
export type RenderSources = Record<string, RenderSource>;

export interface RenderProgress {
  stage: 'preparing' | 'fonts' | 'subtitles' | 'audio' | 'video' | 'finalizing' | 'done';
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
