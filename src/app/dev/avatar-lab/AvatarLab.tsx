'use client';

// Avatar Lab — PoC Fase A0 (plan/videokit/avatar-record/execution-plan.md): kamera → pelacakan wajah → avatar VRM
// langsung, rekam motion track + mic sambil video konten diputar, uji determinisme, render MP4 lewat executor.
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarScene, type AvatarInfo } from '@/core/avatar/avatar-scene';
import { MotionRecorder, parseMotionTrack, sampleMotion } from '@/core/avatar/motion-track';
import { mapToPose, NO_CALIBRATION, PoseSmoother, quatToEulerYXZ, type Calibration } from '@/core/avatar/rig';
import { syntheticMotion } from '@/core/avatar/synthetic';
import { BLENDSHAPE_NAMES, FaceTracker, type TrackSample } from '@/core/avatar/tracker';
import { renderVideo, type RenderProgress, type RenderSpecV1 } from '@/core/render';
import styles from './avatar-lab.module.css';

const SAMPLE_VRM = '/dev-samples/avatar/Seed-san.vrm';
const SAMPLE_CONTENT = '/dev-samples/clip_land.mp4';
const SAMPLE_VOICE = '/dev-samples/vo1.m4a';
const IDX: Record<string, number> = Object.fromEntries(BLENDSHAPE_NAMES.map((n, i) => [n, i]));
const PRESETS = { '16x9': { width: 1920, height: 1080, avatarWidth: 0.26 }, '9x16': { width: 1080, height: 1920, avatarWidth: 0.55 } } as const;
type Preset = keyof typeof PRESETS;

interface Take { motion: Uint8Array; audio: Blob | null; durationMs: number; synthetic: boolean; samples: number }

const e2ePost = (path: string, body: BodyInit, type: string) =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': type }, body }).catch(() => undefined);

const getterFor = (s: TrackSample) => (name: string): number => {
  switch (name) {
    case 'found': return s.found ? 1 : 0;
    case 'head_qx': return s.quat[0];
    case 'head_qy': return s.quat[1];
    case 'head_qz': return s.quat[2];
    case 'head_qw': return s.quat[3];
    default: { const i = IDX[name]; return i === undefined ? 0 : s.blend[i]!; }
  }
};

async function hasAudioTrack(blob: Blob): Promise<boolean> {
  try { return !!(await new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }).getPrimaryAudioTrack()); } catch { return false; }
}

function runHashWorker(payload: object): Promise<{ ok: boolean; hashes?: string[]; loadMs?: number; msPerFrame?: number; opaqueFrac?: number; error?: string }> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./avatar-hash.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { resolve(e.data); w.terminate(); };
    w.onerror = (e) => { resolve({ ok: false, error: e.message }); w.terminate(); };
    w.postMessage(payload);
  });
}

