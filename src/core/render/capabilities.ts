// Deteksi apakah perangkat ini bisa menjadi executor render (gerbang routing hybrid, overview §2.8).
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { RenderOutput } from './types';

export interface RenderCapabilities {
  canRender: boolean;
  audioCodec: 'aac' | 'opus' | null;
  crossOriginIsolated: boolean;
  /** Hasil render ditulis bertahap ke OPFS; tanpa OPFS hasil ditahan di memori (durasi dibatasi). */
  opfs: boolean;
  /** Durasi maksimum yang aman di perangkat ini (D4: 30 menit dengan OPFS, 10 menit di memori). */
  maxDurationMs: number;
  /** Penghalang render. */
  reasons: string[];
  /** Tidak menghalangi render, tapi perlu diketahui. */
  warnings: string[];
}

export const MAX_DURATION_OPFS_MS = 30 * 60_000;
export const MAX_DURATION_MEMORY_MS = 10 * 60_000;

async function opfsUsable(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return false;
    await navigator.storage.getDirectory();
    return true;
  } catch {
    return false;
  }
}

export async function detectRenderCapabilities(output: Pick<RenderOutput, 'width' | 'height'>): Promise<RenderCapabilities> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
    warnings.push('Halaman tidak dibuka lewat HTTPS — sebagian browser mematikan WebCodecs/OPFS di koneksi tidak aman');
  }
  if (typeof VideoEncoder === 'undefined') reasons.push('Browser tidak mendukung WebCodecs (pakai Chrome/Edge terbaru)');
  if (typeof OffscreenCanvas === 'undefined') reasons.push('Browser tidak mendukung OffscreenCanvas');
  const opfs = await opfsUsable();
  if (!opfs) warnings.push(`OPFS tidak tersedia — hasil render ditahan di memori, maksimal ${MAX_DURATION_MEMORY_MS / 60_000} menit`);

  let avc = false;
  let audioCodec: RenderCapabilities['audioCodec'] = null;
  if (!reasons.length) {
    avc = await canEncodeVideo('avc', { width: output.width, height: output.height });
    if (!avc) reasons.push(`Tidak bisa encode H.264 ${output.width}×${output.height} di perangkat ini`);
    // AAC diutamakan: diterima semua platform sosial. Opus hanya cadangan (perlu diuji di platform tujuan).
    if (await canEncodeAudio('aac')) audioCodec = 'aac';
    else if (await canEncodeAudio('opus')) audioCodec = 'opus';
    else reasons.push('Tidak bisa encode audio AAC/Opus');
  }
  return {
    canRender: reasons.length === 0,
    audioCodec,
    crossOriginIsolated: typeof self !== 'undefined' && self.crossOriginIsolated === true,
    opfs,
    maxDurationMs: opfs ? MAX_DURATION_OPFS_MS : MAX_DURATION_MEMORY_MS,
    reasons,
    warnings,
  };
}
