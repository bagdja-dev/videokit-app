# Fase 2 — Executor Browser: Laporan (17 Nov 2026)

Modul `src/core/render` me-render **Render Spec v1** menjadi MP4 seluruhnya di perangkat pengguna
(VideoKit overview §2.7–§2.8, D13 hybrid). Server tidak menjalankan apa pun untuk render.

## Arsitektur modul

| File | Thread | Tugas |
|---|---|---|
| `types.ts` | — | Tipe Render Spec v1 (sama dengan `plan/video-render/overview.md` §3.2) |
| `timeline.ts` | — | Validasi spec (tanpa lubang/tumpang tindih), pemetaan frame → waktu sumber (freeze/loop) |
| `envelope.ts` | — | Amplop gain musik latar: fade + ducking (titik linear, identik dengan referensi ffmpeg) |
| `capabilities.ts` | main | Deteksi WebCodecs, H.264 di resolusi output, AAC/Opus, OPFS |
| `subtitles.ts` | main | ASS → bitmap per interval lewat JASSUB (libass WASM); pemanasan font; gagal keras bila kosong |
| `audio.ts` | main | Mix audio per potongan 20 dtk (OfflineAudioContext tidak ada di worker) |
| `compositor.worker.ts` | worker | Decode (mediabunny/WebCodecs) → komposit OffscreenCanvas → encode H.264 → mux MP4 bertahap ke OPFS |
| `render.ts` | main | API publik `renderVideo(spec, sources, { onProgress, signal })` → `File` dari OPFS |
| `working-copy.ts` | main | Salinan kerja upload (D5): video ≤ ukuran output H.264 30 fps; gambar → WebP |
| `opfs.ts` | keduanya | Writable OPFS (createWritable / sync handle Safari), baca, hapus, bersihkan sisa > 24 jam |

Halaman uji internal: `/dev/render-lab/` (tidak diindeks).

## Hasil uji (Mac M4, Chrome 157 headless, dari hasil `next build` static export)

| Uji | Hasil |
|---|---|
| Unit test (vitest) | 12/12 lulus (validasi spec, frame mapping, amplop ducking) |
| E2E 30 dtk vs referensi ffmpeg | **lulus** — SSIM per segmen min. **0,978** (blur 0,989, cover 0,984–0,996, gambar contain 0,995, subtitle 0,978–0,993); audio selisih RMS rata-rata **0,04 dB** |
| Render 30 dtk | 8,4 dtk (3,6× realtime) |
| Render 10 menit | 100 dtk (6,0× realtime), 241 MB, heap main thread **5 MB** (PoC: ±450 MB) |
| Render **30 menit** | **298 dtk (6,0× realtime), 724 MB**, heap main thread 5 MB, durasi output 1800,02 dtk ✅ |

## Uji perangkat nyata (17 Nov 2026, dev server lewat LAN, HTTP)

| Perangkat / browser | Render di perangkat | Catatan |
|---|---|---|
| Mac M4 — Chrome 157 | ✅ | 30 dtk = 9,4 dtk; 30 menit = 298 dtk (headless) |
| iOS — Chrome (mesin WebKit) | ✅ | Mesin sama dengan Safari → iPhone/iPad umumnya bisa |
| Android 13 — Chrome 157 (Xiaomi 2201117PG) | ✅ lewat `localhost` (adb reverse) / ❌ lewat HTTP LAN | Penyebab gagal = bukan koneksi aman, bukan perangkat. Lewat koneksi aman: OPFS, multi-thread, AAC, H.264 semua ukuran (termasuk portrait 1080×1920, hardware). Render 30 dtk = **52 dtk (0,57× realtime)**, SSIM vs referensi **0,984–0,998** |
| Huawei MatePad — browser HarmonyOS | ❌ tombol render nonaktif | Kandidat pertama jalur render server (Fase 6–7). Browser ini juga menyisipkan atribut `__gcrremoteframetoken` ke `<html>` → `suppressHydrationWarning` di layout |

**Implikasi HP:** hasil identik, tapi **lebih lambat dari realtime** (0,57×): video 30 menit ≈ 53 menit di HP ini, dengan risiko
panas dan tab di latar dihentikan. Usul: routing hybrid memakai **uji kecepatan singkat** (render ±2 detik pertama) untuk
memperkirakan durasi; bila perkiraan > ±5 menit, tawarkan render server. Di produksi (HTTPS asli) masalah koneksi aman hilang.

## Temuan & keputusan selama Fase 2

1. **Gambar transparan** (PNG logo/stiker): browser menggambar alfa di atas warna latar, ffmpeg membuang alfa →
   SSIM 0,90. Aturan baru di kedua executor: **piksel transparan selalu menampilkan `background_color`**, dan kanvas
   selalu dibersihkan sebelum menggambar (sebelumnya `cover`/`blur` bisa menimpa sisa frame sebelumnya).
2. **Latar blur via downscale** (1/8 ukuran + blur 5 px + perbesar) — murah di browser dan direplikasi persis di
   referensi ffmpeg (`scale → gblur sigma 5 → scale`). SSIM blur naik 0,984 → 0,989.
