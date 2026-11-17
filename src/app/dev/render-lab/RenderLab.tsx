'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  detectRenderCapabilities, makeImageWorkingCopy, makeVideoWorkingCopy, renderVideo, RenderError,
} from '@/core/render';
import type { RenderCapabilities, RenderProgress, RenderResult, RenderSpecV1 } from '@/core/render';
import styles from './render-lab.module.css';

const SAMPLE_BASE = '/dev-samples/';
const STAGE_LABEL: Record<RenderProgress['stage'], string> = {
  preparing: 'Menyiapkan', subtitles: 'Merender subtitle', audio: 'Mencampur audio',
  video: 'Merender video', finalizing: 'Menyelesaikan file', done: 'Selesai',
};

// Endpoint ini hanya ada di server e2e (scripts/e2e-render.mjs); di tempat lain diabaikan.
const e2ePost = (path: string, body: BodyInit, type: string) =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': type }, body }).catch(() => undefined);

export default function RenderLab() {
  const [spec, setSpec] = useState<RenderSpecV1 | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [caps, setCaps] = useState<RenderCapabilities | null>(null);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [wcInfo, setWcInfo] = useState<string | null>(null);
  const [wcResult, setWcResult] = useState<{ url: string; name: string; isImage: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);

  const [checkStep, setCheckStep] = useState('Memuat sampel…');
  const [diag, setDiag] = useState<Array<{ t: string; bad: boolean }>>([]);
  const [encoderProbe, setEncoderProbe] = useState<string[] | null>(null);

  // Uji encoder H.264 di beberapa ukuran & mode (hardware/software) — Android sering menolak portrait 1080×1920.
  const probeEncoders = useCallback(async () => {
    const out: string[] = [];
    if (typeof VideoEncoder === 'undefined') { setEncoderProbe(['VideoEncoder tidak ada di browser ini']); return; }
    const sizes: Array<[number, number]> = [[1080, 1920], [1920, 1080], [720, 1280], [1280, 720], [1080, 1080]];
    const codecs = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'];
    for (const [w, h] of sizes) {
      const ok: string[] = [];
      for (const codec of codecs) {
        for (const hw of ['prefer-hardware', 'prefer-software', 'no-preference'] as const) {
          try {
            const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 8_000_000, framerate: 30, hardwareAcceleration: hw });
            if (r.supported) ok.push(`${codec.slice(5, 7) === '64' ? 'High' : codec.slice(5, 7) === '4d' ? 'Main' : 'Baseline'}/${hw.replace('prefer-', '').replace('no-preference', 'auto')}`);
          } catch (e) { ok.push(`error: ${String(e)}`); }
        }
      }
      out.push(`${w}×${h}: ${ok.length ? '✅ ' + [...new Set(ok)].join(', ') : '❌ tidak didukung'}`);
    }
    if (typeof AudioEncoder !== 'undefined') {
      for (const codec of ['mp4a.40.2', 'opus']) {
        const r = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000 }).catch(() => ({ supported: false }));
        out.push(`Audio ${codec === 'opus' ? 'Opus' : 'AAC'}: ${r.supported ? '✅' : '❌'}`);
      }
    } else out.push('AudioEncoder tidak ada');
    setEncoderProbe(out);
  }, []);

  useEffect(() => {
    type DiagWindow = Window & { __vkDiag?: Array<{ t: string; bad: boolean }>; __vkDiagRender?: () => void };
    const w = window as DiagWindow;
    const sync = () => setDiag([...(w.__vkDiag ?? [])]);
    w.__vkDiagRender = sync;
    sync();
    return () => { w.__vkDiagRender = undefined; };
  }, []);

  useEffect(() => {
    const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} tidak merespons setelah ${ms / 1000} detik`)), ms))]);
    (async () => {
      let s: RenderSpecV1;
      try {
        const r = await withTimeout(fetch(`${SAMPLE_BASE}spec.json`), 10_000, 'Memuat sampel');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        s = (await r.json()) as RenderSpecV1;
        setSpec(s);
      } catch (e) {
        setSpecError(`Sampel gagal dimuat (${String(e)}). Jalankan: npm run samples`);
        setCheckStep('');
        return;
      }
      try {
        setCheckStep('Memeriksa encoder video & audio…');
        setCaps(await withTimeout(detectRenderCapabilities(s.output), 10_000, 'Pemeriksaan encoder'));
        setCheckStep('');
      } catch (e) {
        setSpecError(String(e instanceof Error ? e.message : e));
        setCheckStep('');
      }
    })();
  }, []);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (wcResult) URL.revokeObjectURL(wcResult.url); }, [wcResult]);

  const start = useCallback(async () => {
    if (!spec) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setResult(null); setError(null); setProgress(null);
    const sources = Object.fromEntries(Object.entries(spec.inputs).map(([k, v]) => [k, v.url ?? `${SAMPLE_BASE}${k}`]));
    const auto = new URLSearchParams(location.search).has('auto');
    try {
      const forced = new URLSearchParams(location.search).get('storage');
      const r = await renderVideo(spec, sources, { onProgress: setProgress, signal: ac.signal, storage: forced === 'memory' ? 'memory' : undefined });
      setResult(r);
      setVideoUrl(URL.createObjectURL(r.file));
      if (auto) {
        await e2ePost('/__e2e/upload', r.file, 'video/mp4');
        await e2ePost('/__e2e/report', JSON.stringify({ ok: true, stats: r.stats, userAgent: navigator.userAgent, crossOriginIsolated, jsHeapMB: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ? Math.round((performance as Performance & { memory?: { usedJSHeapSize: number } }).memory!.usedJSHeapSize / 1e6) : null }), 'application/json');
      }
    } catch (e) {
      const lines = e instanceof RenderError ? [e.message, ...(e.details ?? [])] : [e instanceof Error ? `${e.name}: ${e.message}` : String(e)];
      setError(lines);
      if (auto) await e2ePost('/__e2e/report', JSON.stringify({ ok: false, error: lines }), 'application/json');
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [spec]);

  useEffect(() => {
    if (spec && caps && !autoStarted.current && new URLSearchParams(location.search).has('auto')) {
      autoStarted.current = true;
      void start();
    }
  }, [spec, caps, start]);

  const onWorkingCopy = async (file: File | undefined) => {
    if (!file || !spec) return;
    setWcInfo('Memproses…');
    setWcResult(null);
    const maxLongEdge = Math.max(spec.output.width, spec.output.height);
    try {
      const t0 = performance.now();
      const r = file.type.startsWith('image/')
        ? await makeImageWorkingCopy(file, { maxLongEdge })
        : await makeVideoWorkingCopy(file, { maxLongEdge, fps: spec.output.fps }, (p) => setWcInfo(`Memproses… ${Math.round(p * 100)}%`));
      setWcInfo(`${(file.size / 1e6).toFixed(1)} MB → ${(r.blob.size / 1e6).toFixed(1)} MB, ${r.width}×${r.height}, ${((performance.now() - t0) / 1000).toFixed(1)} dtk`);
      const isImage = r.blob.type.startsWith('image/');
      const base = file.name.replace(/\.[^.]+$/, '');
      setWcResult({ url: URL.createObjectURL(r.blob), name: `${base}-salinan-kerja.${isImage ? 'webp' : 'mp4'}`, isImage });
    } catch (e) {
      setWcInfo(`Gagal: ${String(e)}`);
    }
  };

  return (
    <main className="vk-container">
      {diag.length > 0 && (
        <section className={`vk-card ${styles.diag}`} aria-label="Diagnostik browser">
          {diag.map((d, i) => <div key={i} className={d.bad ? 'vk-danger' : undefined}>{d.t}</div>)}
        </section>
      )}
      <h1 className={styles.title}>Render Lab</h1>
      <p className="vk-muted">Uji executor browser (WebCodecs + JASSUB) memakai sampel <code>public/dev-samples</code>. Halaman internal.</p>

      <section className={`vk-card ${styles.section}`}>
        <h2 className={styles.h2}>Kemampuan perangkat</h2>
        {checkStep && <p className="vk-muted">{checkStep}</p>}
        {specError && <p className="vk-danger">{specError}</p>}
        {caps && (
          <ul className={styles.list}>
            <li>Bisa render: <strong>{caps.canRender ? 'ya' : 'tidak'}</strong></li>
            <li>Codec audio: {caps.audioCodec ?? '—'}</li>
            <li>Multi-thread subtitle (cross-origin isolated): {caps.crossOriginIsolated ? 'ya' : 'tidak'}</li>
            <li>Penyimpanan hasil: {caps.opfs ? 'OPFS (bertahap)' : 'memori'} · maks. {caps.maxDurationMs / 60_000} menit</li>
            <li>Koneksi aman (HTTPS): {typeof window !== 'undefined' && window.isSecureContext ? 'ya' : 'tidak'}</li>
            <li className="vk-muted">Browser: {typeof navigator !== 'undefined' ? navigator.userAgent : '—'}</li>
            {caps.reasons.map((r) => <li key={r} className="vk-danger">{r}</li>)}
            {caps.warnings.map((w) => <li key={w} className="vk-muted">⚠️ {w}</li>)}
          </ul>
        )}
        <div className={styles.actions}>
          <button className="vk-btn vk-btn-ghost" onClick={() => void probeEncoders()}>Uji encoder rinci</button>
        </div>
        {encoderProbe && <ul className={styles.list}>{encoderProbe.map((l) => <li key={l}>{l}</li>)}</ul>}
      </section>

      <section className={`vk-card ${styles.section}`}>
        <h2 className={styles.h2}>Render sampel</h2>
        {spec && <p className="vk-muted">{spec.output.width}×{spec.output.height}, {spec.output.fps} fps, {(spec.output.duration_ms / 1000).toFixed(1)} detik, {spec.video_track.length} segmen</p>}
        <div className={styles.actions}>
          <button className="vk-btn" disabled={!spec || !caps?.canRender || busy} onClick={() => void start()}>Mulai render</button>
          <button className="vk-btn vk-btn-ghost" disabled={!busy} onClick={() => abortRef.current?.abort()}>Batalkan</button>
        </div>
        {progress && (
          <div className={styles.progressBlock}>
            <div className="vk-progress"><span style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div>
            <p className="vk-muted">
              {STAGE_LABEL[progress.stage]} {progress.totalFrames ? `· frame ${progress.frame}/${progress.totalFrames}` : ''}
            </p>
          </div>
        )}
        {error && <div className="vk-danger">{error.map((l) => <p key={l}>{l}</p>)}</div>}
        {result && videoUrl && (
          <div className={styles.result}>
            <video className={styles.video} src={videoUrl} controls playsInline />
            <ul className={styles.list}>
              <li>Total {(result.stats.totalMs / 1000).toFixed(1)} dtk ({result.stats.realtimeFactor.toFixed(2)}× realtime)</li>
              <li>Video {(result.stats.videoMs / 1000).toFixed(1)} dtk · audio {(result.stats.audioMs / 1000).toFixed(1)} dtk ({result.stats.audioCodec})</li>
              <li>Ukuran {(result.stats.bytes / 1e6).toFixed(1)} MB (ditulis bertahap ke OPFS)</li>
            </ul>
            <a className="vk-btn" href={videoUrl} download="videokit-render.mp4">Unduh MP4</a>
          </div>
        )}
      </section>

      <section className={`vk-card ${styles.section}`}>
        <h2 className={styles.h2}>Salinan kerja (D5)</h2>
        <p className="vk-muted">Pilih video/gambar untuk diperkecil ke ukuran output sebelum upload.</p>
        <input type="file" accept="video/*,image/*" onChange={(e) => void onWorkingCopy(e.target.files?.[0])} />
        {wcInfo && <p>{wcInfo}</p>}
        {wcResult && (
          <div className={styles.result}>
            {wcResult.isImage
              // Blob URL lokal: next/image tidak berlaku (tidak ada optimasi untuk objek blob).
              // eslint-disable-next-line @next/next/no-img-element
              ? <img className={styles.video} src={wcResult.url} alt="Hasil salinan kerja" />
              : <video className={styles.video} src={wcResult.url} controls playsInline />}
            <div>
              <a className="vk-btn" href={wcResult.url} download={wcResult.name}>Unduh salinan kerja</a>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