export default function AvatarLab() {
  const previewRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef<HTMLVideoElement>(null);
  const contentRef = useRef<HTMLVideoElement>(null);
  const sceneRef = useRef<AvatarScene | null>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latest = useRef<TrackSample | null>(null);
  const calib = useRef<Calibration>(NO_CALIBRATION);
  const rec = useRef<{ motion: MotionRecorder; media: MediaRecorder | null; chunks: Blob[]; start: number } | null>(null);
  const stats = useRef({ track: 0, render: 0, trackMs: 0 });

  const [vrm, setVrm] = useState<{ bytes: ArrayBuffer; name: string; info: AvatarInfo } | null>(null);
  const [content, setContent] = useState<{ blob: Blob; name: string; url: string } | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [delegate, setDelegate] = useState<string | null>(null);
  const [fps, setFps] = useState({ track: 0, render: 0, trackMs: 0 });
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [preset, setPreset] = useState<Preset>('16x9');
  const [mirror, setMirror] = useState(true);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [result, setResult] = useState<{ url: string; text: string } | null>(null);
  const [det, setDet] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const autoStarted = useRef(false);
  const say = useCallback((m: string) => setLog((l) => [...l.slice(-30), `${new Date().toLocaleTimeString()} ${m}`]), []);

  // --- avatar & konten contoh
  const loadVrm = useCallback(async (bytes: ArrayBuffer, name: string) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const t0 = performance.now();
    const info = await scene.load(bytes.slice(0));
    setVrm({ bytes, name, info });
    say(`Avatar "${info.name}" (VRM ${info.vrmVersion}) dimuat ${Math.round(performance.now() - t0)} ms${info.missingExpressions.length ? ` — ekspresi tidak ada: ${info.missingExpressions.join(', ')}` : ''}`);
  }, [say]);

  useEffect(() => {
    const c = previewRef.current!;
    sceneRef.current = new AvatarScene(c, { width: c.width, height: c.height, background: '#1f3b3b', framing: 'bust' });
    (async () => {
      try {
        await loadVrm(await (await fetch(SAMPLE_VRM)).arrayBuffer(), 'Seed-san.vrm');
        const blob = await (await fetch(SAMPLE_CONTENT)).blob();
        setContent({ blob, name: 'clip_land.mp4 (contoh)', url: URL.createObjectURL(blob) });
      } catch (e) { say(`Gagal memuat contoh: ${String(e)}`); }
    })();
    return () => { sceneRef.current?.dispose(); sceneRef.current = null; };
  }, [loadVrm, say]);

  // --- loop pratinjau: pelacakan (bila kamera) → rig → avatar
  useEffect(() => {
    let raf = 0, lastVideoTime = -1, last = performance.now(), windowStart = last;
    const smoother = new PoseSmoother();
    // Pratinjau tanpa kamera: putar gerakan sintetis agar avatar terlihat hidup.
    const synthTrack = parseMotionTrack(syntheticMotion(60_000));
    const synthBuf = new Float32Array(synthTrack.header.channels.length);
    const loop = () => {
      const now = performance.now();
      const scene = sceneRef.current;
      const v = camRef.current;
      if (camOn && trackerRef.current && v && v.readyState >= 2 && v.currentTime !== lastVideoTime) {
        lastVideoTime = v.currentTime;
        const t0 = performance.now();
        const s = trackerRef.current.detect(v, now);
        stats.current.trackMs += performance.now() - t0;
        stats.current.track++;
        latest.current = s;
        const r = rec.current;
        if (r) r.motion.push(now - r.start, s.found, s.quat, s.blend);
      }
      if (scene?.loaded) {
        let get: (n: string) => number;
        if (camOn && latest.current) get = getterFor(latest.current);
        else {
          sampleMotion(synthTrack, now % 60_000, synthBuf);
          get = (n) => { const k = synthTrack.index[n]; return k === undefined ? 0 : synthBuf[k]!; };
        }
        const pose = smoother.step(mapToPose(get, calib.current, { mirror }), now);
        scene.applyPose(pose, now);
        scene.step(Math.min(0.1, (now - last) / 1000));
        stats.current.render++;
      }
      last = now;
      if (now - windowStart >= 1000) {
        const s = stats.current;
        setFps({ track: s.track, render: s.render, trackMs: s.track ? s.trackMs / s.track : 0 });
        stats.current = { track: 0, render: 0, trackMs: 0 };
        windowStart = now;
        if (rec.current) setRecMs(now - rec.current.start);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [camOn, mirror]);

  // --- kamera
  const startCamera = async () => {
    try {
      setBusy(true);
      if (!trackerRef.current) {
        const t0 = performance.now();
        trackerRef.current = await FaceTracker.create();
        setDelegate(trackerRef.current.delegate);
        say(`Face Landmarker siap (${trackerRef.current.delegate}) dalam ${Math.round(performance.now() - t0)} ms`);
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      camRef.current!.srcObject = stream;
      await camRef.current!.play();
      setCamOn(true);
      say('Kamera & mikrofon aktif');
    } catch (e) {
      say(`Kamera gagal: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    } finally { setBusy(false); }
  };
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
    latest.current = null;
  };
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); trackerRef.current?.close(); }, []);

  const calibrate = () => {
    const s = latest.current;
    if (!s?.found) return say('Kalibrasi gagal: wajah tidak terlihat');
    const rest: Record<string, number> = {};
    for (const n of BLENDSHAPE_NAMES) if (/^(jaw|mouth|brow)/.test(n)) rest[n] = s.blend[IDX[n]!]!;
    calib.current = { head: quatToEulerYXZ(...s.quat), rest };
    say('Kalibrasi pose netral tersimpan');
  };

  // --- rekam
  const startRecording = async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const media = new MediaRecorder(new MediaStream(stream.getAudioTracks()), mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    media.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const cv = contentRef.current;
    if (cv) { cv.currentTime = 0; await cv.play().catch(() => undefined); }
    media.start(1000);
    rec.current = { motion: new MotionRecorder([...BLENDSHAPE_NAMES]), media, chunks, start: performance.now() };
    setRecording(true); setTake(null); setResult(null);
    say(`Merekam (audio ${media.mimeType || 'default'})`);
  };
  const stopRecording = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    contentRef.current?.pause();
    const durationMs = performance.now() - r.start;
    const audio = await new Promise<Blob | null>((resolve) => {
      if (!r.media) return resolve(null);
      r.media.onstop = () => resolve(new Blob(r.chunks, { type: r.media!.mimeType }));
      r.media.stop();
    });
    setRecording(false);
    setTake({ motion: r.motion.toBytes(), audio, durationMs, synthetic: false, samples: r.motion.count });
    say(`Rekaman selesai: ${(durationMs / 1000).toFixed(1)} dtk, ${r.motion.count} sampel gerak (${(r.motion.count / (durationMs / 1000)).toFixed(1)} Hz), audio ${audio ? `${(audio.size / 1024).toFixed(0)} KB` : '—'}`);
  };
  const loadSyntheticTake = async (seconds = 10) => {
    const voice = await (await fetch(SAMPLE_VOICE)).blob();
    const motion = syntheticMotion(seconds * 1000);
    setTake({ motion, audio: voice, durationMs: seconds * 1000, synthetic: true, samples: seconds * 30 + 1 });
    say(`Rekaman sintetis ${seconds} dtk (tanpa kamera)`);
  };

  // --- determinisme & render
  const overlayFor = useCallback((durationMs: number) => ({
    type: 'avatar' as const, input: 'avatar', motion: 'motion', start_ms: 0, end_ms: durationMs,
    placement: { anchor: 'bottom-right' as const, width: PRESETS[preset].avatarWidth, aspect: 3 / 4 },
    framing: 'bust' as const, mirror, calibration: calib.current,
  }), [preset, mirror]);

  const testDeterminism = useCallback(async (t: Take): Promise<{ ok: boolean; text: string }> => {
    if (!vrm) return { ok: false, text: 'Avatar belum dimuat' };
    const p = PRESETS[preset];
    const payload = () => ({ overlay: overlayFor(Math.min(3000, t.durationMs)), vrm: vrm.bytes.slice(0), motion: t.motion.slice().buffer, W: p.width, H: p.height, fps: 30, frames: 90 });
    const [a, b] = await Promise.all([runHashWorker(payload()), runHashWorker(payload())]);
    if (!a.ok || !b.ok) return { ok: false, text: `Worker gagal: ${a.error ?? b.error}` };
    const diff = a.hashes!.filter((h, i) => h !== b.hashes![i]).length;
    const uniq = new Set(a.hashes).size;
    const text = `${diff === 0 ? 'IDENTIK' : `BERBEDA ${diff}/90 frame`} · ${uniq} frame unik (avatar bergerak) · isi avatar ${(a.opaqueFrac! * 100).toFixed(0)}% kotak · muat ${Math.round(a.loadMs!)} ms · ${a.msPerFrame!.toFixed(1)} ms/frame avatar di worker`;
    return { ok: diff === 0 && uniq > 10 && a.opaqueFrac! > 0.05, text };
  }, [vrm, preset, overlayFor]);

  const render = useCallback(async (t: Take, auto = false) => {
    if (!vrm || !content) return;
    setBusy(true); setProgress(null); setResult(null);
    try {
      const p = PRESETS[preset];
      const duration = Math.round(t.durationMs);
      const contentAudio = await hasAudioTrack(content.blob);
      const spec: RenderSpecV1 = {
        spec_version: 1,
        output: { width: p.width, height: p.height, fps: 30, duration_ms: duration, background_color: '#000000' },
        inputs: { content: { kind: 'video' }, avatar: { kind: 'avatar' }, motion: { kind: 'motion' }, ...(t.audio ? { mic: { kind: 'audio' as const } } : {}) },
        video_track: [{ input: 'content', start_ms: 0, end_ms: duration, fit: preset === '16x9' ? 'contain' : 'blur', underflow: 'loop' }],
        audio_tracks: [
          ...(t.audio ? [{ input: 'mic', role: 'voice' as const, start_ms: 0, volume: 1 }] : []),
          ...(contentAudio ? [{ input: 'content', role: 'background' as const, start_ms: 0, loop: true, volume: 0.5, ducking: { level: 0.6, attack_ms: 200, release_ms: 400 } }] : []),
        ],
        overlays: [overlayFor(duration)],
      };
      const sources = { content: content.blob, avatar: new Blob([vrm.bytes]), motion: new Blob([t.motion.slice()]), ...(t.audio ? { mic: t.audio } : {}) };
      const r = await renderVideo(spec, sources, { onProgress: setProgress, fileName: `avatar-${Date.now()}.mp4` });
      const text = `${(duration / 1000).toFixed(1)} dtk video dirender dalam ${(r.stats.totalMs / 1000).toFixed(1)} dtk (${r.stats.realtimeFactor.toFixed(2)}× realtime) · ${(r.stats.bytes / 1e6).toFixed(1)} MB`;
      setResult({ url: URL.createObjectURL(r.file), text });
      say(`Render selesai: ${text}`);
      if (auto) await e2ePost('/__e2e/upload', r.file, 'video/mp4');
      return r;
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      say(`Render gagal: ${msg}`);
      if (auto) throw e;
    } finally { setBusy(false); setProgress(null); }
  }, [vrm, content, preset, overlayFor, say]);

  // --- mode otomatis (E2E headless): rekaman sintetis → determinisme → render → lapor
  useEffect(() => {
    if (autoStarted.current || !vrm || !content || !new URLSearchParams(location.search).has('auto')) return;
    autoStarted.current = true;
    (async () => {
      const report: Record<string, unknown> = { userAgent: navigator.userAgent, crossOriginIsolated };
      try {
        try {
          const t0 = performance.now();
          const tr = await FaceTracker.create();
          report.tracker = { ok: true, delegate: tr.delegate, loadMs: Math.round(performance.now() - t0) };
          tr.close();
        } catch (e) { report.tracker = { ok: false, error: String(e) }; }
        const voice = await (await fetch(SAMPLE_VOICE)).blob();
        const t: Take = { motion: syntheticMotion(10_000), audio: voice, durationMs: 10_000, synthetic: true, samples: 301 };
        const d = await testDeterminism(t);
        report.determinism = d;
        const r = await render(t, true);
        report.render = r?.stats;
        report.ok = d.ok && !!r;
      } catch (e) {
        report.ok = false;
        report.error = e instanceof Error ? e.message : String(e);
      }
      await e2ePost('/__e2e/report', JSON.stringify(report), 'application/json');
    })();
  }, [vrm, content, testDeterminism, render]);

  const pct = progress ? Math.round(progress.progress * 100) : 0;
  return (
    <main className="vk-container">
      <h1 className={styles.title}>Avatar Lab</h1>
      <p className="vk-muted">PoC Fase A0 — pelacakan wajah di browser → avatar VRM, rekam gerakan + suara, render MP4. Gambar kamera tidak disimpan atau dikirim.</p>

      <div className={styles.grid}>
        <section className={`vk-card ${styles.stage}`}>
          <canvas ref={previewRef} width={480} height={640} className={styles.preview} aria-label="Pratinjau avatar" />
          <video ref={camRef} className={styles.cam} muted playsInline hidden={!camOn} />
          <div className={styles.badges}>
            <span>Lacak {fps.track} fps{fps.track ? ` · ${fps.trackMs.toFixed(1)} ms` : ''}</span>
            <span>Avatar {fps.render} fps</span>
            {delegate && <span>{delegate}</span>}
            {!camOn && <span>Gerak sintetis</span>}
          </div>
        </section>

        <div className={styles.side}>
          <section className="vk-card">
            <h2 className={styles.h2}>1. Avatar</h2>
            {vrm ? (
              <ul className={styles.list}>
                <li><strong>{vrm.info.name}</strong> {vrm.info.authors && `· ${vrm.info.authors}`} · VRM {vrm.info.vrmVersion}</li>
                <li>Komersial: {vrm.info.commercialUse === 'allowed' ? 'boleh' : vrm.info.commercialUse === 'not-allowed' ? 'TIDAK boleh (peringatan AV-D4)' : 'tidak diketahui'}{vrm.info.licenseUrl && <> · <a href={vrm.info.licenseUrl} target="_blank" rel="noreferrer">lisensi</a></>}</li>
              </ul>
            ) : <p className="vk-muted">Memuat avatar contoh…</p>}
            <label className="vk-btn vk-btn-ghost">Unggah .vrm
              <input type="file" accept=".vrm" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 50 * 1024 * 1024) return say('File lebih dari 50 MB (AV-D3)');
                try { await loadVrm(await f.arrayBuffer(), f.name); } catch (err) { say(`VRM ditolak: ${String(err)}`); }
              }} />
            </label>
          </section>

          <section className="vk-card">
            <h2 className={styles.h2}>2. Video yang dikomentari</h2>
            {content && <video ref={contentRef} src={content.url} className={styles.content} controls playsInline />}
            <div className={styles.row}>
              <label className="vk-btn vk-btn-ghost">Ganti video
                <input type="file" accept="video/*" hidden onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setContent({ blob: f, name: f.name, url: URL.createObjectURL(f) });
                }} />
              </label>
              <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} aria-label="Ukuran output">
                <option value="16x9">16:9 YouTube</option><option value="9x16">9:16 Shorts/TikTok</option>
              </select>
              <label className={styles.check}><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Cermin</label>
            </div>
          </section>

          <section className="vk-card">
            <h2 className={styles.h2}>3. Rekam</h2>
            <div className={styles.row}>
              {!camOn
                ? <button className="vk-btn" disabled={busy} onClick={() => void startCamera()}>Nyalakan kamera</button>
                : <button className="vk-btn vk-btn-ghost" disabled={recording} onClick={stopCamera}>Matikan kamera</button>}
              <button className="vk-btn vk-btn-ghost" disabled={!camOn} onClick={calibrate}>Kalibrasi netral</button>
              {!recording
                ? <button className="vk-btn" disabled={!camOn || busy} onClick={() => void startRecording()}>● Rekam</button>
                : <button className="vk-btn" onClick={() => void stopRecording()}>■ Stop ({(recMs / 1000).toFixed(0)} dtk)</button>}
              <button className="vk-btn vk-btn-ghost" disabled={recording || busy} onClick={() => void loadSyntheticTake()}>Rekaman sintetis 10 dtk</button>
            </div>
            <p className="vk-muted">Pakai headphone agar suara video tidak ikut terekam mikrofon.</p>
            {take && <p>Rekaman: {(take.durationMs / 1000).toFixed(1)} dtk · {take.samples} sampel · {(take.motion.byteLength / 1024).toFixed(0)} KB gerak{take.synthetic ? ' (sintetis)' : ''}</p>}
          </section>

          <section className="vk-card">
            <h2 className={styles.h2}>4. Uji &amp; render</h2>
            <div className={styles.row}>
              <button className="vk-btn vk-btn-ghost" disabled={!take || busy} onClick={async () => { setBusy(true); const d = await testDeterminism(take!); setDet(d.text); say(`Determinisme: ${d.text}`); setBusy(false); }}>Uji determinisme (3 dtk)</button>
              <button className="vk-btn" disabled={!take || busy || !content} onClick={() => void render(take!)}>Render MP4</button>
            </div>
            {det && <p className={styles.mono}>{det}</p>}
            {progress && <div className="vk-progress" aria-label={`Progres ${pct}%`}><span style={{ width: `${pct}%` }} /></div>}
            {result && (
              <div className={styles.result}>
                <video src={result.url} controls playsInline className={styles.content} />
                <p className="vk-muted">{result.text}</p>
                <a className="vk-btn" href={result.url} download="avatar.mp4">Unduh MP4</a>
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="vk-card" style={{ marginTop: 16 }}>
        <h2 className={styles.h2}>Log</h2>
        <pre className={styles.log}>{log.join('\n') || '—'}</pre>
      </section>
    </main>
  );
}
