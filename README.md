# bagdja-videokit-app

Aplikasi web **Bagdja VideoKit** — kumpulan tool pembuat video (`videokit.bagdja.com`). Plan: `plan/videokit/`.

## Status

- **Fase 2 (executor browser)** — inti selesai: `src/core/render`. Laporan: [`docs/fase-2-executor-browser.md`](docs/fase-2-executor-browser.md).
- Halaman kartu tool `/` (placeholder) dan halaman uji internal `/dev/render-lab/`.

## Menjalankan

```bash
npm install --ignore-scripts
npm run samples      # sampel dev (butuh ffmpeg dengan libass)
npm run dev          # http://localhost:3000/dev/render-lab/
npm test             # unit test
npm run typecheck && npm run lint
npm run e2e:render   # uji E2E render browser vs referensi ffmpeg
npm run build        # static export ke out/
```

## Deploy

Static export (`out/`) di hosting statis (Cloudflare Pages / R2 / Caddy). Hosting **wajib** mengirim header:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

agar subtitle (JASSUB) berjalan multi-thread. Seluruh aset (media, font, wasm) harus same-origin atau mengirim
`Cross-Origin-Resource-Policy`/CORS yang sesuai.

## Keputusan yang menyimpang dari standar org (disengaja)

| Standar org | Di repo ini | Alasan |
|---|---|---|
| Komponen Kendo React | CSS module + token warna sendiri | Editor timeline/preview video dibuat khusus; Kendo tidak menyediakan komponennya (keputusan stack 17 Nov 2026) |
| State Redux/Zustand | Zustand | Sesuai standar (dipakai mulai Fase 3) |
| Backend .NET | — (app statis); API = NestJS di `bagdja-videokit-api` | Mengikuti ekosistem Bagdja yang berjalan |
| Bundler default Next (Turbopack) | `--webpack` | Turbopack macet saat build (lihat laporan Fase 2, temuan #6) |
