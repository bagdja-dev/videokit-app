// Dev server HTTPS untuk uji dari perangkat lain di LAN (tablet/HP): WebCodecs & OPFS hanya aktif di
// koneksi aman. Sertifikat dibuat mkcert untuk localhost + semua IP LAN mesin ini (sertifikat bawaan
// `--experimental-https` hanya untuk localhost sehingga ditolak saat dibuka lewat IP).
// Perangkat penguji harus memasang rootCA.pem dari `mkcert -CAROOT` sebagai sertifikat CA.
// Pakai: npm run dev:https   (PORT=3443 default)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.PORT ?? '3443';
const ips = Object.values(networkInterfaces()).flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
const dir = 'certs';
const key = join(dir, 'dev-key.pem');
const cert = join(dir, 'dev-cert.pem');
mkdirSync(dir, { recursive: true });

try {
  execFileSync('mkcert', ['-key-file', key, '-cert-file', cert, 'localhost', '127.0.0.1', ...ips], { stdio: 'inherit' });
} catch {
  console.error('mkcert tidak ditemukan. Pasang dulu: brew install mkcert && mkcert -install');
  process.exit(1);
}
if (!existsSync(cert)) process.exit(1);

const caRoot = execFileSync('mkcert', ['-CAROOT']).toString().trim();
console.log(`\nBuka dari perangkat lain: ${ips.map((ip) => `https://${ip}:${PORT}/dev/render-lab/`).join('  atau  ')}`);
console.log(`Perangkat itu perlu memasang CA: ${join(caRoot, 'rootCA.pem')}\n`);

const child = spawn('npx', ['next', 'dev', '--webpack', '-H', '0.0.0.0', '-p', PORT,
  '--experimental-https', '--experimental-https-key', key, '--experimental-https-cert', cert], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
