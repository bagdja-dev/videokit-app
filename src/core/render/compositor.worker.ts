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

    // 2. Video.
    const tVideo = performance.now();
    const opened = new Map<string, VideoSourceState | ImageSourceState>();
    const drawFit = (img: CanvasImageSource, iw: number, ih: number, fit: Fit) => {
      const cover = Math.max(W / iw, H / ih), contain = Math.min(W / iw, H / ih);
      const draw = (c: OffscreenCanvasRenderingContext2D, cw: number, ch: number, s: number) => {
        const w = iw * s, h = ih * s;
        c.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      };
      // Selalu bersihkan ke warna latar dulu: piksel transparan (PNG logo/stiker) menampilkan background_color,
      // bukan sisa frame sebelumnya — aturan yang sama dipakai executor server.
      ctx.fillStyle = spec.output.background_color;
      ctx.fillRect(0, 0, W, H);
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

    let done = 0;
    for (const seg of [...spec.video_track].sort((a, b) => a.start_ms - b.start_ms)) {
      const { first, last } = segmentFrameRange(seg, FPS);
      const idx = Array.from({ length: last - first }, (_, k) => first + k);
      let iter: AsyncGenerator<WrappedCanvas | null> | null = null;
      let state: VideoSourceState | ImageSourceState | null = null;
      if (!isColorSegment(seg)) {
        const kind = spec.inputs[seg.input]!.kind as 'video' | 'image';
        state = opened.get(seg.input) ?? null;
        if (!state) {
          const src = sources[seg.input];
          if (!src) throw new Error(`Sumber "${seg.input}" tidak diberikan`);
          state = await openSource(src, kind);
          opened.set(seg.input, state);
        }
        if (state.kind === 'video') {
          const s = state;
          iter = new CanvasSink(s.track, { poolSize: 3 }).canvasesAtTimestamps(idx.map((i) => sourceTimeFor(seg, (i * 1000) / FPS, s.duration, FPS)));
        }
      }
      for (const i of idx) {
        checkCancel();
        const tMs = (i * 1000) / FPS;
        if (isColorSegment(seg)) {
          ctx.fillStyle = seg.color;
          ctx.fillRect(0, 0, W, H);
        } else if (state?.kind === 'image') {
          drawFit(state.bitmap, state.bitmap.width, state.bitmap.height, seg.fit);
        } else if (iter) {
          const { value } = await iter.next();
          if (value) drawFit(value.canvas, value.canvas.width, value.canvas.height, seg.fit);
        }
        const sub = subtitleAt(tMs);
        if (sub) ctx.drawImage(sub.bitmap, 0, 0, W, H);
        await videoSource.add(i / FPS, 1 / FPS);
        done++;
        if (done % 15 === 0 || done === frames) {
          post({ type: 'progress', progress: { stage: 'video', progress: done / frames, frame: done, totalFrames: frames } });
        }
      }
      await iter?.return(undefined);
    }
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
