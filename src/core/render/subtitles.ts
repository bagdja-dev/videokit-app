// Subtitle → lapisan bitmap per interval waktu, dirender libass (JASSUB) di MAIN THREAD.
// JASSUB butuh elemen <canvas> yang ikut layout dan pemanasan font (temuan PoC Fase 0, HASIL-POC.md §2).
// Fase 1 tanpa animasi/karaoke → isi subtitle statis di antara batas event, cukup dirender sekali per interval.
import JASSUB from 'jassub';

export interface SubtitleLayer {
  start_ms: number;
  end_ms: number;
  bitmap: ImageBitmap;
}

export interface SubtitleRenderOptions {
  width: number;
  height: number;
  /** Font (URL atau byte) yang dirujuk ASS. */
  fonts: Array<string | Uint8Array>;
  /** Basis URL vendor JASSUB (hasil `npm run vendor`). */
  vendorBase?: string;
  signal?: AbortSignal;
  /** Hanya render interval yang beririsan dengan rentang ini (pratinjau langsung SRT panjang). */
  window?: { from_ms: number; to_ms: number };
}

const WARMUP_TIMEOUT_MS = 10_000;

const filledPixels = (data: ArrayLike<number> | undefined): number => {
  if (!data) return 0;
  let n = 0;
  for (let p = 3; p < data.length; p += 4) if ((data[p] ?? 0) > 0) n++;
  return n;
};

const hasVisibleText = (text: string): boolean => text.replace(/\{[^}]*\}/g, '').replace(/\\[Nnh]/g, '').trim().length > 0;

export async function renderSubtitleLayers(assText: string, opts: SubtitleRenderOptions): Promise<SubtitleLayer[]> {
  const { width: W, height: H } = opts;
  const base = new URL(opts.vendorBase ?? '/vendor/jassub/', location.href);
  const el = document.createElement('canvas');
  el.width = W;
  el.height = H;
  // Tidak boleh display:none — JASSUB membaca clientWidth/clientHeight.
  Object.assign(el.style, {
    position: 'fixed', left: '0', top: '0', width: `${W}px`, height: `${H}px`,
    opacity: '0', pointerEvents: 'none', zIndex: '-1',
  });
  document.body.appendChild(el);

  const jassub = new JASSUB({
    canvas: el,
    subContent: assText,
    fonts: opts.fonts,
    workerUrl: new URL('worker.js', base).href,
    wasmUrl: new URL('jassub-worker.wasm', base).href,
    modernWasmUrl: new URL('jassub-worker-modern.wasm', base).href,
    prescaleFactor: 1,
    maxRenderHeight: H,
  });
  try {
    await jassub.ready;
    await jassub.resize(true, W, H);
    const events = (await jassub.renderer.getEvents()) as Array<{ Start?: number; Duration?: number; Text?: string }>;
    const spans = events
      .filter((e) => typeof e.Start === 'number' && typeof e.Duration === 'number' && e.Duration > 0)
      .map((e) => ({ start: e.Start as number, end: (e.Start as number) + (e.Duration as number), visible: hasVisibleText(e.Text ?? '') }));
    if (!spans.length) return [];

    const capture = async (tMs: number) => jassub.renderer._drawCapture(tMs / 1000);

    // Pemanasan font: render pertama kosong selama font dimuat asinkron di worker.
    const first = spans.find((s) => s.visible);
    if (first) {
      const t0 = performance.now();
      for (;;) {
        opts.signal?.throwIfAborted();
        await jassub.manualRender({ expectedDisplayTime: performance.now(), width: W, height: H, mediaTime: (first.start + 1) / 1000 }, true);
        if (filledPixels((await capture(first.start + 1))?.data) > 0) break;
        if (performance.now() - t0 > WARMUP_TIMEOUT_MS) throw new Error('Subtitle tidak ter-render (font/JASSUB gagal dimuat)');
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // Interval di antara semua batas event; tiap interval yang punya event aktif dirender sekali.
    const bounds = [...new Set(spans.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
    const layers: SubtitleLayer[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      opts.signal?.throwIfAborted();
      const a = bounds[i] as number, b = bounds[i + 1] as number;
      if (opts.window && (b <= opts.window.from_ms || a >= opts.window.to_ms)) continue;
      const active = spans.filter((s) => s.start <= a && s.end >= b);
      if (!active.length) continue;
      const cap = await capture(a + 1);
      if (!cap || filledPixels(cap.data) === 0) {
        if (active.some((s) => s.visible)) {
          throw new Error(`Subtitle kosong pada ${a}–${b} ms — render dihentikan agar tidak menghasilkan video tanpa subtitle`);
        }
        continue;
      }
      const tmp = new OffscreenCanvas(cap.width, cap.height);
      tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(cap.data), cap.width, cap.height), 0, 0);
      layers.push({ start_ms: a, end_ms: b, bitmap: await createImageBitmap(tmp) });
    }
    return layers;
  } finally {
    await jassub.destroy().catch(() => undefined);
    el.remove();
  }
}
