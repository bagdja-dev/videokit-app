// Uji determinisme A0: render avatar di worker (OffscreenCanvas WebGL) N frame dan kembalikan hash piksel tiap frame.
// Dua worker terpisah dengan masukan sama harus menghasilkan hash identik.
import { createAvatarOverlay } from '@/core/avatar/overlay-renderer';
import type { AvatarOverlay } from '@/core/render/types';

interface Req { overlay: AvatarOverlay; vrm: ArrayBuffer; motion: ArrayBuffer; W: number; H: number; fps: number; frames: number }

async function sha(data: Uint8ClampedArray): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

self.onmessage = async (e: MessageEvent<Req>) => {
  try {
    const { overlay, vrm, motion, W, H, fps, frames } = e.data;
    const t0 = performance.now();
    const r = await createAvatarOverlay(overlay, vrm, motion, W, H, fps);
    const loadMs = performance.now() - t0;
    const copy = new OffscreenCanvas(r.rect.w, r.rect.h);
    const cx = copy.getContext('2d', { willReadFrequently: true })!;
    const hashes: string[] = [];
    let opaque = 0;
    const t1 = performance.now();
    for (let i = 0; i < frames; i++) {
      r.render((i * 1000) / fps);
      cx.clearRect(0, 0, r.rect.w, r.rect.h);
      cx.drawImage(r.canvas, 0, 0);
      const px = cx.getImageData(0, 0, r.rect.w, r.rect.h).data;
      if (i === 0) for (let p = 3; p < px.length; p += 4) if (px[p]! > 0) opaque++;
      hashes.push(await sha(px));
    }
    const msPerFrame = (performance.now() - t1) / frames;
    r.dispose();
    (self as unknown as Worker).postMessage({ ok: true, hashes, loadMs, msPerFrame, opaqueFrac: opaque / (r.rect.w * r.rect.h), rect: r.rect });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};
