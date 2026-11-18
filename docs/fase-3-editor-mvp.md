# Fase 3 — Editor MVP "Video dari Subtitle" (17 Nov 2026)

MVP **tanpa server**: semua berjalan di browser pengguna — dokumen project & file media di IndexedDB, render
dengan executor browser (Fase 2). videokit-api (Fase 1) menyusul untuk login, simpan lintas perangkat, preset bersama,
riwayat render, dan render server.

## Fitur

| Area | Isi |
|---|---|
| Project | Daftar project lokal, buat baru dengan preset 9:16 / 16:9 / 1:1 / 4:5, judul, ganti preset kapan saja |
| SRT | Unggah (UTF-8/BOM; Shift_JIS, EUC-KR, GB18030, Big5; cadangan Windows-1252), peringatan (tumpang tindih dipotong, waktu salah dilewati, tag HTML dibuang), ganti SRT, unduh SRT hasil edit, maks. 1.500 cue |
| Cue | Daftar cue + editor cue terpilih: teks per baris bahasa, visual video/gambar (fit: penuh / utuh / utuh + blur), titik mulai klip, klip pendek (tahan/loop), suara asli klip, "lanjutkan ke cue berikutnya", audio cue + volume |
| Desain | Posisi blok (bawah/tengah/atas), margin; per baris bahasa: font (Poppins, Bebas Neue, Noto Sans KR/JP/SC), ukuran, warna, garis tepi, tebal/miring, kotak latar + opasitas |
| Latar | Musik latar + volume; **video/gambar latar** (loop, tampil pada cue tanpa visual & area kosong `contain`) + **With audio** + volume; level ducking |
| Pratinjau & render | Pratinjau cue terpilih (resolusi ½, ±8 dtk) memakai mesin render yang sama → WYSIWYG; render penuh + progres + batal + unduh MP4; peringatan bila perangkat tidak mampu / melebihi batas durasi |
| Editor | Undo/redo (tombol & Ctrl/Cmd+Z), simpan otomatis ke IndexedDB, responsif |

Aturan visual: visual cue tampil dari awal cue sampai cue berikutnya mulai (jeda ditahan); cue pertama mulai dari
detik 0; cue tanpa visual → video latar, atau warna latar bila tidak ada.

## Huruf Korea, Jepang, Mandarin (18 Nov 2026)

| Aspek | Keputusan |
|---|---|
| Font | Noto Sans KR / JP / SC (SubsetOTF, OFL), Regular + Bold, paket `public/fonts/cjk-v1/` |
| Unduhan | Hanya font yang dirujuk ASS (`fontsForAss`), diunduh dengan progres "Mengunduh font" lalu diserahkan ke JASSUB sebagai byte; cache HTTP browser untuk render berikutnya. Project Latin tidak mengunduh font CJK sama sekali |
| Font cadangan | Slot berfont Latin + teks CJK → `{\fnNoto Sans xx}` otomatis. Kana → JP, Hangul → KR, Han saja → bahasa dominan slot; baris Han ≥6 huruf → Mandarin |
| Pemotongan baris | libass tidak memotong teks tanpa spasi (JP/ZH meluber keluar layar — terbukti di uji). Disisipkan `{\fscx0} {\fscx100}` antar huruf Han/Kana + aturan kinsoku. Hangul dipotong per kata |
| SRT lama | Shift_JIS (bukti: hiragana), EUC-KR vs GB18030 dibedakan frekuensi huruf umum, Big5; peringatan di editor |
| Repo | `cjk-v1` (±36 MB) tidak di-commit: `npm run vendor` mengunduhnya dari notofonts/noto-cjk commit `f8d1575` dengan SHA-256 terkunci |

Batasan: Mandarin tradisional memakai SC (sebagian besar huruf tersedia, bentuk glif gaya daratan); font Noto tanpa
varian miring (libass memiringkan sintetis); Big5 yang juga valid sebagai GB18030 terbaca sebagai GB18030 (ada peringatan).

