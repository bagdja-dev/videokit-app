'use client';

// Pratinjau avatar langsung: kamera → Face Landmarker → rig → AvatarScene. Tanpa kamera, avatar diputar dengan gerak
// sintetis agar terlihat hidup. Gambar kamera tidak disimpan/dikirim.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AvatarScene } from '@/core/avatar/avatar-scene';
import { parseMotionTrack, sampleMotion } from '@/core/avatar/motion-track';
import { mapToPose, NO_CALIBRATION, PoseSmoother, quatToEulerYXZ, type Calibration } from '@/core/avatar/rig';
import { syntheticMotion } from '@/core/avatar/synthetic';
import { BLENDSHAPE_NAMES, FaceTracker, type TrackSample } from '@/core/avatar/tracker';

const IDX: Record<string, number> = Object.fromEntries(BLENDSHAPE_NAMES.map((n, i) => [n, i]));
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

export interface LiveAvatar {
  camOn: boolean;
  starting: boolean;
  fps: { track: number; render: number };
  error: string | null;
  faceFound: boolean;
  calibrated: boolean;
  mirror: boolean;
  setMirror: (m: boolean) => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  calibrate: () => boolean;
}

export function useLiveAvatar(canvasRef: RefObject<HTMLCanvasElement | null>, videoRef: RefObject<HTMLVideoElement | null>, bytes: ArrayBuffer | null): LiveAvatar {
  const sceneRef = useRef<AvatarScene | null>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latest = useRef<TrackSample | null>(null);
  const calib = useRef<Calibration>(NO_CALIBRATION);
  const [camOn, setCamOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [fps, setFps] = useState({ track: 0, render: 0 });
  const [error, setError] = useState<string | null>(null);
  const [faceFound, setFaceFound] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [mirror, setMirror] = useState(true);
  const [loadedVersion, setLoadedVersion] = useState(0);

  // adegan dibuat sekali per canvas
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    sceneRef.current = new AvatarScene(c, { width: c.width, height: c.height, background: null, framing: 'bust' });
    return () => { sceneRef.current?.dispose(); sceneRef.current = null; };
  }, [canvasRef]);

  useEffect(() => {
    if (!bytes || !sceneRef.current) return;
    let alive = true;
    sceneRef.current.load(bytes.slice(0))
      .then(() => { if (alive) setLoadedVersion((v) => v + 1); })
      .catch((e: unknown) => { if (alive) setError(`Avatar tidak bisa dimuat: ${String(e)}`); });
    return () => { alive = false; };
  }, [bytes]);

  useEffect(() => {
    let raf = 0, lastVideoTime = -1, last = performance.now(), windowStart = last, nTrack = 0, nRender = 0, found = false;
    const smoother = new PoseSmoother();
    const synth = parseMotionTrack(syntheticMotion(60_000));
    const synthBuf = new Float32Array(synth.header.channels.length);
    const loop = () => {
      const now = performance.now();
      const v = videoRef.current, scene = sceneRef.current;
      if (camOn && trackerRef.current && v && v.readyState >= 2 && v.currentTime !== lastVideoTime) {
        lastVideoTime = v.currentTime;
        latest.current = trackerRef.current.detect(v, now);
        nTrack++;
      }
      if (scene?.loaded) {
        let get: (n: string) => number;
        if (camOn && latest.current) { get = getterFor(latest.current); found = latest.current.found; }
        else { sampleMotion(synth, now % 60_000, synthBuf); get = (n) => { const k = synth.index[n]; return k === undefined ? 0 : synthBuf[k]!; }; }
        scene.applyPose(smoother.step(mapToPose(get, calib.current, { mirror }), now), now);
        scene.step(Math.min(0.1, (now - last) / 1000));
        nRender++;
      }
      last = now;
      if (now - windowStart >= 1000) {
        setFps({ track: nTrack, render: nRender });
        setFaceFound(found);
        nTrack = nRender = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [camOn, mirror, videoRef, loadedVersion]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    latest.current = null;
    setCamOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      if (!trackerRef.current) trackerRef.current = await FaceTracker.create();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setCamOn(true);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setError(name === 'NotAllowedError' ? 'Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser.'
        : name === 'NotReadableError' ? 'Kamera sedang dipakai aplikasi lain.'
        : name === 'NotFoundError' ? 'Kamera tidak ditemukan.'
        : `Kamera gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStarting(false);
    }
  }, [videoRef]);

  const calibrate = useCallback(() => {
    const s = latest.current;
    if (!s?.found) return false;
    const rest: Record<string, number> = {};
    for (const n of BLENDSHAPE_NAMES) if (/^(jaw|mouth|brow)/.test(n)) rest[n] = s.blend[IDX[n]!]!;
    calib.current = { head: quatToEulerYXZ(...s.quat), rest };
    setCalibrated(true);
    return true;
  }, []);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); trackerRef.current?.close(); }, []);

  return { camOn, starting, fps, error, faceFound, calibrated, mirror, setMirror, startCamera, stopCamera, calibrate };
}
