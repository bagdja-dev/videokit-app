// API publik executor browser: renderVideo(spec, sources) → File MP4 di OPFS.
import { renderAudioChunks } from './audio';
import { detectRenderCapabilities, MAX_DURATION_MEMORY_MS } from './capabilities';
import { fontsForAss } from './fonts';
import { pruneRenders, readRender } from './opfs';
import type { FromWorker, ToWorker } from './protocol';
import { renderSubtitleLayers } from './subtitles';
import type { SubtitleLayer } from './subtitles';
import { validateSpec } from './timeline';
import type { RenderProgress, RenderResult, RenderSources, RenderSpecV1 } from './types';


export interface RenderOptions {
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
  /** URL font untuk subtitle. Default: hanya font yang dirujuk ASS (lihat fonts.ts). */
  fonts?: string[];
  fileName?: string;
  /** Paksa mode penyimpanan (uji). Default: OPFS bila tersedia. */
  storage?: 'opfs' | 'memory';
}

export class RenderError extends Error {
  constructor(message: string, readonly details?: string[]) { super(message); this.name = 'RenderError'; }
}

const absolute = (sources: RenderSources): RenderSources =>
  Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, typeof v === 'string' ? new URL(v, location.href).href : v]));

/**
 * Unduh font lebih dulu (dengan progres) lalu serahkan sebagai byte ke JASSUB. Font CJK berukuran MB;
 * bila dibiarkan diunduh worker JASSUB, pemanasan font bisa melewati batas waktu di jaringan lambat.
 * Cache HTTP browser membuat render berikutnya tidak mengunduh ulang.
 */
export async function loadFonts(paths: string[], onProgress: (p: number) => void = () => {}, signal?: AbortSignal): Promise<Uint8Array[]> {
  const urls = [...new Set(paths)].map((f) => new URL(f, location.href).href);
  const done = new Array<number>(urls.length).fill(0);
  const total = new Array<number>(urls.length).fill(0);
  const tick = () => {
    const t = total.reduce((a, b) => a + b, 0);
    if (t > 0) onProgress(Math.min(1, done.reduce((a, b) => a + b, 0) / t));
  };
  return Promise.all(urls.map(async (url, i) => {
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) throw new RenderError(`Font gagal dimuat (${res.status}): ${url.split('/').pop()}`);
    total[i] = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      parts.push(value);
      n += value.byteLength;
      done[i] = n;
      tick();
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.byteLength; }
    return out;
  }));
}

export async function renderVideo(spec: RenderSpecV1, sources: RenderSources, opts: RenderOptions = {}): Promise<RenderResult> {
  const t0 = performance.now();
  const issues = validateSpec(spec);
  if (issues.length) throw new RenderError('Render spec tidak valid', issues.map((i) => `${i.path}: ${i.message}`));
  const detected = await detectRenderCapabilities(spec.output);
  const caps = opts.storage === 'memory' && detected.opfs
    ? { ...detected, opfs: false, maxDurationMs: MAX_DURATION_MEMORY_MS }
    : detected;
  if (!caps.canRender || !caps.audioCodec) throw new RenderError('Perangkat ini tidak bisa me-render', caps.reasons);
  if (spec.output.duration_ms > caps.maxDurationMs) {
    throw new RenderError(`Video terlalu panjang untuk dirender di perangkat ini (maks. ${caps.maxDurationMs / 60_000} menit)`, caps.warnings);
  }
  opts.signal?.throwIfAborted();
  if (caps.opfs) await pruneRenders().catch(() => undefined);

  const report = (p: RenderProgress) => opts.onProgress?.(p);
  report({ stage: 'preparing', progress: 0 });
  const src = absolute(sources);

  // 1. Subtitle (main thread, libass).
  let layers: SubtitleLayer[] = [];
  if (spec.subtitles) {
    const s = src[spec.subtitles.input];
    if (!s) throw new RenderError(`Sumber subtitle "${spec.subtitles.input}" tidak diberikan`);
    const ass = typeof s === 'string' ? await (await fetch(s)).text() : await s.text();
    const fonts = await loadFonts(opts.fonts ?? fontsForAss(ass), (p) => report({ stage: 'fonts', progress: p }), opts.signal);
    report({ stage: 'subtitles', progress: 0 });
    layers = await renderSubtitleLayers(ass, {
      width: spec.output.width, height: spec.output.height, fonts, signal: opts.signal,
    });
  }

  // 2. Worker komposit.
  const fileName = opts.fileName ?? `render-${Date.now()}.mp4`;
  const worker = new Worker(new URL('./compositor.worker.ts', import.meta.url), { type: 'module', name: 'videokit-compositor' });
  const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
  const onAbort = () => send({ type: 'cancel' });
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const finished = new Promise<Extract<FromWorker, { type: 'done' }>>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'progress') report(m.progress);
      else if (m.type === 'done') resolve(m);
      else reject(m.message.startsWith('AbortError') ? new DOMException('Render dibatalkan', 'AbortError') : new RenderError(m.message));
    };
    worker.onerror = (e) => reject(new RenderError(`Worker gagal: ${e.message}`));
  });

  try {
    send({ type: 'start', spec, sources: src, subtitles: layers, audioCodec: caps.audioCodec, storage: caps.opfs ? 'opfs' : 'memory', opfsFileName: fileName }, layers.map((l) => l.bitmap));

    // 3. Audio (main thread) dikirim per potongan; worker meng-encode sambil jalan.
    const tAudio = performance.now();
    await renderAudioChunks(spec, src, (c) => send({ type: 'audio-chunk', ...c }, [c.data.buffer]), opts.signal);
    send({ type: 'audio-end' });
    const audioMs = performance.now() - tAudio;

    const done = await finished;
    const file = done.buffer ? new File([done.buffer], fileName, { type: 'video/mp4' }) : await readRender(fileName);
    const totalMs = performance.now() - t0;
    report({ stage: 'done', progress: 1 });
    return {
      file,
      stats: {
        totalMs, videoMs: done.videoMs, audioMs,
        realtimeFactor: spec.output.duration_ms / totalMs,
        bytes: done.bytes, audioCodec: caps.audioCodec,
      },
    };
  } catch (e) {
    send({ type: 'cancel' });
    throw e;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    // beri worker waktu membersihkan file OPFS sebelum dihentikan
    setTimeout(() => worker.terminate(), 2000);
  }
}
