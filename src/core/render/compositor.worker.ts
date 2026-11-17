// Worker komposit: decode (WebCodecs via mediabunny) → gambar ke OffscreenCanvas → encode H.264 →
// mux MP4 bertahap ke OPFS. Subtitle (bitmap per interval) dan audio (PCM per potongan) datang dari main thread.
import {
  ALL_FORMATS, AudioSample, AudioSampleSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat,
  Output, QUALITY_HIGH, StreamTarget, UrlSource,
} from 'mediabunny';
import type { InputVideoTrack, WrappedCanvas } from 'mediabunny';
import { opfsWritable, deleteRender } from './opfs';
import type { FromWorker, ToWorker, WorkerSubtitleLayer } from './protocol';
import { segmentFrameRange, sourceTimeFor, totalFrames } from './timeline';
import type { Fit, RenderSource } from './types';
import { isColorSegment } from './types';
import { AUDIO_SAMPLE_RATE } from './audio';
import type { AvatarOverlayRenderer } from '../avatar/overlay-renderer';

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

// Antrean pesan agar alur render bisa `await` pesan berikutnya (audio-chunk) secara berurutan.
const queue: ToWorker[] = [];
let wake: (() => void) | null = null;
let cancelled = false;
self.onmessage = (e: MessageEvent<ToWorker>) => {
  if (e.data.type === 'cancel') { cancelled = true; }
  queue.push(e.data);
  wake?.();
};
async function next(): Promise<ToWorker> {
  while (!queue.length) await new Promise<void>((r) => { wake = r; });
  wake = null;
  return queue.shift()!;
}
const checkCancel = () => { if (cancelled) throw new DOMException('Render dibatalkan', 'AbortError'); };

interface VideoSourceState { kind: 'video'; input: Input; track: InputVideoTrack; duration: number }
interface ImageSourceState { kind: 'image'; bitmap: ImageBitmap }

