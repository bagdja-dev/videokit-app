# Fase 3 — Editor MVP "Video dari Subtitle" (17 Nov 2026)

MVP **tanpa server**: semua berjalan di browser pengguna — dokumen project & file media di IndexedDB, render
dengan executor browser (Fase 2). videokit-api (Fase 1) menyusul untuk login, simpan lintas perangkat, preset bersama,
riwayat render, dan render server.

## Fitur

| Area | Isi |
|---|---|
| Project | Daftar project lokal, buat baru dengan preset 9:16 / 16:9 / 1:1 / 4:5, judul, ganti preset kapan saja |
| SRT | Unggah (UTF-8/BOM, cadangan Windows-1252), peringatan (tumpang tindih dipotong, waktu salah dilewati, tag HTML dibuang), ganti SRT, unduh SRT hasil edit, maks. 1.500 cue |
| Cue | Daftar cue + editor cue terpilih: teks per baris bahasa, visual video/gambar (fit: penuh / utuh / utuh + blur), titik mulai klip, klip pendek (tahan/loop), suara asli klip, "lanjutkan ke cue berikutnya", audio cue + volume |
| Desain | Posisi blok (bawah/tengah/atas), margin; per baris bahasa: font (Poppins, Bebas Neue), ukuran, warna, garis tepi, tebal/miring, kotak latar + opasitas |
| Latar | Musik latar + volume; **video/gambar latar** (loop, tampil pada cue tanpa visual & area kosong `contain`) + **With audio** + volume; level ducking |
| Pratinjau & render | Pratinjau cue terpilih (resolusi ½, ±8 dtk) memakai mesin render yang sama → WYSIWYG; render penuh + progres + batal + unduh MP4; peringatan bila perangkat tidak mampu / melebihi batas durasi |
| Editor | Undo/redo (tombol & Ctrl/Cmd+Z), simpan otomatis ke IndexedDB, responsif |

Aturan visual: visual cue tampil dari awal cue sampai cue berikutnya mulai (jeda ditahan); cue pertama mulai dari
detik 0; cue tanpa visual → video latar, atau warna latar bila tidak ada.

## Struktur

```
src/core/subtitle/        srt.ts (parser + ekspor), ass.ts (generator ASS + daftar font latin-v1)
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
| Unit (vitest) | 24/24 — SRT, ASS, spec builder (penahanan visual, latar + audio, pratinjau rentang), timeline, amplop |
| `npm run e2e:render` (mesin + video latar ber-audio vs ffmpeg) | lulus, SSIM min. 0,975 termasuk rentang latar saja |
| `npm run e2e:editor` (Chrome headless dikendalikan seperti pengguna) | lulus — buat project → SRT → visual/audio cue → musik + video latar (with audio) → render 30 dtk dalam 8,1 dtk → MP4 1080×1920 H.264+AAC → project utuh setelah reload |

## Batasan MVP

- Project & media hanya di browser/perangkat ini (belum login, belum sinkron, belum riwayat cloud).
- Pratinjau dimulai dari awal audio cue walau rentang dimulai di tengah cue.
- Belum ada timeline grafis (daftar cue vertikal), belum ada panduan safe area, belum ada preset desain tersimpan.
