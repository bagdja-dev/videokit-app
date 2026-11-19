'use client';

// Pratinjau langsung (real-time) — memakai spec, aturan fit, dan subtitle libass yang SAMA dengan render akhir,
// tetapi visual diputar dari <video> biasa sehingga bisa langsung dimainkan/digeser. Akurat secara tampilan;
// pergantian klip bisa terlambat sepersekian detik (render akhir tetap per-frame tepat).
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildVoiceChain, createFitDrawer, fontsForAss, hasVoiceFx, preFxFromKey, preFxKey, preFxOf, preprocessedWav, voiceTailMs, loadFonts, renderSubtitleLayers, sourceTimeFor, type SubtitleLayer, type VoiceChain } from '@/core/render';
import { isColorSegment, type MediaSegment } from '@/core/render/types';
import { OUTPUT_PRESETS, type SubtitleVideoProject } from '../model';
import { formatTime, usePlayback } from '../playback';
import { buildRenderJob } from '../spec-builder';
import { loadMedia } from '../storage';
import styles from './editor.module.css';

/** Sisi terpanjang kanvas pratinjau (px) — cukup tajam, ringan untuk HP. */
const PREVIEW_LONG_SIDE = 960;
/** Subtitle dirender untuk jendela sekitar posisi putar (SRT panjang tetap ringan). */
const SUB_STEP_MS = 45_000, SUB_BEFORE_MS = 15_000, SUB_AFTER_MS = 60_000;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** `narration` = audio cue (role voice): dilewatkan ke rangkaian efek suara narasi. */
interface Voice { key: string; input: string; start: number; end: number; offsetS: number; loop: boolean; volume: number; background: boolean; narration: boolean }

/** Object URL untuk file media lokal (IndexedDB), dibuat sesuai kebutuhan dan dicabut saat unmount. */
function useMediaUrls(ids: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const made = useRef<Record<string, string>>({});
  const key = ids.join('|');
  useEffect(() => {
    let alive = true;
    for (const id of key ? key.split('|') : []) {
      if (made.current[id]) continue;
      made.current[id] = 'loading';
      void loadMedia(id).then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        made.current[id] = url;
        if (alive) setUrls((u) => ({ ...u, [id]: url }));
        else URL.revokeObjectURL(url);
      });
    }
    return () => { alive = false; };
  }, [key]);
  useEffect(() => () => { for (const u of Object.values(made.current)) if (u.startsWith('blob:')) URL.revokeObjectURL(u); }, []);
  return urls;
}

