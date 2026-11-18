// Pemeriksaan & persiapan file .vrm DI BROWSER sebelum diunggah (server hanya memeriksa header GLB):
// bisa dimuat three-vrm, kerangka humanoid, ekspresi, metadata lisensi, thumbnail, SHA-256.
import { AvatarScene, type AvatarInfo, type FramingAdjust } from '@/core/avatar/avatar-scene';
import { NO_CALIBRATION, mapToPose } from '@/core/avatar/rig';

export const VRM_MAX_BYTES = 50 * 1024 * 1024;
const THUMB_W = 360, THUMB_H = 480;

export interface PreparedAvatar {
  file: File;
  bytes: ArrayBuffer;
  sha256: string;
  info: AvatarInfo;
  thumbnail: Blob;
}

export class PrepareError extends Error {}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Gambar thumbnail dada-ke-atas (latar transparan) dengan bingkai yang sama dengan pratinjau/render. */
export async function renderThumbnail(bytes: ArrayBuffer, adjust?: FramingAdjust): Promise<{ info: AvatarInfo; thumbnail: Blob }> {
  const canvas = new OffscreenCanvas(THUMB_W, THUMB_H);
  const scene = new AvatarScene(canvas, { width: THUMB_W, height: THUMB_H, background: null, framing: 'bust', adjust });
  try {
    const info = await scene.load(bytes.slice(0));
    const pose = mapToPose(() => 0, NO_CALIBRATION, { mirror: true });
    pose.expressions.happy = 0.35;
    scene.applyPose(pose, 0);
    for (let i = 0; i < 30; i++) scene.step(1 / 30); // biarkan rambut/baju (spring bone) turun ke posisi diam
    let thumbnail = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
    if (thumbnail.type !== 'image/webp') thumbnail = await canvas.convertToBlob({ type: 'image/png' });
    return { info, thumbnail };
  } finally {
    scene.dispose();
  }
}

export async function prepareVrm(file: File): Promise<PreparedAvatar> {
  if (!/\.vrm$/i.test(file.name)) throw new PrepareError('Pilih file berakhiran .vrm');
  if (file.size > VRM_MAX_BYTES) throw new PrepareError(`File ${(file.size / 1e6).toFixed(1)} MB melebihi batas 50 MB`);
  const bytes = await file.arrayBuffer();
  let rendered: { info: AvatarInfo; thumbnail: Blob };
  try {
    rendered = await renderThumbnail(bytes);
  } catch (e) {
    throw new PrepareError(`Avatar tidak bisa dimuat: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (rendered.thumbnail.size > 512 * 1024) throw new PrepareError('Thumbnail terlalu besar');
  return { file, bytes, sha256: await sha256Hex(bytes), ...rendered };
}
