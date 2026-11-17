import { describe, expect, it } from 'vitest';
import { validateSpec } from '@/core/render/timeline';
import type { RenderSpecV1 } from '@/core/render/types';
import { avatarRect } from '../layout';
import { MotionRecorder, motionDurationMs, parseMotionTrack, sampleMotion } from '../motion-track';
import { idleBlink, mapToPose, OneEuro, quatToEulerYXZ } from '../rig';
import { syntheticMotion } from '../synthetic';
import { BLENDSHAPE_NAMES, matrixToQuat } from '../tracker';

const yawQuat = (a: number): [number, number, number, number] => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

describe('motion track v1', () => {
  it('serialisasi bolak-balik + interpolasi', () => {
    const rec = new MotionRecorder(['jawOpen', 'eyeBlinkLeft'], 2); // chunk kecil → menguji sambungan antar chunk
    rec.push(0, true, yawQuat(0), [0, 0]);
    rec.push(100, true, yawQuat(0.4), [1, 0.5]);
    rec.push(100, true, yawQuat(9), [9, 9]); // waktu tidak naik → diabaikan
    rec.push(200, false, yawQuat(0.4), [0.5, 0]);
    const t = parseMotionTrack(rec.toBytes());
    expect(t.count).toBe(3);
    expect(motionDurationMs(t)).toBe(200);
    const v = sampleMotion(t, 50);
    expect(v[t.index.jawOpen!]).toBeCloseTo(0.5);
    expect(v[t.index.eyeBlinkLeft!]).toBeCloseTo(0.25);
    const e = quatToEulerYXZ(v[2]!, v[3]!, v[4]!, v[5]!);
    expect(e.yaw).toBeCloseTo(0.2, 2);
    expect(sampleMotion(t, -10)[t.index.jawOpen!]).toBe(0); // sebelum awal → sampel pertama
    expect(sampleMotion(t, 999)[t.index.jawOpen!]).toBeCloseTo(0.5); // sesudah akhir → sampel terakhir
  });

  it('kuaternion berlawanan tanda diinterpolasi lewat jalur terpendek', () => {
    const rec = new MotionRecorder([]);
    const q = yawQuat(0.3);
    rec.push(0, true, q, []);
    rec.push(100, true, q.map((x) => -x), []); // rotasi sama, tanda terbalik
    const t = parseMotionTrack(rec.toBytes());
    const v = sampleMotion(t, 50);
    expect(quatToEulerYXZ(v[2]!, v[3]!, v[4]!, v[5]!).yaw).toBeCloseTo(0.3, 3);
  });

  it('gerak sintetis 30 dtk ±6,8 KB/dtk', () => {
    const bytes = syntheticMotion(30_000);
    const t = parseMotionTrack(bytes);
    expect(t.count).toBe(901);
    expect(t.header.channels).toHaveLength(6 + BLENDSHAPE_NAMES.length);
    expect(bytes.byteLength / 30).toBeLessThan(7_500);
  });
});

describe('rig', () => {
  const getter = (vals: Record<string, number>, q: [number, number, number, number] = [0, 0, 0, 1]) => (n: string) =>
    ({ found: 1, head_qx: q[0], head_qy: q[1], head_qz: q[2], head_qw: q[3], ...vals })[n] ?? 0;

  it('rahang terbuka → aa; kedip melewati ambang', () => {
    const p = mapToPose(getter({ jawOpen: 0.5, eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1 }), undefined, { mirror: false });
    expect(p.expressions.aa).toBeCloseTo(0.9);
    expect(p.expressions.blinkLeft).toBe(1);
    expect(p.expressions.blinkRight).toBe(0);
  });

  it('mode cermin menukar kedip & membalik arah toleh', () => {
    const g = getter({ eyeBlinkLeft: 0.9 }, yawQuat(0.3));
    const m = mapToPose(g, undefined, { mirror: true });
    const n = mapToPose(g, undefined, { mirror: false });
    expect(m.expressions.blinkRight).toBe(1);
    expect(m.head.yaw).toBeCloseTo(-n.head.yaw);
  });

  it('kalibrasi mengurangi pose & blendshape istirahat', () => {
    const p = mapToPose(getter({ jawOpen: 0.1 }, yawQuat(0.2)), { head: { pitch: 0, yaw: 0.2, roll: 0 }, rest: { jawOpen: 0.1 } }, { mirror: false });
    expect(p.head.yaw).toBeCloseTo(0);
    expect(p.expressions.aa).toBe(0);
  });

  it('One Euro meredam getaran kecil', () => {
    const f = new OneEuro(1.5, 0.02);
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(i % 2 ? 0.52 : 0.48, i / 30);
    expect(Math.abs(out - 0.5)).toBeLessThan(0.01);
  });

  it('kedip otomatis deterministik', () => {
    expect(idleBlink(75)).toBeCloseTo(1, 1);
    expect(idleBlink(1000)).toBe(0);
    expect(idleBlink(3700 + 75)).toBe(idleBlink(75));
  });

  it('matriks rotasi → kuaternion → euler kembali sama', () => {
    const yaw = 0.4, c = Math.cos(yaw), s = Math.sin(yaw);
    // rotasi Y, column-major, dengan skala 2 dan translasi
    const m = [2 * c, 0, -2 * s, 0, 0, 2, 0, 0, 2 * s, 0, 2 * c, 0, 5, 6, 7, 1];
    const q = matrixToQuat(m);
    expect(quatToEulerYXZ(...q).yaw).toBeCloseTo(yaw, 5);
  });
});

describe('tata letak & validasi overlay', () => {
  it('kotak avatar pojok kanan bawah, ukuran genap, tidak keluar frame', () => {
    const r = avatarRect({ anchor: 'bottom-right', width: 0.26, aspect: 3 / 4 }, 1920, 1080);
    expect(r.w % 2 + r.h % 2).toBe(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1920);
    expect(r.y + r.h).toBeLessThanOrEqual(1080);
    const tall = avatarRect({ anchor: 'center', width: 1, aspect: 3 / 4 }, 1920, 1080);
    expect(tall.h).toBeLessThanOrEqual(1080);
  });

  it('validateSpec memeriksa input avatar/motion dan satu avatar per video', () => {
    const base: RenderSpecV1 = {
      spec_version: 1, output: { width: 1920, height: 1080, fps: 30, duration_ms: 5000, background_color: '#000000' },
      inputs: { v: { kind: 'video' }, a: { kind: 'avatar' }, m: { kind: 'motion' } },
      video_track: [{ input: 'v', start_ms: 0, end_ms: 5000, fit: 'contain' }], audio_tracks: [],
      overlays: [{ type: 'avatar', input: 'a', motion: 'm', start_ms: 0, end_ms: 5000, placement: { anchor: 'bottom-right', width: 0.3 } }],
    };
    expect(validateSpec(base)).toEqual([]);
    const bad = { ...base, overlays: [{ ...base.overlays![0]!, motion: 'v' }, { ...base.overlays![0]! }] };
    const paths = validateSpec(bad).map((i) => i.path);
    expect(paths).toContain('overlays[0].motion');
    expect(paths).toContain('overlays');
  });
});
