// Posisi kotak avatar di frame output — fungsi murni, sama untuk pratinjau tata letak dan render.
import type { AvatarPlacement } from '@/core/render/types';

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function avatarRect(p: AvatarPlacement, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const aspect = p.aspect ?? 3 / 4;
  let w = even(p.width * W);
  let h = even(w / aspect);
  if (h > H) { h = even(H); w = even(h * aspect); }
  const m = Math.round((p.margin ?? 0.03) * Math.min(W, H));
  const left = m, right = W - w - m, top = m, bottom = H - h - m;
  const cx = Math.round((W - w) / 2), cy = Math.round((H - h) / 2);
  switch (p.anchor) {
    case 'bottom-left': return { x: left, y: bottom, w, h };
    case 'bottom-center': return { x: cx, y: bottom, w, h };
    case 'top-right': return { x: right, y: top, w, h };
    case 'top-left': return { x: left, y: top, w, h };
    case 'center': return { x: cx, y: cy, w, h };
    default: return { x: right, y: bottom, w, h };
  }
}
