// Renderer lapisan avatar untuk compositor worker: motion track → rig → three.js (OffscreenCanvas) per frame.
// Deterministik: waktu frame tetap, penghalus berurutan dari awal overlay, fisika dt = 1/fps.
import type { AvatarOverlay } from '@/core/render/types';
import { AvatarScene } from './avatar-scene';
import { avatarRect } from './layout';
import { parseMotionTrack, sampleMotion } from './motion-track';
import { mapToPose, NO_CALIBRATION, PoseSmoother } from './rig';

export interface AvatarOverlayRenderer {
  rect: { x: number; y: number; w: number; h: number };
  canvas: OffscreenCanvas;
  active: (tMs: number) => boolean;
  render: (tMs: number) => void;
  dispose: () => void;
}

export async function createAvatarOverlay(ov: AvatarOverlay, vrm: ArrayBuffer, motion: ArrayBuffer, W: number, H: number, fps: number): Promise<AvatarOverlayRenderer> {
  const rect = avatarRect(ov.placement, W, H);
  const canvas = new OffscreenCanvas(rect.w, rect.h);
  const scene = new AvatarScene(canvas, { width: rect.w, height: rect.h, background: ov.background ?? null, framing: ov.framing });
  await scene.load(vrm);
  const track = parseMotionTrack(motion);
  const buf = new Float32Array(track.header.channels.length);
  const get = (name: string) => { const i = track.index[name]; return i === undefined ? 0 : buf[i]!; };
  const smoother = new PoseSmoother();
  const calib = ov.calibration ?? NO_CALIBRATION;
  const offset = ov.motion_offset_ms ?? 0;
  return {
    rect,
    canvas,
    active: (tMs) => tMs >= ov.start_ms && tMs < ov.end_ms,
    render: (tMs) => {
      const mt = tMs - ov.start_ms + offset;
      sampleMotion(track, mt, buf);
      const pose = smoother.step(mapToPose(get, calib, { mirror: ov.mirror ?? true }), mt);
      scene.applyPose(pose, mt);
      scene.step(1 / fps);
    },
    dispose: () => scene.dispose(),
  };
}
