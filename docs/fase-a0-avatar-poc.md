# Fase A0 — PoC Avatar Rekam (18 Nov 2026)

Plan: `plan/videokit/avatar-record/` (overview + execution-plan). Halaman uji: **`/dev/avatar-lab/`** (kartu
"Avatar Lab" di beranda, di balik login).

## Yang dibuktikan

| Hal berisiko | Hasil |
|---|---|
| Model Face Landmarker disajikan sendiri (COEP) & dimuat | ✅ GPU delegate, dimuat ±130 ms (cache), Chrome headless Mac |
| Avatar VRM dirender di **Web Worker** (three.js + OffscreenCanvas WebGL) | ✅ VRM 1.0 Seed-san ±0,1–0,3 dtk muat, **6–6,5 ms/frame** avatar 500×670 |
| **Deterministik**: dua worker terpisah, masukan sama | ✅ 90/90 frame identik (hash piksel), 90 frame unik (avatar benar-benar bergerak) |
| Lapisan avatar di compositor yang ada (urutan latar → video → avatar → subtitle) | ✅ MP4 10 dtk 1920×1080 H.264+AAC dalam 5,6 dtk (**1,8× realtime**), video konten + avatar + suara + audio konten ter-ducking |
| Regresi tool Video dari Subtitle | ✅ `e2e:render` tetap lulus (SSIM min. 0,974) |
| Format motion track v1 | ✅ ±6,8 KB/dtk (30 menit ≈ 12 MB), unit test serialisasi & interpolasi |

Yang **belum** bisa dibuktikan otomatis (butuh kamera & orang sungguhan) — lihat "Uji manual" di bawah:
FPS pelacakan langsung per perangkat, latensi terasa, kualitas lip-sync dari wajah asli, gema audio tanpa headphone.

## Arsitektur kode

```
src/core/avatar/
  tracker.ts           MediaPipe Face Landmarker → 52 blendshape + kuaternion kepala (gambar kamera tidak disimpan)
  motion-track.ts      format biner v1, perekam, interpolasi (nlerp kuaternion)
  rig.ts               blendshape → ekspresi VRM (aa/ih/ou/ee/oh, kedip, emosi), kepala/leher, mata; One Euro; kedip idle
  avatar-scene.ts      three.js + three-vrm: muat VRM (+metadata lisensi), pose, framing dada/kepala — main thread & worker
  overlay-renderer.ts  lapisan avatar untuk compositor (deterministik: urutan waktu tetap, dt = 1/fps)
  layout.ts            posisi kotak avatar di frame
  synthetic.ts         gerak sintetis untuk uji tanpa kamera
src/core/render/       spec: input `avatar`/`motion`, `overlays[]` (AvatarOverlay) + validasi; compositor menggambar avatar
src/app/dev/avatar-lab/ halaman PoC + avatar-hash.worker.ts (uji determinisme)
scripts/vendor-mediapipe.mjs  wasm MediaPipe + model .task (SHA-256) + avatar contoh dev
scripts/e2e-avatar.mjs        E2E headless
```

## Paket (dipasang 18 Nov 2026, versi pasti, `--ignore-scripts`)

| Paket | Versi | Rilis | Alasan |
|---|---|---|---|
| `@mediapipe/tasks-vision` | 1.2.2 | 3 Nov 2026 | Face Landmarker: blendshape + matriks wajah di browser (WASM/GPU), Apache 2.0 |
| `three` | 0.187.0 | 30 Okt 2026 | Render 3D WebGL, berjalan juga di OffscreenCanvas worker, MIT |
| `@pixiv/three-vrm` | 3.5.5 | 9 Jul 2026 | Memuat VRM 0.x/1.0: ekspresi, lookAt, spring bone, metadata lisensi, MIT |
| `@types/three` (dev) | 0.187.0 | 30 Okt 2026 | Tipe TypeScript three |

Aset (tidak di-commit, diunduh `npm run vendor`, SHA-256 terkunci): `face_landmarker.task` float16 v1 (3,7 MB,
Google), avatar contoh **Seed-san** (VirtualCast, VRM Public License 1.0, dari repo spesifikasi VRM).

## Uji

| Uji | Hasil |
|---|---|
| Unit (vitest) | 49/49 — termasuk motion track (bolak-balik, interpolasi, kuaternion bertanda balik), rig (cermin, kalibrasi, kedip), One Euro, matriks→kuaternion, tata letak, validasi overlay |
| `npm run e2e:avatar` | lulus — tracker dimuat (GPU), determinisme IDENTIK 90 frame, MP4 10,03 dtk 1920×1080 H.264+AAC |
| `npm run e2e:render` (regresi) | lulus — SSIM min. 0,974 |

## Uji manual (perlu dilakukan di perangkat nyata)

1. Jalankan `npm run dev`. Untuk uji tanpa client app console, isi `.env.local` dengan `NEXT_PUBLIC_VK_DEV_AUTH=mock`
   (hanya berlaku di dev). Buka `/dev/avatar-lab/`.
2. **Nyalakan kamera** → lihat badge "Lacak … fps · … ms" dan "Avatar … fps". Duduk santai → **Kalibrasi netral**.
3. Bicara, menoleh, kedip, senyum → apakah avatar mengikuti dan arah tolehnya benar (opsi **Cermin**)?
4. **● Rekam** ±1–2 menit sambil video contoh diputar (coba dengan & tanpa headphone) → **Render MP4** → periksa sinkron
   mulut dengan suara dan apakah suara video ikut terekam mic.
5. Ulangi di Android / MatePad / iOS lewat `npm run dev:https` (kamera wajib secure context) dan catat FPS.

## Temuan & catatan

- Framing dada: tampilan 0,95 m agar lengan tidak terpotong kotak 3:4.
- Ducking audio konten saat ini berbasis rentang voice (seluruh rekaman) → audio video selalu dikecilkan selama ada
  rekaman suara. Fase A3: ducking berbasis energi suara (hanya saat benar-benar bicara).
- Wajah hilang dari kamera → kepala kembali pelan ke netral + kedip otomatis. Mulut dari energi suara baru dipakai di
  pratinjau (A3: dihitung dari audio saat render).
- Safari < 17 tidak bisa memuat tekstur GLTF di worker (`ImageBitmapLoader`) — perlu dicek di iOS.
- Login dev tiruan (`NEXT_PUBLIC_VK_DEV_AUTH=mock`) terverifikasi hilang dari build produksi.
