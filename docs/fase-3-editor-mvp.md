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

## Struktur

```
src/core/subtitle/        srt.ts (parser + ekspor + deteksi encoding), ass.ts (generator ASS), cjk.ts (font cadangan + pemotongan baris CJK)
src/core/render/fonts.ts  registri font (latin-v1, cjk-v1) + fontsForAss
src/features/subtitle-video/
  model.ts                dokumen project (schemaVersion 1), preset, batas
  spec-builder.ts         dokumen → Render Spec v1 + ASS (termasuk rentang pratinjau & skala)
  store.ts                Zustand: undo/redo, simpan otomatis
  storage.ts              IndexedDB: projects & media (Blob)
  media.ts                impor file lokal + metadata (mediabunny)
  run-render.ts           muat Blob → renderVideo
  ui/                     ProjectList, Editor, CueList, DesignPanel, AudioBackgroundPanel, RenderPanel, MediaButton
src/app/subtitle-video/   rute /subtitle-video/ (?id=… membuka editor)
```

## Uji

| Uji | Hasil |
|---|---|
| Unit (vitest) | 38/38 — SRT (+ encoding CJK), ASS, CJK (font cadangan, kinsoku, tebak bahasa, pemilihan font), spec builder, timeline, amplop |
| `npm run e2e:render` (mesin + video latar ber-audio vs ffmpeg) | lulus, SSIM min. 0,974 — subtitle sampel kini memuat baris JP/KR/ZH (generator ASS produksi), cocok dengan ffmpeg |
| `npm run e2e:editor` (Chrome headless dikendalikan seperti pengguna) | lulus — buat project → SRT → visual/audio cue → musik + video latar (with audio) → render 30 dtk dalam 8,1 dtk → MP4 1080×1920 H.264+AAC → project utuh setelah reload |

## Batasan MVP

- Project & media hanya di browser/perangkat ini (belum login, belum sinkron, belum riwayat cloud).
- Pratinjau dimulai dari awal audio cue walau rentang dimulai di tengah cue.
- Belum ada timeline grafis (daftar cue vertikal), belum ada panduan safe area, belum ada preset desain tersimpan.
