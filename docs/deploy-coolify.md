# Deploy VideoKit ke Coolify

VideoKit terdiri dari dua resource di Coolify. Keduanya dibangun dari Dockerfile masing-masing repo dan
mendengarkan **port 3000**.

| Resource | Repo / branch | Domain (contoh) | Isi image |
|---|---|---|---|
| App | `bagdja-dev/videokit-app` · `main` | `videokit.bagdja.com` | nginx + file statis (`out/`), tanpa proses Node |
| API | `bagdja-dev/videokit-api` · `main` | `videokit-api.bagdja.com` | NestJS satu proses |

`videokit-poc` **tidak** di-deploy. Itu alat uji Fase 0 yang dijalankan lokal.

## Syarat domain

App dan API **harus satu situs** (`*.bagdja.com`). Cookie sesi login (`vk_session`, `SameSite=Lax`) dipasang oleh
API dan hanya terkirim pada permintaan dari situs yang sama. Di domain sementara bawaan Coolify (`*.sslip.io`),
halaman tetap tampil tetapi login tidak berfungsi.

## App (`videokit-app`)

- Build Pack: **Dockerfile**. Port: **3000**. Healthcheck: `GET /healthz`.
- Environment Variables (centang **Build Variable**):

  | Nama | Nilai |
  |---|---|
  | `NEXT_PUBLIC_VIDEOKIT_API_URL` | `https://videokit-api.bagdja.com` |

  Nilainya di-inline saat build. Setiap kali diubah, lakukan **Redeploy**.
- `deploy/nginx.conf` mengirim **COOP/COEP** di semua respons. Header ini wajib: JASSUB (subtitle) butuh
  `crossOriginIsolated`, dan thumbnail avatar dari R2 dimuat dengan CORS. Jangan menimpa header ini di proxy
  Coolify/Traefik.
- Saat build, `npm run vendor` mengunduh JASSUB, font CJK (±36 MB), dan MediaPipe dengan SHA-256 terkunci. Server
  build butuh akses internet ke `raw.githubusercontent.com` dan `storage.googleapis.com`.

## API (`videokit-api`)

- Build Pack: **Dockerfile**. Port: **3000**. Healthcheck: `GET /health`.
- Environment Variables (runtime, simpan secret sebagai variabel tersembunyi):

  | Nama | Nilai |
  |---|---|
  | `NODE_ENV` | `production` |
  | `API_PUBLIC_URL` | `https://videokit-api.bagdja.com` |
  | `APP_URL` | `https://videokit.bagdja.com` |
  | `APP_ORIGINS` | kosong, kecuali ada origin app lain di `*.bagdja.com` |
  | `BAGDJA_AUTH_API` | `https://auth.bagdja.com` |
  | `JWKS_URL` | `https://auth.bagdja.com/.well-known/jwks.json` |
  | `BAGDJA_LOGIN_URL` | `https://login.bagdja.com` |
  | `CLIENT_APP_ID` / `CLIENT_APP_SECRET` | client app VideoKit (bagdja-console) |
  | `DATABASE_URL` | Supabase Postgres |
  | `BAGDJA_STORAGE_API` | `https://storage.bagdja.com` |
  | `BAGDJA_LOG_URL` | `https://log.bagdja.com` |
  | `SWAGGER_USER` / `SWAGGER_PASSWORD` | **isi**. Kalau kosong, `/docs` terbuka untuk publik |

  `PORT` tidak perlu diisi karena Dockerfile sudah memakai 3000.
- Migration database **tidak** berjalan di container. Jalankan `npm run db:migrate` secara manual dari mesin dev
  dengan `DATABASE_URL` produksi, dan hanya dengan izin.

## Di luar Coolify

1. **bagdja-console**: tambahkan redirect URI `https://videokit-api.bagdja.com/auth/callback` ke client app
   VideoKit.
2. **R2 bucket privat (`bagdja-private`)**: CORS mengizinkan `PUT`, `GET`, dan `HEAD` dari
   `https://videokit.bagdja.com`, dengan header `Content-Type` dan `Range`.
3. **storage-service**: harus memakai versi dengan presigned upload (`feat/presigned-upload`) dan migration
   `20261117000000_add_files_upload_status.sql`.

## Verifikasi setelah deploy

- `https://videokit-api.bagdja.com/health` → `authConfigured: true`, `databaseConfigured: true`.
- Buka `https://videokit.bagdja.com`. Di DevTools Console, `crossOriginIsolated` harus bernilai `true`.
- Klik **Masuk**, login lewat SSO, dan pastikan profil muncul di header.
- Buka **Avatar Rekam**, unggah `.vrm`, lalu reload. Avatar dan thumbnail harus tetap ada.
