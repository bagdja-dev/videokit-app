// Impor file media lokal: periksa jenis & metadata, simpan Blob ke IndexedDB, kembalikan MediaRef.
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { LIMITS, newId, type MediaKind, type MediaRef } from './model';
import { saveMedia } from './storage';

export class MediaImportError extends Error {}

const kindOf = (file: File): MediaKind | null => {
  if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name)) return 'video';
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) return 'image';
  if (file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(file.name)) return 'audio';
  return null;
};

export async function importMedia(file: File, accept: MediaKind[]): Promise<MediaRef> {
  const kind = kindOf(file);
  if (!kind || !accept.includes(kind)) {
    throw new MediaImportError(`Jenis file tidak didukung di sini (diterima: ${accept.join(', ')})`);
  }
  if (file.size > LIMITS.maxMediaBytes) throw new MediaImportError('File lebih dari 2 GB');
  const ref: MediaRef = { id: newId(), name: file.name, kind, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size };

  if (kind === 'image') {
    const bmp = await createImageBitmap(file).catch(() => { throw new MediaImportError('Gambar tidak bisa dibaca'); });
    ref.width = bmp.width; ref.height = bmp.height;
    bmp.close();
  } else {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      ref.durationMs = Math.round((await input.computeDuration()) * 1000);
      if (kind === 'video') {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new MediaImportError('File tidak punya track video');
        if (!(await track.canDecode())) throw new MediaImportError(`Codec video ${track.codec} tidak bisa diputar di perangkat ini`);
        ref.width = track.displayWidth; ref.height = track.displayHeight;
      } else if (!(await input.getPrimaryAudioTrack())) {
        throw new MediaImportError('File tidak punya track audio');
      }
    } catch (e) {
      if (e instanceof MediaImportError) throw e;
      throw new MediaImportError('Format file tidak dikenali');
    } finally {
      input.dispose?.();
    }
  }
  await saveMedia(ref.id, file);
  return ref;
}

export const formatMs = (ms: number): string => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
