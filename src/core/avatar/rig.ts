// Pemetaan data pelacakan (blendshape MediaPipe + kuaternion kepala) → pose avatar VRM (overview §4.3).
// Fungsi murni + filter One Euro: dipakai identik oleh pratinjau langsung dan render (deterministik).

export const VRM_EXPRESSIONS = ['aa', 'ih', 'ou', 'ee', 'oh', 'blinkLeft', 'blinkRight', 'happy', 'angry', 'sad', 'surprised'] as const;
export type VrmExpression = (typeof VRM_EXPRESSIONS)[number];

export interface RigPose {
  expressions: Record<VrmExpression, number>;
  /** Rotasi kepala (radian), urutan YXZ. */
  head: { pitch: number; yaw: number; roll: number };
  /** Arah pandang (derajat) untuk VRM lookAt. */
  eyes: { yaw: number; pitch: number };
  found: boolean;
}

export interface Calibration {
  /** Rotasi kepala saat pose netral (radian). */
  head: { pitch: number; yaw: number; roll: number };
  /** Nilai blendshape saat wajah santai (dikurangkan agar avatar netral). */
  rest: Record<string, number>;
}

export const NO_CALIBRATION: Calibration = { head: { pitch: 0, yaw: 0, roll: 0 }, rest: {} };

export interface RigOptions {
  /** Avatar bergerak seperti cermin (default true — paling alami bagi orang yang melihat pratinjau). */
  mirror?: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Petakan [lo, hi] → [0, 1]. */
const remap = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));

/** Kuaternion → Euler YXZ (radian), rumus sama dengan three.js. */
export function quatToEulerYXZ(x: number, y: number, z: number, w: number): { pitch: number; yaw: number; roll: number } {
  const m11 = 1 - 2 * (y * y + z * z), m13 = 2 * (x * z + w * y);
  const m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x);
  const m31 = 2 * (x * z - w * y), m33 = 1 - 2 * (x * x + y * y);
  const pitch = Math.asin(-Math.max(-1, Math.min(1, m23)));
  if (Math.abs(m23) < 0.9999999) return { pitch, yaw: Math.atan2(m13, m33), roll: Math.atan2(m21, m22) };
  return { pitch, yaw: Math.atan2(-m31, m11), roll: 0 };
}

type Getter = (name: string) => number;

/**
 * Satu sampel (nilai per nama kanal) → pose. `get` membaca kanal blendshape/kepala.
 * Aturan mulut: aa (rahang terbuka), oh (bibir bulat), ou (bibir maju), ee (bibir melebar), ih (senyum + sedikit buka).
 */
export function mapToPose(get: Getter, calib: Calibration = NO_CALIBRATION, opts: RigOptions = {}): RigPose {
  const mirror = opts.mirror ?? true;
  const b = (n: string) => Math.max(0, get(n) - (calib.rest[n] ?? 0));
  const jaw = b('jawOpen');
  const funnel = b('mouthFunnel');
  const pucker = b('mouthPucker');
  const smile = (b('mouthSmileLeft') + b('mouthSmileRight')) / 2;
  const stretch = (b('mouthStretchLeft') + b('mouthStretchRight')) / 2;

  // Mata: blendshape MediaPipe "Left" = mata kiri subjek. Avatar cermin → mata kiri subjek = mata kanan avatar
  // dilihat dari kamera = sisi yang sama di layar.
  const blinkL = remap(get('eyeBlinkLeft'), 0.25, 0.7);
  const blinkR = remap(get('eyeBlinkRight'), 0.25, 0.7);

  const lookRight = (get('eyeLookOutRight') + get('eyeLookInLeft')) / 2;
  const lookLeft = (get('eyeLookOutLeft') + get('eyeLookInRight')) / 2;
  const lookUp = (get('eyeLookUpLeft') + get('eyeLookUpRight')) / 2;
  const lookDown = (get('eyeLookDownLeft') + get('eyeLookDownRight')) / 2;

  const raw = quatToEulerYXZ(get('head_qx'), get('head_qy'), get('head_qz'), get('head_qw'));
  const s = mirror ? -1 : 1;
  const head = {
    pitch: raw.pitch - calib.head.pitch,
    yaw: s * (raw.yaw - calib.head.yaw),
    roll: s * (raw.roll - calib.head.roll),
  };

  return {
    expressions: {
      aa: clamp01(jaw * 1.8 - pucker * 0.6),
      oh: clamp01(funnel * 1.6),
      ou: clamp01(pucker * 1.4 - jaw * 0.3),
      ee: clamp01(stretch * 2.2),
      ih: clamp01(smile * jaw * 2.5),
      blinkLeft: mirror ? blinkR : blinkL,
      blinkRight: mirror ? blinkL : blinkR,
      happy: clamp01(smile * 1.1) * 0.7,
      angry: clamp01(((b('browDownLeft') + b('browDownRight')) / 2) * 1.2) * 0.5,
      sad: clamp01(((b('mouthFrownLeft') + b('mouthFrownRight')) / 2) * 1.5) * 0.5,
      surprised: clamp01(b('browInnerUp') * 1.2) * 0.6,
    },
    head,
    eyes: { yaw: s * (lookRight - lookLeft) * 25, pitch: (lookUp - lookDown) * 20 },
    found: get('found') >= 0.5,
  };
}

