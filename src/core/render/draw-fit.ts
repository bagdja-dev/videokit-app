// Aturan menggambar media dengan `fit` — SATU implementasi untuk compositor (render akhir) dan pratinjau langsung,
// agar tampilan pratinjau = hasil render.
import type { Fit } from './types';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Latar blur dirender di kanvas kecil lalu diperbesar — jauh lebih murah dari blur penuh (temuan PoC §5). */
const BLUR_DOWNSCALE = 8;

export type FitDrawer = (img: CanvasImageSource, iw: number, ih: number, fit: Fit, clear: boolean) => void;

/**
 * `clear`: bersihkan ke backgroundColor dulu — piksel transparan (PNG) & area kosong `contain` menampilkan warna
 * latar. Saat ada lapisan latar, clear=false sehingga area itu memperlihatkan lapisan latar.
 */
export function createFitDrawer(ctx: Ctx2D, W: number, H: number, backgroundColor: string): FitDrawer {
  const small = new OffscreenCanvas(Math.max(2, Math.round(W / BLUR_DOWNSCALE)), Math.max(2, Math.round(H / BLUR_DOWNSCALE)));
  const sctx = small.getContext('2d')!;
  const draw = (c: Ctx2D, img: CanvasImageSource, iw: number, ih: number, cw: number, ch: number, s: number) => {
    const w = iw * s, h = ih * s;
    c.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
  };
  return (img, iw, ih, fit, clear) => {
    if (!(iw > 0 && ih > 0)) return;
    const cover = Math.max(W / iw, H / ih), contain = Math.min(W / iw, H / ih);
    if (clear) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, W, H);
    }
    if (fit === 'cover') return draw(ctx, img, iw, ih, W, H, cover);
    if (fit === 'contain') return draw(ctx, img, iw, ih, W, H, contain);
    sctx.fillStyle = backgroundColor;
    sctx.fillRect(0, 0, small.width, small.height);
    sctx.filter = 'blur(5px)';
    draw(sctx, img, iw, ih, small.width, small.height, Math.max(small.width / iw, small.height / ih) * 1.15);
    sctx.filter = 'none';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
    draw(ctx, img, iw, ih, W, H, contain);
  };
}
