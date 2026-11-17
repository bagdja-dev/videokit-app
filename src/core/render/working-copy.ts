// Salinan kerja saat upload (D5 via D13): media diperkecil ke ukuran output di browser sebelum PUT ke
// storage-service, sehingga upload lebih kecil dan server tidak perlu transcode.
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny';

export interface WorkingCopyTarget {
  /** Sisi panjang maksimum (px), mis. 1920 untuk output 1080×1920. */
  maxLongEdge: number;
  fps: number;
}

export interface WorkingCopyResult {
  blob: Blob;
  width: number;
  height: number;
  durationMs?: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function fitLongEdge(w: number, h: number, maxLong: number): { width: number; height: number } {
  const scale = Math.min(1, maxLong / Math.max(w, h));
  return { width: even(w * scale), height: even(h * scale) };
}

/** Video → MP4 H.264 + AAC, rasio asli dipertahankan, fps konstan, keyframe rapat untuk scrub. */
export async function makeVideoWorkingCopy(file: Blob, target: WorkingCopyTarget, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<WorkingCopyResult> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('File tidak punya track video');
  const { width, height } = fitLongEdge(track.displayWidth, track.displayHeight, target.maxLongEdge);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input, output,
    video: { width, height, fit: 'fill', frameRate: target.fps, codec: 'avc', bitrate: QUALITY_HIGH, forceTranscode: true },
    audio: { codec: 'aac', bitrate: 192_000, sampleRate: 48_000, numberOfChannels: 2 },
  });
  if (!conversion.isValid) throw new Error(`File tidak bisa dikonversi: ${conversion.discardedTracks.map((d) => d.reason).join(', ')}`);
  conversion.onProgress = (p) => onProgress?.(p);
  const onAbort = () => void conversion.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await conversion.execute();
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('Konversi tidak menghasilkan data');
  return { blob: new Blob([buffer], { type: 'video/mp4' }), width, height, durationMs: Math.round((await input.computeDuration()) * 1000) };
}

/** Gambar → WebP diperkecil ke ukuran output. */
export async function makeImageWorkingCopy(file: Blob, target: Pick<WorkingCopyTarget, 'maxLongEdge'>): Promise<WorkingCopyResult> {
  const bmp = await createImageBitmap(file);
  const { width, height } = fitLongEdge(bmp.width, bmp.height, target.maxLongEdge);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return { blob: await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 }), width, height };
}