## Login Bagdja & header (18 Nov 2026)

Produk akan dibuka di internet, jadi fitur hanya bisa dipakai setelah login SSO Bagdja.

| Aspek | Keputusan |
|---|---|
| Arsitektur | BFF di **`bagdja-videokit-api`** (repo baru). Penukaran code → token dengan `client_secret` + PKCE, token disimpan di cookie httpOnly milik API. App tetap statis dan tidak pernah memegang token |
| Header | Kiri: logo + "VideoKit by Bagdja" (ke beranda). Tengah: nama tool aktif (dari `features/registry.ts`). Kanan: tombol **Masuk**, atau avatar + menu (nama, email, Ganti akun, Keluar). Responsif: di layar kecil hanya logo, nama tool, avatar |
| Akses | Beranda publik (SEO). Halaman tool (`/subtitle-video/`, `/dev/render-lab/`) dibungkus `RequireAuth`: belum login → dialihkan ke SSO lalu kembali ke halaman yang sama |
| Sesi habis | Header kembali menampilkan "Masuk"; halaman yang sedang dipakai **tidak** dialihkan paksa, jadi pekerjaan tidak hilang |
| Data lokal | IndexedDB per akun (`videokit-u-<userId>`), sehingga perangkat bersama tidak menampilkan project akun lain. Data MVP sebelum login diadopsi akun pertama yang login (disalin dulu, baru database lama dihapus) |
| Konfigurasi | `NEXT_PUBLIC_VIDEOKIT_API_URL` saat build produksi. Di development default host app port 5031, termasuk lewat IP LAN |
| Uji | `scripts/lib/mock-auth-api.mjs` meniru kontrak API. `e2e:editor` kini menguji beranda tamu → buka tool → login → kembali → render → logout |

## Editor v2: pratinjau langsung, tab, timeline (18 Nov 2026)

Tata letak mengikuti wireframe Nandang: player di kiri, tab (Setting · Subtitle · Visual) di kanan, timeline cue di bawah.

| Bagian | Isi |
|---|---|
| **Pratinjau langsung** (`LivePlayer`) | Putar/jeda (klik kanvas atau Spasi), geser posisi. Spec, aturan *fit* (`core/render/draw-fit.ts`, dipakai bersama compositor), dan subtitle libass sama dengan render akhir. Subtitle dirender ulang setelah teks/gaya berubah (debounce 350 ms), hanya untuk jendela −15/+60 dtk di sekitar posisi putar. Suara: musik, audio cue, audio video latar, suara klip, dengan ducking sederhana. Visual diputar dari `<video>` biasa, jadi pergantian klip bisa terlambat sepersekian detik; render akhir tetap tepat per frame |
| **Timeline** | Lebar blok sebanding durasi, zoom, penggaris waktu, garis posisi putar (mengikuti saat main). Klik blok = pilih + lompat. **Tepi kiri/kanan bisa digeser** (snap 50 ms, dibatasi cue tetangga, min. 0,2 dtk, satu gerakan = satu undo). **Sisipkan cue** (tanpa geser): tombol di posisi putar atau ketuk dua kali area kosong; di dalam cue → dibelah (visual berlanjut), di celah → cue baru maks. 2 dtk. **Sisipkan & geser**: cue 2 dtk disisipkan (setelah cue di posisi putar) dan semua cue sesudahnya mundur 2 dtk, jadi selalu berhasil walau cue rapat. **Seret badan blok** = geser cue itu & semua sesudahnya (ripple, dibatasi cue sebelumnya). **Geser cue…**: semua cue atau mulai dari cue terpilih, ±detik atau "mulai di detik X", dengan pratinjau sebelum/sesudah. **Penanda posisi merah**: tekan & seret di penggaris (kursor geser). Hapus cue. Semua operasi = satu langkah undo |
| **Tab Setting** | Ukuran output, warna latar, lalu **ringkasan** *Subtitle global* (posisi + gaya default per baris) dan *Latar & audio* (musik, video latar *With audio*, ducking). Pengeditan keduanya di **modal panel samping**, jadi tata letak editor tidak bergeser dan pratinjau tetap terlihat. Default **2 gaya baris**; baris cue berikutnya memakai gaya baris terakhir; gaya tambahan ditambah/dihapus manual |
| **Tab Subtitle** | Waktu mulai/selesai cue terpilih, teks per baris bahasa, tambah/hapus baris, **gaya khusus cue per baris** (warna, ukuran, font; ✏️ membuka modal untuk garis tepi, tebal/miring, kotak latar) dengan **Reset** ke gaya global |
| **Tab Visual** | Visual & audio cue terpilih (fit, titik mulai klip, tahan/loop, suara asli, lanjutkan ke cue berikutnya) |
| Lain-lain | Unggah/unduh SRT di bawah tab. **Render video** di bilah atas membuka dialog render |

