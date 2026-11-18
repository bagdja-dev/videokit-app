// Motion track v1 (plan/videokit/avatar-record/overview.md §5.1): data pelacakan wajah per sampel, BUKAN gambar.
// Sampel bertimestamp (laju pelacakan tidak tetap); render mengambil nilai pada waktu frame lewat interpolasi.
//
// Biner: "VKMT" | u32 version | u32 headerLen | header JSON (UTF-8) | pad ke kelipatan 4 | Float32 [n × channels]
// Kolom: t_ms, found, head_qx, head_qy, head_qz, head_qw, lalu blendshape (urutan sesuai header.channels).

export const MOTION_MAGIC = 'VKMT';
export const MOTION_VERSION = 1;
export const FIXED_CHANNELS = ['t_ms', 'found', 'head_qx', 'head_qy', 'head_qz', 'head_qw'] as const;

export interface MotionHeader {
  version: number;
  channels: string[];
}

export interface MotionTrack {
  header: MotionHeader;
  /** n_sampel × channels.length */
  data: Float32Array;
  /** Indeks kolom per nama. */
  index: Record<string, number>;
  count: number;
}

const indexOf = (channels: string[]) => Object.fromEntries(channels.map((c, i) => [c, i]));

export class MotionRecorder {
  readonly channels: string[];
  private chunks: Float32Array[] = [];
  private cur: Float32Array;
  private fill = 0;
  private readonly width: number;
  private lastT = -Infinity;

  constructor(blendshapeNames: string[], private readonly chunkSamples = 1800) {
    this.channels = [...FIXED_CHANNELS, ...blendshapeNames];
    this.width = this.channels.length;
    this.cur = new Float32Array(this.width * chunkSamples);
  }

  /** Tambah sampel. `blendshapes` urutannya sama dengan nama di konstruktor. Waktu harus naik. */
  push(tMs: number, found: boolean, headQuat: ArrayLike<number>, blendshapes: ArrayLike<number>): void {
    if (tMs <= this.lastT) return;
    this.lastT = tMs;
    const o = this.fill * this.width;
    const row = this.cur;
    row[o] = tMs;
    row[o + 1] = found ? 1 : 0;
    for (let k = 0; k < 4; k++) row[o + 2 + k] = headQuat[k] ?? (k === 3 ? 1 : 0);
    for (let k = 0; k < this.width - FIXED_CHANNELS.length; k++) row[o + FIXED_CHANNELS.length + k] = blendshapes[k] ?? 0;
    if (++this.fill === this.chunkSamples) {
      this.chunks.push(this.cur);
      this.cur = new Float32Array(this.width * this.chunkSamples);
      this.fill = 0;
    }
  }

  get count(): number {
    return this.chunks.length * this.chunkSamples + this.fill;
  }

  /** Serialisasi ke biner v1. */
  toBytes(): Uint8Array {
    const header = new TextEncoder().encode(JSON.stringify({ version: MOTION_VERSION, channels: this.channels } satisfies MotionHeader));
    const headerPadded = Math.ceil((12 + header.length) / 4) * 4;
    const floats = this.count * this.width;
    const out = new Uint8Array(headerPadded + floats * 4);
    out.set(new TextEncoder().encode(MOTION_MAGIC), 0);
    const dv = new DataView(out.buffer);
    dv.setUint32(4, MOTION_VERSION, true);
    dv.setUint32(8, header.length, true);
    out.set(header, 12);
    const body = new Float32Array(out.buffer, headerPadded, floats);
    let o = 0;
    for (const c of this.chunks) { body.set(c, o); o += c.length; }
    body.set(this.cur.subarray(0, this.fill * this.width), o);
    return out;
  }
}

export function parseMotionTrack(bytes: ArrayBuffer | Uint8Array): MotionTrack {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (new TextDecoder().decode(u8.subarray(0, 4)) !== MOTION_MAGIC) throw new Error('Bukan motion track VideoKit');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = dv.getUint32(4, true);
  if (version !== MOTION_VERSION) throw new Error(`Versi motion track ${version} tidak didukung`);
  const hl = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + hl))) as MotionHeader;
  const start = Math.ceil((12 + hl) / 4) * 4;
  const width = header.channels.length;
  // Salin agar selaras 4 byte apa pun offset sumbernya.
  const data = new Float32Array(u8.slice(start, start + Math.floor((u8.length - start) / (4 * width)) * width * 4).buffer);
  return { header, data, index: indexOf(header.channels), count: data.length / width };
}

/**
 * Nilai semua kanal pada waktu tMs: interpolasi linear antar dua sampel terdekat; kuaternion kepala di-nlerp
 * (dengan koreksi tanda). Di luar rentang → sampel ujung. `out` dipakai ulang agar tanpa alokasi per frame.
 */
export function sampleMotion(track: MotionTrack, tMs: number, out = new Float32Array(track.header.channels.length)): Float32Array {
  const w = track.header.channels.length;
  const n = track.count;
  if (!n) { out.fill(0); out[5] = 1; return out; }
  const t = (i: number) => track.data[i * w]!;
  if (tMs <= t(0)) { out.set(track.data.subarray(0, w)); return out; }
  if (tMs >= t(n - 1)) { out.set(track.data.subarray((n - 1) * w, n * w)); return out; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t(mid) <= tMs) lo = mid; else hi = mid; }
  const a = lo * w, b = hi * w;
  const f = (tMs - t(lo)) / (t(hi) - t(lo));
  for (let k = 0; k < w; k++) out[k] = track.data[a + k]! + (track.data[b + k]! - track.data[a + k]!) * f;
  // Kuaternion: arah terpendek + normalisasi.
  let dot = 0;
  for (let k = 2; k < 6; k++) dot += track.data[a + k]! * track.data[b + k]!;
  if (dot < 0) for (let k = 2; k < 6; k++) out[k] = track.data[a + k]! + (-track.data[b + k]! - track.data[a + k]!) * f;
  const len = Math.hypot(out[2]!, out[3]!, out[4]!, out[5]!) || 1;
  for (let k = 2; k < 6; k++) out[k] = out[k]! / len;
  out[0] = tMs;
  return out;
}

/** Durasi rekaman (ms) = timestamp sampel terakhir. */
export const motionDurationMs = (track: MotionTrack) => (track.count ? track.data[(track.count - 1) * track.header.channels.length]! : 0);