export default function LivePlayer({ project }: { project: SubtitleVideoProject }) {
  const preset = OUTPUT_PRESETS[project.preset];
  const scale = Math.min(1, PREVIEW_LONG_SIDE / Math.max(preset.width, preset.height));
  const W = even(preset.width * scale), H = even(preset.height * scale);
  const job = useMemo(() => {
    try { return buildRenderJob(project, { scale }); } catch { return null; }
  }, [project, scale]);
  const urls = useMediaUrls(job?.mediaIds ?? []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playing = usePlayback((s) => s.playing);
  const timeMs = usePlayback((s) => s.timeMs);
  const { setPlaying, seek } = usePlayback.getState();
  const [subStatus, setSubStatus] = useState<'idle' | 'busy' | 'error'>('idle');
  // Jendela subtitle berpindah per blok 45 dtk posisi putar (tiap blok tercakup penuh + 15 dtk ke belakang).
  const windowBlock = Math.floor(timeMs / SUB_STEP_MS);
  const subWindow = useMemo(() => ({ from_ms: Math.max(0, windowBlock * SUB_STEP_MS - SUB_BEFORE_MS), to_ms: windowBlock * SUB_STEP_MS + SUB_AFTER_MS }), [windowBlock]);

  const duration = job?.spec.output.duration_ms ?? 0;
  const layersRef = useRef<SubtitleLayer[]>([]);

  // ── Subtitle: render ulang (debounce) saat teks/gaya berubah atau posisi keluar jendela.
  const ass = job?.ass ?? '';
  useEffect(() => {
    if (!ass) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSubStatus('busy');
      try {
        const fonts = await loadFonts(fontsForAss(ass));
        const layers = await renderSubtitleLayers(ass, { width: W, height: H, fonts, window: subWindow });
        if (cancelled) { layers.forEach((l) => l.bitmap.close()); return; }
        layersRef.current.forEach((l) => l.bitmap.close());
        layersRef.current = layers;
        setSubStatus('idle');
      } catch {
        if (!cancelled) setSubStatus('error');
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [ass, W, H, subWindow]);
  useEffect(() => () => layersRef.current.forEach((l) => l.bitmap.close()), []);

  // ── Elemen media & suara (dibuat sesuai kebutuhan, dipakai ulang antar frame).
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const images = useRef(new Map<string, HTMLImageElement>());
  const audios = useRef(new Map<string, HTMLAudioElement>());
  const voices = useMemo<Voice[]>(() => {
    if (!job) return [];
    const spec = job.spec, out: Voice[] = [];
    spec.audio_tracks.forEach((a, i) => out.push({
      key: `a${i}:${a.role}:${a.input}`, input: a.input, start: a.start_ms,
      // Narasi bergema: biarkan berbunyi sampai ekor gema selesai (sama dengan render).
      end: (a.end_ms ?? (a.loop ? duration : Number.POSITIVE_INFINITY)) + (a.role === 'voice' ? voiceTailMs(a.fx) : 0),
      offsetS: 0, loop: !!a.loop, volume: a.volume ?? 1, background: a.role === 'background', narration: a.role === 'voice',
    }));
    spec.video_track.forEach((s, i) => {
      if (isColorSegment(s) || !s.keep_audio) return;
      out.push({ key: `k${i}:${s.input}`, input: s.input, start: s.start_ms, end: s.end_ms, offsetS: (s.source_in_ms ?? 0) / 1000, loop: s.underflow === 'loop', volume: 1, background: false, narration: false });
    });
    return out;
  }, [job, duration]);
  const ducking = job?.spec.audio_tracks.find((a) => a.ducking)?.ducking?.level ?? 1;

  // ── Efek suara narasi: audio cue → gain per elemen → bus → rangkaian efek (sama dengan render) → speaker.
  const voiceFx = job?.spec.audio_tracks.find((a) => a.role === 'voice' && a.fx)?.fx;
  const fxKey = hasVoiceFx(voiceFx) ? JSON.stringify(voiceFx) : '';
  const bus = useRef<{ ctx: AudioContext; input: GainNode; chain: VoiceChain | null; fxKey: string } | null>(null);
  const routed = useRef(new Map<string, GainNode>());
  const connectBus = (b: NonNullable<typeof bus.current>, key: string) => {
    b.input.disconnect();
    b.chain?.disconnect();
    b.chain = key ? buildVoiceChain(b.ctx, JSON.parse(key)) : null;
    if (b.chain) { b.input.connect(b.chain.input); b.chain.output.connect(b.ctx.destination); }
    else b.input.connect(b.ctx.destination);
    b.fxKey = key;
  };
  const fxKeyRef = useRef(fxKey);
  useEffect(() => {
    fxKeyRef.current = fxKey;
    if (bus.current && bus.current.fxKey !== fxKey) connectBus(bus.current, fxKey);
  }, [fxKey]);
  useEffect(() => () => { void bus.current?.ctx.close().catch(() => undefined); }, []);

  // Nada & ketebalan tidak bisa real-time lewat node Web Audio → narasi diproses dulu jadi WAV baru (sama dengan
  // render), lalu diputar seperti biasa. Selama diproses, narasi belum berbunyi.
  const pitch = preFxKey(preFxOf(voiceFx));
  const narrationIds = useMemo(() => [...new Set(voices.filter((v) => v.narration).map((v) => v.input))].join('|'), [voices]);
  const [pitched, setPitched] = useState<{ pitch: string; urls: Record<string, string> }>({ pitch: '', urls: {} });
  const pitchedRef = useRef(pitched);
  useEffect(() => {
    if (!pitch) return;
    let alive = true;
    const t = setTimeout(() => void (async () => {
      const next: Record<string, string> = {};
      for (const id of narrationIds ? narrationIds.split('|') : []) {
        const blob = await loadMedia(id);
        if (!alive) break;
        if (!blob) continue;
        const wav = await preprocessedWav(blob, preFxFromKey(pitch)!).catch(() => null);
        if (wav && alive) next[id] = URL.createObjectURL(wav);
        await new Promise((r) => setTimeout(r, 0)); // beri jeda ke UI antar klip
      }
      if (!alive) { Object.values(next).forEach((u) => URL.revokeObjectURL(u)); return; }
      Object.values(pitchedRef.current.urls).forEach((u) => URL.revokeObjectURL(u));
      pitchedRef.current = { pitch, urls: next };
      setPitched(pitchedRef.current);
    })(), 300);
    return () => { alive = false; clearTimeout(t); };
  }, [pitch, narrationIds]);
  useEffect(() => () => Object.values(pitchedRef.current.urls).forEach((u) => URL.revokeObjectURL(u)), []);

  useEffect(() => () => {
    for (const v of videos.current.values()) { v.pause(); v.removeAttribute('src'); v.load(); }
    for (const a of audios.current.values()) { a.pause(); a.removeAttribute('src'); }
  }, []);

  // ── Jam & loop gambar.
  const clock = useRef({ base: 0, at: 0, paused: 0 });
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !job) return;
    const ctx = c.getContext('2d', { alpha: false })!;
    const spec = job.spec;
    const drawFit = createFitDrawer(ctx, W, H, spec.output.background_color);
    const FPS = spec.output.fps;
    const segs = [...spec.video_track].sort((a, b) => a.start_ms - b.start_ms);
    const getVideo = (id: string) => {
      let v = videos.current.get(id);
      if (!v && urls[id]) {
        v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = urls[id]!;
        videos.current.set(id, v);
      }
      return v;
    };
    const getImage = (id: string) => {
      let im = images.current.get(id);
      if (!im && urls[id]) { im = new Image(); im.src = urls[id]!; images.current.set(id, im); }
      return im;
    };
    const srcFor = (v: Voice) => (v.narration && pitch ? (pitched.pitch === pitch ? pitched.urls[v.input] : undefined) : urls[v.input]);
    const elKey = (v: Voice) => `${v.key}|${srcFor(v) ?? ''}`;
    // Elemen yang sumbernya sudah berganti (mis. nada diubah) dihentikan & dilepas.
    const want = new Set(voices.map(elKey));
    for (const [k, a] of audios.current) {
      if (want.has(k)) continue;
      a.pause(); a.removeAttribute('src');
      audios.current.delete(k);
      routed.current.get(k)?.disconnect();
      routed.current.delete(k);
    }
    const getAudio = (v: Voice) => {
      const key = elKey(v), src = srcFor(v);
      let a = audios.current.get(key);
      if (!a && src) {
        a = new Audio(src); a.preload = 'auto'; audios.current.set(key, a);
        if (v.narration) {
          if (!bus.current) {
            const ctx = new AudioContext();
            bus.current = { ctx, input: ctx.createGain(), chain: null, fxKey: '' };
            connectBus(bus.current, fxKeyRef.current);
          }
          const g = bus.current.ctx.createGain();
          bus.current.ctx.createMediaElementSource(a).connect(g).connect(bus.current.input);
          routed.current.set(key, g);
        }
      }
      return a;
    };
    /** Selaraskan <video> dengan waktu sumber yang diharapkan; toleransi lebih longgar saat main. */
    const sync = (v: HTMLVideoElement, seg: MediaSegment, t: number, isPlaying: boolean) => {
      if (!(v.duration > 0)) return;
      const want = sourceTimeFor(seg, t, v.duration, FPS);
      const frozen = want >= v.duration - 1.5 / FPS && seg.underflow !== 'loop';
      if (isPlaying && !frozen) {
        if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
        if (v.paused) void v.play().catch(() => undefined);
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - want) > 0.04 && !v.seeking) v.currentTime = want;
      }
    };
    const drawMedia = (input: string, seg: MediaSegment, t: number, isPlaying: boolean, clear: boolean) => {
      const kind = spec.inputs[input]?.kind;
      if (kind === 'image') {
        const im = getImage(input);
        if (im?.complete && im.naturalWidth) drawFit(im, im.naturalWidth, im.naturalHeight, seg.fit, clear);
        return;
      }
      const v = getVideo(input);
      if (!v) return;
      sync(v, seg, t, isPlaying);
      if (v.readyState >= 2) drawFit(v, v.videoWidth, v.videoHeight, seg.fit, clear);
    };

    let raf = 0, lastReport = 0;
    const loop = () => {
      const now = performance.now();
      const pb = usePlayback.getState();
      const sk = pb.consumeSeek();
      const k = clock.current;
      if (sk !== null) { k.paused = sk; k.base = sk; k.at = now; }
      let t = pb.playing ? k.base + (now - k.at) : k.paused;
      if (t >= duration) { t = duration; if (pb.playing) { pb.setPlaying(false); } }
      if (!pb.playing) k.paused = t;

      // a. latar / warna
      const usedVideos = new Set<string>();
      ctx.fillStyle = spec.output.background_color;
      ctx.fillRect(0, 0, W, H);
      if (spec.background) {
        const bgSeg: MediaSegment = { input: spec.background.input, start_ms: 0, end_ms: duration, fit: spec.background.fit ?? 'cover', underflow: 'loop' };
        drawMedia(spec.background.input, bgSeg, t, pb.playing, true);
        usedVideos.add(spec.background.input);
      }
      // b. segmen aktif
      const seg = segs.find((s) => t >= s.start_ms && t < s.end_ms) ?? (t >= duration && segs.length ? segs[segs.length - 1] : undefined);
      if (seg) {
        if (isColorSegment(seg)) { ctx.fillStyle = seg.color; ctx.fillRect(0, 0, W, H); }
        else { drawMedia(seg.input, seg, t, pb.playing, !spec.background); usedVideos.add(seg.input); }
      }
      for (const [id, v] of videos.current) if (!usedVideos.has(id) && !v.paused) v.pause();
      // c. subtitle
      const layer = layersRef.current.find((l) => t >= l.start_ms && t < l.end_ms);
      if (layer) ctx.drawImage(layer.bitmap, 0, 0, W, H);

      // d. suara (ducking sederhana: latar diturunkan saat ada suara cue/klip)
      const voiceActive = voices.some((v) => !v.background && t >= v.start && t < v.end);
      for (const v of voices) {
        const a = getAudio(v);
        if (!a) continue;
        const active = pb.playing && t >= v.start && t < v.end;
        if (!active) { if (!a.paused) a.pause(); continue; }
        let local = (t - v.start) / 1000 + v.offsetS;
        if (v.loop && a.duration > 0) local %= a.duration;
        else if (a.duration > 0 && local >= a.duration) { if (!a.paused) a.pause(); continue; }
        const g = routed.current.get(elKey(v));
        if (g) { a.volume = 1; if (g.gain.value !== v.volume) g.gain.value = v.volume; }
        else a.volume = Math.max(0, Math.min(1, v.volume * (v.background && voiceActive ? ducking : 1)));
        if (a.paused) { a.currentTime = local; void a.play().catch(() => undefined); }
        else if (Math.abs(a.currentTime - local) > 0.3) a.currentTime = local;
      }

      if (now - lastReport > 100) { lastReport = now; pb.report(t); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [job, urls, voices, ducking, W, H, duration, pitch, pitched]);

  // Mulai/jeda: jangkar jam di posisi sekarang.
  useEffect(() => {
    const k = clock.current;
    if (playing) { k.base = k.paused; k.at = performance.now(); void bus.current?.ctx.resume().catch(() => undefined); }
    else for (const a of audios.current.values()) a.pause();
  }, [playing]);

  const togglePlay = () => {
    if (!playing && clock.current.paused >= duration - 50) seek(0);
    setPlaying(!playing);
  };

  if (!job) return <div className={styles.playerEmpty}>Belum ada cue untuk dipratinjau.</div>;
  return (
    <div className={styles.player}>
      <div className={styles.stage} style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, calc(64vh * ${W} / ${H}))` }}>
        <canvas ref={canvasRef} width={W} height={H} className={styles.canvas} data-role="live-preview" onClick={togglePlay} />
        {!playing && (
          <button className={styles.bigPlay} onClick={togglePlay} aria-label="Putar pratinjau">
            <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
          </button>
        )}
        {subStatus === 'busy' && <span className={styles.stageBadge}>Menyiapkan subtitle…</span>}
        {subStatus === 'error' && <span className={`${styles.stageBadge} ${styles.stageBadgeErr}`}>Subtitle gagal dimuat</span>}
      </div>
      <div className={styles.controls}>
        <button className="vk-btn vk-btn-ghost" onClick={togglePlay} aria-label={playing ? 'Jeda' : 'Putar'} data-role="play-toggle">
          {playing ? '❚❚' : '▶'}
        </button>
        <input type="range" className={styles.scrub} min={0} max={Math.max(1, duration)} step={10} value={Math.min(timeMs, duration)}
          aria-label="Posisi pratinjau" onChange={(e) => seek(+e.target.value)} />
        <span className={styles.time}>{formatTime(timeMs)} / {formatTime(duration)}</span>
      </div>
    </div>
  );
}
