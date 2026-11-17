import type { NextConfig } from 'next';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

// Static export: tanpa server aplikasi (VideoKit overview §2.7). Hosting statis wajib mengirim
// header COOP/COEP di bawah agar JASSUB bisa multi-thread; tanpa itu ia jatuh ke mode satu thread.
const isolationHeaders = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
];

// Uji dari perangkat lain di jaringan lokal (mis. tablet): Next dev memblokir aset /_next untuk origin
// selain localhost. Izinkan IP LAN mesin ini + tambahan dari VK_DEV_ORIGINS (dipisah koma). Hanya untuk `next dev`.
const lanOrigins = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => n!.address);
const extraOrigins = (process.env.VK_DEV_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: [...lanOrigins, ...extraOrigins],
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // Folder induk (bagdja/) punya package-lock.json sendiri; kunci akar workspace ke app ini.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
  // JASSUB berisi `new Worker(new URL(...))` cadangan; kita selalu memberi workerUrl ke public/vendor/jassub,
  // jadi webpack tidak perlu mem-bundle worker itu (menghindari peringatan circular chunk em-pthread/jassub-worker).
  webpack(config) {
    config.module.rules.push({ test: /[\\/]node_modules[\\/]jassub[\\/]/, parser: { worker: false } });
    return config;
  },
  // Hanya berlaku di `next dev`; untuk produksi header dipasang di hosting statis.
  async headers() {
    return process.env.NODE_ENV === 'development' ? [{ source: '/:path*', headers: isolationHeaders }] : [];
  },
};

export default nextConfig;
