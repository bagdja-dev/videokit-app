// Siapkan worker + wasm JASSUB di public/vendor/jassub/ dengan URL tetap.
// Alasan: worker JASSUB memakai import modul tanpa path (abslink, throughput) yang harus di-bundle,
// dan kita ingin URL worker/wasm deterministik (dipakai executor browser lewat workerUrl/wasmUrl).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('jassub/package.json'));
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const out = 'public/vendor/jassub';
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(pkgDir, 'dist/worker/worker.js')],
  bundle: true,
  format: 'esm',
  outfile: join(out, 'worker.js'),
  logLevel: 'warning',
});
// Worker pthread emscripten dimuat relatif terhadap worker.js
for (const f of ['jassub-worker.js', 'jassub-worker.wasm', 'jassub-worker-modern.wasm']) {
  copyFileSync(join(pkgDir, 'dist/wasm', f), join(out, f));
}
copyFileSync(join(pkgDir, 'dist/default.woff2'), join(out, 'default.woff2'));
console.log(`jassub ${version} → ${out}`);
