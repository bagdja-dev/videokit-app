# Bagdja VideoKit App — static export (Next.js `output: 'export'`) disajikan nginx. Tanpa server aplikasi Node.
# Image untuk Coolify, port 3000 (standar ekosistem).
#
# PENTING: nginx WAJIB mengirim COOP/COEP (deploy/nginx.conf) — JASSUB multi-thread (subtitle) butuh
# crossOriginIsolated; dan aset lintas origin (thumbnail avatar di R2) dimuat dengan CORS.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev --ignore-scripts --no-audit --no-fund
COPY . .
# NEXT_PUBLIC_* di-inline ke bundle saat build → isi sebagai BUILD ARG di Coolify.
ARG NEXT_PUBLIC_VIDEOKIT_API_URL
ENV NEXT_PUBLIC_VIDEOKIT_API_URL=$NEXT_PUBLIC_VIDEOKIT_API_URL
# Sampel dev (avatar contoh dsb.) tidak ikut image produksi.
ENV VK_SKIP_DEV_SAMPLES=1
# prebuild → npm run vendor: JASSUB worker/wasm, font CJK, MediaPipe (semua dengan SHA-256 terkunci).
RUN npm run build && rm -rf out/dev-samples

FROM nginx:1.28.3-alpine AS production
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/out /usr/share/nginx/html
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
