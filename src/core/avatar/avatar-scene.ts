// Adegan avatar VRM (three.js + three-vrm). Kode SAMA untuk pratinjau langsung (main thread, <canvas>) dan render
// akhir (compositor worker, OffscreenCanvas) — pose & langkah fisika (spring bone) dengan dt tetap → deterministik.
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import {
  AmbientLight, Box3, Color, DirectionalLight, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RigPose, VrmExpression } from './rig';
import { VRM_EXPRESSIONS } from './rig';

export type Framing = 'bust' | 'head';

/** Penyesuaian bingkai manual per avatar (relatif tinggi avatar). zoom 1 = otomatis. */
export interface FramingAdjust { zoom: number; offset_x: number; offset_y: number }
export const NO_FRAMING_ADJUST: FramingAdjust = { zoom: 1, offset_x: 0, offset_y: 0 };

export interface AvatarInfo {
  name: string;
  authors: string;
  /** Ringkasan izin dari metadata VRM (ditampilkan ke pengguna, AV-D4). */
  commercialUse: 'allowed' | 'not-allowed' | 'unknown';
  licenseUrl?: string;
  vrmVersion: '0' | '1';
  /** Ekspresi wajib yang tidak dimiliki avatar → bagian itu tidak akan bergerak. */
  missingExpressions: string[];
}

export interface AvatarSceneOptions {
  width: number;
  height: number;
  /** null = transparan (ditumpuk di atas video). */
  background?: string | null;
  framing?: Framing;
  adjust?: FramingAdjust;
}

const REQUIRED: VrmExpression[] = ['aa', 'blinkLeft', 'blinkRight'];

function readInfo(vrm: VRM): AvatarInfo {
  const meta = vrm.meta as unknown as Record<string, unknown>;
  const missingExpressions = REQUIRED.filter((e) => !vrm.expressionManager?.getExpression(e));
  if (meta.metaVersion === '1') {
    const cu = meta.commercialUsage as string | undefined;
    return {
      name: String(meta.name ?? 'Tanpa nama'),
      authors: Array.isArray(meta.authors) ? (meta.authors as string[]).join(', ') : '',
      commercialUse: cu === 'personalNonProfit' ? 'not-allowed' : cu ? 'allowed' : 'unknown',
      licenseUrl: typeof meta.licenseUrl === 'string' ? meta.licenseUrl : undefined,
      vrmVersion: '1',
      missingExpressions,
    };
  }
  const cu = meta.commercialUssageName as string | undefined; // ejaan asli spesifikasi VRM 0.x
  return {
    name: String(meta.title ?? 'Tanpa nama'),
    authors: String(meta.author ?? ''),
    commercialUse: cu === 'Disallow' ? 'not-allowed' : cu === 'Allow' ? 'allowed' : 'unknown',
    licenseUrl: typeof meta.otherLicenseUrl === 'string' && meta.otherLicenseUrl ? meta.otherLicenseUrl : undefined,
    vrmVersion: '0',
    missingExpressions,
  };
}

