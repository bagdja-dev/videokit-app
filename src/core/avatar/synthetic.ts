// Motion track sintetis (deterministik) untuk uji tanpa kamera: bicara (rahang naik-turun bersuku kata),
// kedip berkala, kepala menoleh & mengangguk pelan, lirikan mata.
import { BLENDSHAPE_NAMES } from './tracker';
import { MotionRecorder } from './motion-track';

const IDX = Object.fromEntries(BLENDSHAPE_NAMES.map((n, i) => [n, i])) as Record<string, number>;

export function syntheticMotion(durationMs: number, hz = 30): Uint8Array {
  const rec = new MotionRecorder([...BLENDSHAPE_NAMES]);
  const blend = new Float32Array(BLENDSHAPE_NAMES.length);
  for (let t = 0; t <= durationMs; t += 1000 / hz) {
    const s = t / 1000;
    blend.fill(0);
    // bicara 2,5 dtk lalu jeda 1 dtk; suku kata ±5 Hz
    const talking = s % 3.5 < 2.5;
    const syl = Math.max(0, Math.sin(s * 2 * Math.PI * 5));
    blend[IDX.jawOpen!] = talking ? 0.15 + 0.45 * syl : 0.02;
    blend[IDX.mouthFunnel!] = talking ? 0.3 * Math.max(0, Math.sin(s * 2 * Math.PI * 1.3)) : 0;
    blend[IDX.mouthSmileLeft!] = blend[IDX.mouthSmileRight!] = 0.25 + 0.2 * Math.sin(s * 0.7);
    const blink = (s % 3) < 0.15 ? Math.sin(((s % 3) / 0.15) * Math.PI) : 0;
    blend[IDX.eyeBlinkLeft!] = blend[IDX.eyeBlinkRight!] = blink;
    const look = Math.sin(s * 0.9);
    blend[IDX.eyeLookOutLeft!] = blend[IDX.eyeLookInRight!] = Math.max(0, look) * 0.5;
    blend[IDX.eyeLookInLeft!] = blend[IDX.eyeLookOutRight!] = Math.max(0, -look) * 0.5;
    const yaw = 0.35 * Math.sin(s * 2 * Math.PI * 0.15), pitch = 0.12 * Math.sin(s * 2 * Math.PI * 0.23), roll = 0.08 * Math.sin(s * 2 * Math.PI * 0.11);
    // Euler YXZ → kuaternion
    const c1 = Math.cos(yaw / 2), s1 = Math.sin(yaw / 2), c2 = Math.cos(pitch / 2), s2 = Math.sin(pitch / 2), c3 = Math.cos(roll / 2), s3 = Math.sin(roll / 2);
    const q: [number, number, number, number] = [
      s2 * c1 * c3 + c2 * s1 * s3, c2 * s1 * c3 - s2 * c1 * s3, c2 * c1 * s3 - s2 * s1 * c3, c2 * c1 * c3 + s2 * s1 * s3,
    ];
    rec.push(t, true, q, blend);
  }
  return rec.toBytes();
}