Gaya khusus cue disimpan di `cue.lineStyles[baris]` dan diterjemahkan ke **style ASS turunan** unik (`Slot1o1`, …),
bukan tag inline, sehingga kotak latar juga bisa di-override. Renderer browser dan ffmpeg membaca hal yang sama.

## Struktur

```
src/core/subtitle/        srt.ts (parser + ekspor + deteksi encoding), ass.ts (generator ASS), cjk.ts (font cadangan + pemotongan baris CJK)
src/core/render/fonts.ts  registri font (latin-v1, cjk-v1) + fontsForAss
src/core/auth/session.ts  sesi SSO (Zustand) via videokit-api /auth/me
src/components/           AppHeader, RequireAuth, AuthErrorNotice
src/features/registry.ts  daftar tool (kartu beranda + nama app di header)
src/features/subtitle-video/
  model.ts                dokumen project (schemaVersion 1), preset, batas
  spec-builder.ts         dokumen → Render Spec v1 + ASS (termasuk rentang pratinjau & skala)
  store.ts                Zustand: undo/redo, simpan otomatis
  storage.ts              IndexedDB: projects & media (Blob)
  media.ts                impor file lokal + metadata (mediabunny)
  run-render.ts           muat Blob → renderVideo
  playback.ts             status putar pratinjau (posisi, main/jeda), terpisah dari store dokumen
  ui/                     ProjectList, Editor, LivePlayer, Timeline, EditorTabs, DesignPanel, AudioBackgroundPanel, RenderPanel, MediaButton
src/app/subtitle-video/   rute /subtitle-video/ (?id=… membuka editor)
```

## Uji

| Uji | Hasil |
|---|---|
| Unit (vitest) | 38/38 — SRT (+ encoding CJK), ASS, CJK (font cadangan, kinsoku, tebak bahasa, pemilihan font), spec builder, timeline, amplop |
| `npm run e2e:render` (mesin + video latar ber-audio vs ffmpeg) | lulus, SSIM min. 0,974 — subtitle sampel kini memuat baris JP/KR/ZH (generator ASS produksi), cocok dengan ffmpeg |
| `npm run e2e:editor` (Chrome headless dikendalikan seperti pengguna) | lulus (v2: + pratinjau langsung tampil & berjalan, gaya khusus cue + Reset, sisip cue membelah, drag tepi cue + satu undo) — buat project → SRT → visual/audio cue → musik + video latar (with audio) → render 30 dtk dalam 8,1 dtk → MP4 1080×1920 H.264+AAC → project utuh setelah reload |

## Batasan MVP

- Project & media hanya di browser/perangkat ini, terpisah per akun (belum sinkron, belum riwayat cloud).
- Pratinjau dimulai dari awal audio cue walau rentang dimulai di tengah cue.
- Belum ada panduan safe area dan preset desain tersimpan. Cue belum bisa digeser utuh (hanya tepinya).
