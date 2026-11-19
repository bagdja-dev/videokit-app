'use client';

// Perekam mikrofon bersama (rekam narasi per cue & rekam sampel di Suara narasi). Hasil = WAV mono (durasi pasti).
import { useEffect, useRef, useState } from 'react';
import { encodeWav, mixToMono } from '@/core/audio/wav';
import { usePlayback } from './playback';

const CLEANUP_KEY = 'vk.mic.browserCleanup';

/**
 * Peredam bising + penyetara volume bawaan browser. Membantu di ruangan bising, tapi pada sebagian suara/perangkat
 * membuat suara terdengar "robot" atau naik-turun — karena itu bisa dimatikan. Preferensi per perangkat.
 */
export function getMicCleanup(): boolean {
  try { return localStorage.getItem(CLEANUP_KEY) !== '0'; } catch { return true; }
}
export function setMicCleanup(on: boolean) {
  try { localStorage.setItem(CLEANUP_KEY, on ? '1' : '0'); } catch { /* penyimpanan tidak tersedia */ }
}

export type RecState = 'idle' | 'starting' | 'recording' | 'processing';
export interface Recording { wav: ArrayBuffer; durationMs: number }

interface Session {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  ctx: AudioContext;
  raf: number;
  startedAt: number;
  cancelled: boolean;
}

function stopSession(s: Session) {
  cancelAnimationFrame(s.raf);
  s.stream.getTracks().forEach((t) => t.stop());
  void s.ctx.close().catch(() => undefined);
}

/** Rekaman mentah (WebM/MP4 dari MediaRecorder) → WAV mono. */
async function toWav(blob: Blob): Promise<Recording> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    return { wav: encodeWav(mixToMono(channels), audio.sampleRate), durationMs: Math.round(audio.duration * 1000) };
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

export function micSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

/**
 * Rekam dari mikrofon. `onDone` dipanggil dengan WAV; rekaman dibatalkan (mikrofon dimatikan, hasil dibuang)
 * bila komponen dilepas. `clipped` = suara sempat terlalu keras (pecah) selama rekaman.
 */
export function useMicRecorder({ onDone, maxMs = 10 * 60_000 }: { onDone: (r: Recording) => Promise<void> | void; maxMs?: number }) {
  const [state, setState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [clipped, setClipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);

  useEffect(() => () => {
    const s = session.current;
    if (s) { s.cancelled = true; if (s.recorder.state !== 'inactive') s.recorder.stop(); stopSession(s); }
  }, []);

  const finish = async (s: Session) => {
    stopSession(s);
    session.current = null;
    if (s.cancelled) return;
    setState('processing');
    try {
      const raw = new Blob(s.chunks, { type: s.recorder.mimeType || 'audio/webm' });
      if (raw.size === 0) throw new Error('Rekaman kosong');
      const rec = await toWav(raw);
      if (rec.durationMs < 200) throw new Error('Rekaman terlalu pendek');
      await done.current(rec);
    } catch (e) {
      setError(`Rekaman gagal diproses: ${e instanceof Error ? e.message : String(e)}`);
    }
    setState('idle');
  };

  const start = async () => {
    setError(null);
    setClipped(false);
    setState('starting');
    usePlayback.getState().setPlaying(false); // hindari suara pratinjau ikut terekam
    const cleanup = getMicCleanup();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: cleanup, noiseSuppression: cleanup, autoGainControl: cleanup } });
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied ? 'Akses mikrofon ditolak. Izinkan mikrofon untuk situs ini di pengaturan browser.' : 'Mikrofon tidak ditemukan atau sedang dipakai aplikasi lain.');
      setState('idle');
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const s: Session = { stream, recorder, chunks: [], ctx, raf: 0, startedAt: performance.now(), cancelled: false };
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]!));
      setLevel(peak);
      if (peak >= 0.98) setClipped(true);
      const ms = performance.now() - s.startedAt;
      setElapsed(ms);
      if (ms >= maxMs && recorder.state === 'recording') recorder.stop();
      s.raf = requestAnimationFrame(tick);
    };
    recorder.ondataavailable = (ev) => { if (ev.data.size) s.chunks.push(ev.data); };
    recorder.onstop = () => { void finish(s); };
    session.current = s;
    recorder.start(250);
    s.startedAt = performance.now();
    s.raf = requestAnimationFrame(tick);
    setElapsed(0);
    setState('recording');
  };

  const stop = () => { const s = session.current; if (s && s.recorder.state !== 'inactive') s.recorder.stop(); };

  return { state, elapsed, level, clipped, error, start, stop };
}
