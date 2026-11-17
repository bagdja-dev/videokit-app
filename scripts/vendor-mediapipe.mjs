// Siapkan MediaPipe Face Landmarker di public/vendor/mediapipe/: wasm dari paket npm + model .task (diunduh,
// SHA-256 terkunci). Disajikan sendiri (bukan CDN) karena halaman memakai COEP require-corp, dan agar versi pasti.
// Sampel avatar dev (Seed-san, VRM Public License 1.0, VirtualCast) → public/dev-samples/avatar/.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(require.resolve('@mediapipe/tasks-vision')), '.');
const out = 'public/vendor/mediapipe';
mkdirSync(out, { recursive: true });
for (const f of readdirSync(join(pkgDir, 'wasm'))) copyFileSync(join(pkgDir, 'wasm', f), join(out, f));

const sha = (b) => createHash('sha256').update(b).digest('hex');
async function fetchPinned(url, dest, hash) {
  if (existsSync(dest) && sha(readFileSync(dest)) === hash) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal mengunduh ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== hash) throw new Error(`Checksum ${dest} tidak cocok — berkas ditolak`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return true;
}
await fetchPinned(
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  join(out, 'face_landmarker.task'),
  '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
);
await fetchPinned(
  'https://raw.githubusercontent.com/vrm-c/vrm-specification/94e82dd346fa6cf0337c4421728640e5252dd38e/samples/Seed-san/vrm/Seed-san.vrm',
  'public/dev-samples/avatar/Seed-san.vrm',
  '624d0d554bc205bbdc33e22a68a2c3c20edebb3e573011ead8878a65e5329b23',
);
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
console.log(`mediapipe tasks-vision ${version} + face_landmarker.task → ${out}`);