3. **Subtitle dirender sekali per interval** di antara batas event (bukan per frame); bitmap dipindahkan ke worker.
4. **Audio per potongan 20 dtk** — PCM output tidak pernah utuh di RAM. **Belum**: file audio *sumber* masih
   di-decode utuh; musik/narasi 30 menit ≈ 690 MB float → wajib decode streaming sebelum batas 30 menit dibuka.
5. **Referensi ffmpeg gagal untuk 10 menit**: ekspresi volume bersarang (130 tingkat `if`) melampaui batas evaluator
   ffmpeg. Executor server (Fase 6) harus menerapkan amplop sebagai trek gain terpisah (mis. `amultiply`) atau `asendcmd`.
6. **Turbopack macet** saat `next build` (CPU 0%, tanpa error) di Next 16.4.4 dan 16.4.6; **webpack lancar** →
   `build`/`dev` memakai `--webpack`. Dugaan: pola `new Worker(new URL(...))` + wasm di jassub/mediabunny. Perlu
   diselidiki terpisah; tidak memblokir.
8. **Uji Huawei MatePad**: lewat HTTP LAN, React tidak jalan karena Next dev memblokir aset untuk origin selain
   localhost → `allowedDevOrigins` diisi otomatis dengan IP LAN (`next.config.ts`, + `VK_DEV_ORIGINS`). Lewat HTTPS
   dev (sertifikat mkcert) halaman tidak terbuka di tablet. Browser tablet tidak menyediakan OPFS → **OPFS kini
   opsional**: tanpa OPFS hasil ditahan di memori dan durasi dibatasi **10 menit** (`MAX_DURATION_MEMORY_MS`);
   koneksi non-HTTPS hanya peringatan. Kedua mode lolos E2E (SSIM min. 0,978). Uji: `/dev/render-lab/?storage=memory`.
7. **Next 16.4.4 memblokir build** secara berkala karena advisori keamanan (bukan error kode). Naik ke **16.4.6**.

## Paket yang dipasang

Kebijakan: versi dikunci persis (`--save-exact`), dipilih yang **dirilis ≥ 2 minggu lalu** (riwayat serangan
supply-chain di ekosistem ini), dipasang dengan `--ignore-scripts`.

| Paket | Versi | Alasan |
|---|---|---|
| `next` | 16.4.6 | Kerangka app, **static export** (tanpa server aplikasi). ⚠️ Pengecualian aturan 2 minggu (dirilis 9 Nov): 16.4.4 terkena advisori keamanan dan memblokir build; 16.4.6 adalah perbaikannya. |
| `react`, `react-dom` | 19.3.1 | Wajib untuk Next 16 |
| `zustand` | 5.0.16 | State editor + undo/redo (dipakai mulai Fase 3; stack disepakati) |
| `jassub` | 2.5.23 | Render subtitle ASS dengan libass (WASM) — mesin teks yang sama dengan ffmpeg di server |
| `mediabunny` | 1.65.0 | Decode/encode WebCodecs + mux MP4 + konversi (salinan kerja) |
| `typescript` | 5.9.3 | Tipe eksplisit (standar org). TS 7 dihindari: terlalu baru untuk tooling Next |
| `@types/react`, `@types/react-dom` | 19.3.0 | Tipe React |
| `@types/node` | 22.20.5 | Tipe Node untuk skrip & config (sesuai Node LTS deploy) |
| `eslint` | 9.39.5 | Lint (ESLint 10 dihindari: belum didukung `eslint-config-next`) |
| `eslint-config-next` | 16.4.6 | Aturan lint resmi Next, versi sama dengan `next` |
| `vitest` | 4.1.12 | Unit test (standar org: test untuk logic baru) |
| `esbuild` | 0.28.2 | Bundle worker JASSUB ke `public/vendor/jassub` (`npm run vendor`) |

`npm audit`: **0 kerentanan** setelah naik ke Next 16.4.6.

Alat sistem (Fase 0, Homebrew): `ffmpeg` dan `ffmpeg-full` (libass) — hanya untuk sampel dev, renderer referensi,
dan perbandingan E2E. Tidak dipakai saat runtime aplikasi.

## Cara menjalankan

```bash
npm install --ignore-scripts
npm run samples          # media sintetis + spec.json + subs.ass di public/dev-samples (butuh ffmpeg-full)
npm run dev              # buka http://localhost:3000/dev/render-lab/
npm test && npm run typecheck && npm run lint
npm run e2e:render       # build static export → Chrome headless → bandingkan dengan referensi ffmpeg
DURATION_REPEAT=60 npm run samples && SKIP_REFERENCE=1 npm run e2e:render   # uji 30 menit
```

## Belum dikerjakan (lanjutan)

- Decode audio sumber streaming (syarat 30 menit) — temuan #4.
- Uji di laptop tim (Windows/RAM kecil), Safari 26, dan render saat tab di latar.
- Uji salinan kerja dengan video HP asli (HEVC, rotasi, VFR, HDR).
- Hosting statis produksi wajib mengirim header COOP/COEP (lihat `next.config.ts`).