export class AvatarScene {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private vrm: VRM | null = null;
  private framing: Framing;
  private adjust: FramingAdjust;
  private elapsed = 0;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas, opts: AvatarSceneOptions) {
    this.framing = opts.framing ?? 'bust';
    this.adjust = opts.adjust ?? NO_FRAMING_ADJUST;
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.camera = new PerspectiveCamera(22, opts.width / opts.height, 0.1, 20);
    this.setSize(opts.width, opts.height);
    this.setBackground(opts.background ?? null);
    const key = new DirectionalLight(0xffffff, Math.PI);
    key.position.set(0.6, 1.2, 1.5);
    this.scene.add(key, new AmbientLight(0xffffff, 0.6));
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.frame();
  }

  /** Ubah bingkai manual (pratinjau langsung saat slider digeser). */
  setAdjust(adjust: FramingAdjust): void {
    this.adjust = adjust;
    this.frame();
  }

  setBackground(color: string | null): void {
    if (color) { this.scene.background = new Color(color); this.renderer.setClearColor(color, 1); }
    else { this.scene.background = null; this.renderer.setClearColor(0x000000, 0); }
  }

  async load(bytes: ArrayBuffer): Promise<AvatarInfo> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(bytes, '');
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error('File bukan avatar VRM (tidak ada ekstensi VRM)');
    if (!vrm.humanoid) throw new Error('Avatar tidak punya kerangka humanoid');
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // VRM 0.x menghadap -Z → putar agar semua menghadap kamera (+Z)
    if (this.vrm) { this.scene.remove(this.vrm.scene); VRMUtils.deepDispose(this.vrm.scene); }
    this.vrm = vrm;
    vrm.scene.traverse((o) => { o.frustumCulled = false; });
    this.scene.add(vrm.scene);
    if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
    this.restPose();
    vrm.update(0);
    this.frame();
    this.elapsed = 0;
    return readInfo(vrm);
  }

  /**
   * Set rotasi tulang ter-normalisasi dengan konvensi VRM 1.0 (avatar menghadap +Z). VRM 0.x menghadap −Z di ruang
   * tulangnya, sehingga sumbu X dan Z terbalik — tanpa koreksi ini lengan VRM 0.x terangkat ke atas dan anggukan
   * kepala terbalik (pola yang sama dipakai contoh animasi three-vrm).
   */
  private setBone(bone: Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0], x: number, y: number, z: number): void {
    const n = this.vrm?.humanoid.getNormalizedBoneNode(bone);
    if (!n) return;
    const s = this.isVrm0 ? -1 : 1;
    n.rotation.set(x * s, y, z * s, 'YXZ');
  }

  private get isVrm0(): boolean {
    return (this.vrm?.meta as { metaVersion?: string } | undefined)?.metaVersion === '0';
  }

  /** Lengan turun (VRM default T-pose) + sedikit tekuk siku. */
  private restPose(): void {
    this.setBone('leftUpperArm', 0, 0, -1.2);
    this.setBone('rightUpperArm', 0, 0, 1.2);
    this.setBone('leftLowerArm', 0, -0.25, 0);
    this.setBone('rightLowerArm', 0, 0.25, 0);
  }

  /**
   * Kamera membingkai dada ke atas ('bust') atau kepala saja — RELATIF terhadap ukuran avatar, karena VRM bisa
   * diekspor dengan skala/proporsi berbeda (angka meter tetap memotong avatar yang lebih besar).
   * Tinggi efektif = tinggi tulang kepala dari telapak / 0,87 (proporsi tubuh), tidak terpengaruh rambut/topi tinggi.
   */
  private frame(): void {
    const vrm = this.vrm;
    const p = new Vector3(0, 1.4, 0);
    let height = 1.6;
    if (vrm) {
      vrm.scene.updateMatrixWorld(true);
      const head = vrm.humanoid.getRawBoneNode('head') ?? vrm.humanoid.getNormalizedBoneNode('head');
      head?.getWorldPosition(p);
      const box = new Box3().setFromObject(vrm.scene);
      const floor = Number.isFinite(box.min.y) ? box.min.y : 0;
      const h = (p.y - floor) / 0.87;
      if (Number.isFinite(h) && h > 0.2) height = h;
    }
    const a = this.adjust;
    const viewH = (this.framing === 'head' ? 0.28 * height : 0.6 * height) / Math.max(0.1, a.zoom);
    const centerY = (this.framing === 'head' ? p.y + 0.03 * height : p.y - 0.125 * height) + a.offset_y * height;
    p.x += a.offset_x * height;
    const dist = viewH / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.near = Math.max(0.01, dist * 0.05);
    this.camera.far = dist * 10 + height * 4;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(p.x, centerY + 0.0125 * height, p.z + dist);
    this.camera.lookAt(p.x, centerY, p.z);
  }

  /** Terapkan pose (hasil rig) — kepala 60% di tulang kepala, 40% di leher; napas idle dari waktu. */
  applyPose(pose: RigPose, tMs: number): void {
    const vrm = this.vrm;
    if (!vrm) return;
    const em = vrm.expressionManager;
    if (em) for (const k of VRM_EXPRESSIONS) if (em.getExpression(k)) em.setValue(k, pose.expressions[k]);
    const lim = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    const pitch = lim(pose.head.pitch, 0.7), yaw = lim(pose.head.yaw, 0.9), roll = lim(pose.head.roll, 0.6);
    this.setBone('neck', pitch * 0.4, yaw * 0.4, roll * 0.4);
    this.setBone('head', pitch * 0.6, yaw * 0.6, roll * 0.6);
    // Tubuh atas ikut sedikit + napas.
    const breath = Math.sin((tMs / 1000) * 2 * Math.PI * 0.25) * 0.015;
    this.setBone('spine', breath, yaw * 0.12, roll * 0.1);
    if (vrm.lookAt) { vrm.lookAt.yaw = pose.eyes.yaw; vrm.lookAt.pitch = pose.eyes.pitch; }
  }

  /** Maju dt detik (fisika rambut/baju, ekspresi) lalu gambar. */
  step(dtSec: number): void {
    this.elapsed += dtSec;
    this.vrm?.update(dtSec);
    this.renderer.render(this.scene, this.camera);
  }

  get loaded(): boolean {
    return !!this.vrm;
  }

  dispose(): void {
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene);
    this.vrm = null;
    this.renderer.dispose();
  }
}