/** Filter One Euro (Casiez dkk. 2012): halus saat diam, sigap saat bergerak cepat. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private minCutoff = 1.5, private beta = 0.02, private dCutoff = 1) {}
  private static alpha(cutoff: number, dt: number) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v: number, tSec: number): number {
    if (this.x === null) { this.x = v; this.t = tSec; return v; }
    const dt = Math.max(1e-3, tSec - this.t);
    this.t = tSec;
    const dv = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

/** Kedip otomatis deterministik (saat wajah tidak terlihat): ±150 ms tiap ±3,7 dtk. */
export function idleBlink(tMs: number): number {
  const period = 3700, dur = 150;
  const p = tMs % period;
  return p < dur ? Math.sin((p / dur) * Math.PI) : 0;
}

/**
 * Penghalus pose berurutan waktu. Saat wajah hilang: kepala kembali pelan ke netral, mata kedip otomatis,
 * mulut mengikuti energi suara bila ada (`voiceLevel` 0..1) — avatar tidak membeku.
 */
export class PoseSmoother {
  private filters = new Map<string, OneEuro>();
  private lastFound: RigPose | null = null;

  private f(key: string, v: number, t: number, minCutoff = 1.5, beta = 0.02): number {
    let flt = this.filters.get(key);
    if (!flt) { flt = new OneEuro(minCutoff, beta); this.filters.set(key, flt); }
    return flt.filter(v, t);
  }

  step(pose: RigPose, tMs: number, voiceLevel = 0): RigPose {
    const t = tMs / 1000;
    let src = pose;
    if (!pose.found) {
      const base = this.lastFound ?? pose;
      const idle = idleBlink(tMs);
      src = {
        found: false,
        head: { pitch: base.head.pitch * 0.9, yaw: base.head.yaw * 0.9, roll: base.head.roll * 0.9 },
        eyes: { yaw: 0, pitch: 0 },
        expressions: { ...base.expressions, aa: clamp01(voiceLevel * 1.5), oh: 0, ou: 0, ee: 0, ih: 0, blinkLeft: idle, blinkRight: idle },
      };
      this.lastFound = { ...src, found: true };
    } else {
      this.lastFound = pose;
    }
    const expressions = {} as Record<VrmExpression, number>;
    for (const k of VRM_EXPRESSIONS) {
      // Kedip harus cepat (cutoff tinggi), mulut sedang, ekspresi emosi lambat.
      const fast = k.startsWith('blink'), mouth = ['aa', 'ih', 'ou', 'ee', 'oh'].includes(k);
      expressions[k] = clamp01(this.f(`e.${k}`, src.expressions[k], t, fast ? 30 : mouth ? 6 : 1.5, fast ? 0 : 0.5));
    }
    return {
      found: src.found,
      expressions,
      head: { pitch: this.f('h.p', src.head.pitch, t), yaw: this.f('h.y', src.head.yaw, t), roll: this.f('h.r', src.head.roll, t) },
      eyes: { yaw: this.f('e.y', src.eyes.yaw, t, 3, 0.1), pitch: this.f('e.p', src.eyes.pitch, t, 3, 0.1) },
    };
  }
}
