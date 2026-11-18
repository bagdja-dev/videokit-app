// Pelacakan wajah di browser: MediaPipe Face Landmarker (WASM + GPU), disajikan sendiri dari /vendor/mediapipe/.
// Gambar kamera tidak pernah keluar dari fungsi ini — hanya angka blendshape & rotasi kepala.

/** 52 blendshape MediaPipe (urutan kanonis). Nilai dipetakan per nama, jadi urutan model tidak penting. */
export const BLENDSHAPE_NAMES = [
  '_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff',
  'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight',
  'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft',
  'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight',
] as const;
const NAME_INDEX: Record<string, number> = Object.fromEntries(BLENDSHAPE_NAMES.map((n, i) => [n, i]));

export interface TrackSample {
  found: boolean;
  /** Kuaternion kepala [x, y, z, w]. */
  quat: [number, number, number, number];
  /** Nilai per BLENDSHAPE_NAMES. */
  blend: Float32Array;
}

/** Matriks 4×4 column-major (facial transformation) → kuaternion rotasi (skala dibuang). */
export function matrixToQuat(m: ArrayLike<number>): [number, number, number, number] {
  const sx = Math.hypot(m[0]!, m[1]!, m[2]!) || 1, sy = Math.hypot(m[4]!, m[5]!, m[6]!) || 1, sz = Math.hypot(m[8]!, m[9]!, m[10]!) || 1;
  const m11 = m[0]! / sx, m21 = m[1]! / sx, m31 = m[2]! / sx;
  const m12 = m[4]! / sy, m22 = m[5]! / sy, m32 = m[6]! / sy;
  const m13 = m[8]! / sz, m23 = m[9]! / sz, m33 = m[10]! / sz;
  const tr = m11 + m22 + m33;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}

type Landmarker = import('@mediapipe/tasks-vision').FaceLandmarker;

export class FaceTracker {
  private constructor(private readonly lm: Landmarker, readonly delegate: 'GPU' | 'CPU') {}

  /** Muat model (±3,7 MB, cache browser). GPU dulu, cadangan CPU. */
  static async create(base = '/vendor/mediapipe/'): Promise<FaceTracker> {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(new URL(base, location.href).href.replace(/\/$/, ''));
    const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL('face_landmarker.task', new URL(base, location.href)).href, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    try {
      return new FaceTracker(await make('GPU'), 'GPU');
    } catch {
      return new FaceTracker(await make('CPU'), 'CPU');
    }
  }

  /** Lacak satu frame video. `tMs` harus naik monoton (aturan mode VIDEO MediaPipe). */
  detect(video: HTMLVideoElement, tMs: number): TrackSample {
    const r = this.lm.detectForVideo(video, tMs);
    const blend = new Float32Array(BLENDSHAPE_NAMES.length);
    const cats = r.faceBlendshapes?.[0]?.categories;
    const mat = r.facialTransformationMatrixes?.[0]?.data;
    if (!cats || !mat) return { found: false, quat: [0, 0, 0, 1], blend };
    for (const c of cats) {
      const i = NAME_INDEX[c.categoryName];
      if (i !== undefined) blend[i] = c.score;
    }
    return { found: true, quat: matrixToQuat(mat), blend };
  }

  close(): void {
    this.lm.close();
  }
}
