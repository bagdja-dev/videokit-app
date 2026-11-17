// Unduh paket font cjk-v1 (Noto Sans CJK SubsetOTF, lisensi OFL) ke public/fonts/cjk-v1/.
// Tidak di-commit (±36 MB). Dikunci ke satu commit notofonts/noto-cjk + SHA-256 per file, dan dilewati bila sudah ada.
// Produksi: berkas yang sama disajikan dari CDN/storage (dicatat di docs/fase-3-cjk.md).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMIT = 'f8d157532fbfaeda587e826d4cd5b21a49186f7c';
const BASE = `https://raw.githubusercontent.com/notofonts/noto-cjk/${COMMIT}/Sans`;
const OUT = 'public/fonts/cjk-v1';
const FILES = {
  'NotoSansKR-Regular.otf': ['SubsetOTF/KR', '69975a0ac8472717870aefeab0a4d52739308d90856b9955313b2ad5e0148d68'],
  'NotoSansKR-Bold.otf': ['SubsetOTF/KR', '5a6ceb287ed2fc6cfc6213144ebea68cbd94b20fc9eb873d8486493bf02d9bda'],
  'NotoSansJP-Regular.otf': ['SubsetOTF/JP', 'dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073'],
  'NotoSansJP-Bold.otf': ['SubsetOTF/JP', '1b0edfb500b73a4fa8a4fcaae1bbbd403994e08e73e3e0da37e70d3853f42c5f'],
  'NotoSansSC-Regular.otf': ['SubsetOTF/SC', 'faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9'],
  'NotoSansSC-Bold.otf': ['SubsetOTF/SC', 'c6cb5a93abaa9edc8ee7463b7ebb7f42d618d40e6ed2f7a5371c97b0b64767c0'],
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

mkdirSync(OUT, { recursive: true });
let fetched = 0;
for (const [name, [dir, hash]] of Object.entries(FILES)) {
  const dest = join(OUT, name);
  if (existsSync(dest) && sha(readFileSync(dest)) === hash) continue;
  const res = await fetch(`${BASE}/${dir}/${name}`);
  if (!res.ok) throw new Error(`Gagal mengunduh ${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== hash) throw new Error(`Checksum ${name} tidak cocok — berkas ditolak`);
  writeFileSync(dest, buf);
  fetched++;
}
const license = join(OUT, 'OFL-NotoSansCJK.txt');
if (!existsSync(license)) {
  const res = await fetch(`${BASE}/LICENSE`);
  if (res.ok) writeFileSync(license, Buffer.from(await res.arrayBuffer()));
}
console.log(`font cjk-v1: ${fetched ? `${fetched} diunduh` : 'sudah lengkap'} → ${OUT}`);