async function openSource(src: RenderSource, kind: 'video' | 'image'): Promise<VideoSourceState | ImageSourceState> {
  if (kind === 'image') {
    const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    return { kind: 'image', bitmap: await createImageBitmap(blob) };
  }
  const input = new Input({ source: typeof src === 'string' ? new UrlSource(src) : new BlobSource(src), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('File tidak punya track video');
  if (!(await track.canDecode())) throw new Error(`Codec ${track.codec} tidak bisa di-decode di perangkat ini`);
  return { kind: 'video', input, track, duration: await input.computeDuration() };
}

async function run(start: Extract<ToWorker, { type: 'start' }>) {
  const { spec, sources, subtitles, audioCodec, opfsFileName, storage } = start;
  const { width: W, height: H, fps: FPS } = spec.output;
  const frames = totalFrames(spec);

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  // Latar blur: dirender di kanvas kecil lalu diperbesar — jauh lebih murah dari blur penuh (temuan PoC §5).
  const BLUR_DOWNSCALE = 8;
  const small = new OffscreenCanvas(Math.max(2, Math.round(W / BLUR_DOWNSCALE)), Math.max(2, Math.round(H / BLUR_DOWNSCALE)));
  const sctx = small.getContext('2d')!;

  const target = storage === 'opfs'
    ? new StreamTarget(await opfsWritable(opfsFileName), { chunked: true })
    : new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: storage === 'opfs' ? false : 'in-memory' }), target });
  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: FPS });
  const audioSource = new AudioSampleSource({ codec: audioCodec, bitrate: 192_000 });
  output.addAudioTrack(audioSource);
  await output.start();

  try {
    // 1. Audio dari main thread, potongan berurutan.
    post({ type: 'progress', progress: { stage: 'audio', progress: 0 } });
    for (;;) {
      checkCancel();
      const m = await next();
      if (m.type === 'audio-end') break;
      if (m.type !== 'audio-chunk') continue;
      const sample = new AudioSample({ data: m.data, format: 'f32-planar', numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE, timestamp: m.timestamp });
      await audioSource.add(sample);
      sample.close();
    }
    audioSource.close();

    // 2. Video — per frame: lapisan latar (opsional) → segmen aktif → subtitle.
    const tVideo = performance.now();
    const opened = new Map<string, VideoSourceState | ImageSourceState>();
    const getSource = async (key: string): Promise<VideoSourceState | ImageSourceState> => {
      const existing = opened.get(key);
      if (existing) return existing;
      const src = sources[key];
      if (!src) throw new Error(`Sumber "${key}" tidak diberikan`);
      const state = await openSource(src, spec.inputs[key]!.kind as 'video' | 'image');
      opened.set(key, state);
      return state;
    };
    /**
     * Gambar media dengan fit. `clear`: bersihkan ke background_color dulu — piksel transparan (PNG
     * logo/stiker) & area kosong `contain` menampilkan warna latar. Saat ada lapisan latar, clear=false
     * sehingga area itu memperlihatkan lapisan latar. Aturan yang sama dipakai executor server.
     */
    const drawFit = (img: CanvasImageSource, iw: number, ih: number, fit: Fit, clear: boolean) => {
      const cover = Math.max(W / iw, H / ih), contain = Math.min(W / iw, H / ih);
      const draw = (c: OffscreenCanvasRenderingContext2D, cw: number, ch: number, s: number) => {
        const w = iw * s, h = ih * s;
        c.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      };
      if (clear) {
        ctx.fillStyle = spec.output.background_color;
        ctx.fillRect(0, 0, W, H);
      }
      if (fit === 'cover') return draw(ctx, W, H, cover);
      if (fit === 'contain') return draw(ctx, W, H, contain);
      sctx.fillStyle = spec.output.background_color;
      sctx.fillRect(0, 0, small.width, small.height);
      sctx.filter = 'blur(5px)';
      draw(sctx, small.width, small.height, Math.max(small.width / iw, small.height / ih) * 1.15);
      sctx.filter = 'none';
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, W, H);
      draw(ctx, W, H, contain);
    };
    const subtitleAt = (tMs: number): WorkerSubtitleLayer | undefined =>
      subtitles.find((s) => tMs >= s.start_ms && tMs < s.end_ms);
    const allFrames = Array.from({ length: frames }, (_, i) => i);

    // Lapisan latar: di-loop sepanjang video.
    let bgState: VideoSourceState | ImageSourceState | null = null;
    let bgIter: AsyncGenerator<WrappedCanvas | null> | null = null;
    const bgFit: Fit = spec.background?.fit ?? 'cover';
    if (spec.background) {
      bgState = await getSource(spec.background.input);
      if (bgState.kind === 'video') {
        const bs = bgState;
        const loopSeg = { input: spec.background.input, start_ms: 0, end_ms: spec.output.duration_ms, fit: bgFit, underflow: 'loop' as const };
        bgIter = new CanvasSink(bs.track, { poolSize: 3 }).canvasesAtTimestamps(allFrames.map((i) => sourceTimeFor(loopSeg, (i * 1000) / FPS, bs.duration, FPS)));
      }
    }

    // Lapisan avatar (tool Avatar Rekam): three.js dimuat hanya bila spec memakainya.
    let avatar: AvatarOverlayRenderer | null = null;
    const ov = spec.overlays?.[0];
    if (ov) {
      const bytes = async (key: string) => {
        const s = sources[key];
        if (!s) throw new Error(`Sumber "${key}" tidak diberikan`);
        return typeof s === 'string' ? (await fetch(s)).arrayBuffer() : s.arrayBuffer();
      };
      const { createAvatarOverlay } = await import('../avatar/overlay-renderer');
      avatar = await createAvatarOverlay(ov, await bytes(ov.input), await bytes(ov.motion), W, H, FPS);
    }

    interface Active { seg: (typeof spec.video_track)[number]; last: number; state: VideoSourceState | ImageSourceState | null; iter: AsyncGenerator<WrappedCanvas | null> | null }
    const segs = [...spec.video_track].sort((a, b) => a.start_ms - b.start_ms);
    let si = 0;
    let cur: Active | null = null;

    for (const i of allFrames) {
      checkCancel();
      const tMs = (i * 1000) / FPS;
      if (cur && i >= cur.last) { await cur.iter?.return(undefined); cur = null; }
      while (!cur && si < segs.length) {
        const seg = segs[si]!;
        const { first, last } = segmentFrameRange(seg, FPS);
        if (last <= first || last <= i) { si++; continue; } // segmen tanpa frame
        if (i < first) break; // rentang kosong sebelum segmen berikutnya → latar
        si++;
        let state: VideoSourceState | ImageSourceState | null = null;
        let iter: AsyncGenerator<WrappedCanvas | null> | null = null;
        if (!isColorSegment(seg)) {
          state = await getSource(seg.input);
          if (state.kind === 'video') {
            const vs = state;
            const idx = Array.from({ length: last - i }, (_, k) => i + k);
            iter = new CanvasSink(vs.track, { poolSize: 3 }).canvasesAtTimestamps(idx.map((f) => sourceTimeFor(seg, (f * 1000) / FPS, vs.duration, FPS)));
          }
        }
        cur = { seg, last, state, iter };
      }

      // a. latar
      if (bgState) {
        if (bgState.kind === 'image') drawFit(bgState.bitmap, bgState.bitmap.width, bgState.bitmap.height, bgFit, true);
        else {
          const { value } = await bgIter!.next();
          if (value) drawFit(value.canvas, value.canvas.width, value.canvas.height, bgFit, true);
        }
      } else if (!cur) {
        ctx.fillStyle = spec.output.background_color;
        ctx.fillRect(0, 0, W, H);
      }
      // b. segmen aktif
      if (cur) {
        const clear = !bgState;
        if (isColorSegment(cur.seg)) {
          ctx.fillStyle = cur.seg.color;
          ctx.fillRect(0, 0, W, H);
        } else if (cur.state?.kind === 'image') {
          drawFit(cur.state.bitmap, cur.state.bitmap.width, cur.state.bitmap.height, cur.seg.fit, clear);
        } else if (cur.iter) {
          const { value } = await cur.iter.next();
          if (value) drawFit(value.canvas, value.canvas.width, value.canvas.height, cur.seg.fit, clear);
        }
      }
      // c. avatar
      if (avatar?.active(tMs)) {
        avatar.render(tMs);
        ctx.drawImage(avatar.canvas, avatar.rect.x, avatar.rect.y);
      }
      // d. subtitle
      const sub = subtitleAt(tMs);
      if (sub) ctx.drawImage(sub.bitmap, 0, 0, W, H);
      await videoSource.add(i / FPS, 1 / FPS);
      if ((i + 1) % 15 === 0 || i + 1 === frames) {
        post({ type: 'progress', progress: { stage: 'video', progress: (i + 1) / frames, frame: i + 1, totalFrames: frames } });
      }
    }
    await cur?.iter?.return(undefined);
    await bgIter?.return(undefined);
    avatar?.dispose();
    videoSource.close();
    post({ type: 'progress', progress: { stage: 'finalizing', progress: 1 } });
    await output.finalize();
    for (const s of opened.values()) if (s.kind === 'image') s.bitmap.close();
    subtitles.forEach((s) => s.bitmap.close());
    if (target instanceof BufferTarget) {
      const buffer = target.buffer!;
      (self as unknown as Worker).postMessage({ type: 'done', bytes: buffer.byteLength, videoMs: performance.now() - tVideo, buffer } satisfies FromWorker, [buffer]);
    } else {
      const file = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('videokit-renders')).getFileHandle(opfsFileName);
      post({ type: 'done', bytes: (await file.getFile()).size, videoMs: performance.now() - tVideo });
    }
  } catch (e) {
    await output.cancel().catch(() => undefined);
    if (storage === 'opfs') await deleteRender(opfsFileName);
    throw e;
  }
}

(async () => {
  try {
    const first = await next();
    if (first.type !== 'start') throw new Error('Pesan pertama harus "start"');
    await run(first);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? `${e.name === 'AbortError' ? 'AbortError: ' : ''}${e.message}` : String(e) });
  }
})();
