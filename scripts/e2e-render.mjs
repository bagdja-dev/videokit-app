// E2E executor browser: next build (static export) → server statis COOP/COEP → Chrome headless membuka
// /dev/render-lab/?auto=1 → hasil MP4 dibandingkan dengan renderer referensi ffmpeg (SSIM + audio).
// Pakai: npm run e2e:render   (SKIP_BUILD=1 untuk memakai out/ yang sudah ada; batas lolos SSIM ≥ 0.95)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { mockApiBuildEnv, startMockAuthApi } from './lib/mock-auth-api.mjs';

const FF = process.env.FFMPEG ?? (existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' : 'ffmpeg');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = +(process.env.PORT ?? 8788);
const MIN_SSIM = +(process.env.MIN_SSIM ?? 0.95);
const OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });

if (!existsSync('public/dev-samples/spec.json')) execFileSync('node', ['scripts/make-dev-samples.mjs'], { stdio: 'inherit' });
if (!process.env.SKIP_BUILD) execFileSync('npm', ['run', 'build'], { stdio: 'inherit', env: mockApiBuildEnv() });
// SKIP_REFERENCE=1: hanya ukur executor browser (mis. uji ketahanan 10 menit).
if (!process.env.SKIP_REFERENCE) execFileSync('node', ['scripts/render-reference.mjs', 'public/dev-samples/spec.json', `${OUT}/reference.mp4`], { stdio: 'inherit' });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ass': 'text/plain', '.txt': 'text/plain' };
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
let resolveReport;
const reportP = new Promise((r) => { resolveReport = r; });

const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/__e2e/upload') { writeFileSync(`${OUT}/browser.mp4`, await body(req)); return res.end('ok'); }
  if (req.method === 'POST' && url.pathname === '/__e2e/report') { const r = JSON.parse((await body(req)).toString()); writeFileSync(`${OUT}/browser-report.json`, JSON.stringify(r, null, 2)); res.end('ok'); return resolveReport(r); }
  let p = normalize(join('out', decodeURIComponent(url.pathname)));
  if (!p.startsWith('out')) { res.statusCode = 403; return res.end(); }
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.statusCode = 404; return res.end('not found'); }
  const st = statSync(p);
  res.setHeader('Content-Type', TYPES[extname(p)] ?? 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const s = range[1] ? +range[1] : 0, e = range[2] ? +range[2] : st.size - 1;
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${s}-${e}/${st.size}`);
    res.setHeader('Content-Length', e - s + 1);
    return createReadStream(p, { start: s, end: e }).pipe(res);
  }
  res.setHeader('Content-Length', st.size);
  createReadStream(p).pipe(res);
});
await new Promise((ok) => server.listen(PORT, ok));
// Render Lab berada di balik login → API tiruan yang selalu login.
const mockApi = await startMockAuthApi({ mode: 'always', appOrigin: `http://localhost:${PORT}` });
const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vk-e2e-'));
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  `http://localhost:${PORT}/dev/render-lab/?auto=1${process.env.E2E_QS ? '&' + process.env.E2E_QS : ''}`], { stdio: 'ignore' });
const timer = setTimeout(() => { console.error('TIMEOUT'); chrome.kill(); process.exit(2); }, +(process.env.TIMEOUT_MS ?? 900_000));
const report = await reportP;
clearTimeout(timer);
chrome.kill();
server.close();
mockApi.server.close();
if (!report.ok) { console.error('Render browser gagal:', report.error); process.exit(1); }
if (process.env.SKIP_REFERENCE) {
  const r = { pass: true, reference: 'dilewati', browser: report.stats, jsHeapMB: report.jsHeapMB, userAgent: report.userAgent };
  writeFileSync(`${OUT}/e2e-report.json`, JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

// Bandingkan per segmen
const spec = JSON.parse(readFileSync('public/dev-samples/spec.json', 'utf8'));
// SSIM per frame untuk seluruh video (tanpa seek → pasangan frame pasti tepat), lalu dirata-rata per rentang.
const perFrameSsim = (crop = '') => {
  const c = crop ? `,crop=${crop}` : '';
  const stats = `${OUT}/ssim-${crop ? 'sub' : 'full'}.txt`;
  spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', `${OUT}/browser.mp4`, '-i', `${OUT}/reference.mp4`,
    '-lavfi', `[0:v]format=yuv420p${c}[a];[1:v]format=yuv420p${c}[b];[a][b]ssim=stats_file=${stats}`, '-f', 'null', '-']);
  return readFileSync(stats, 'utf8').trim().split('\n').map((l) => +(/All:([\d.]+)/.exec(l)?.[1] ?? 0));
};
const { width: W, height: H } = spec.output;
const subCrop = `${W}:${Math.round(H * 0.3)}:0:${Math.round(H * 0.6)}`;
const fullSsim = perFrameSsim();
const subSsim = perFrameSsim(subCrop);
const FPS = spec.output.fps;
const avg = (arr, a, b) => { const sl = arr.slice(Math.round((a * FPS) / 1000), Math.round((b * FPS) / 1000)); return +(sl.reduce((x, y) => x + y, 0) / Math.max(1, sl.length)).toFixed(6); };
const firstBlock = spec.video_track.filter((s) => s.end_ms <= 30_000);
// Rentang yang diuji: tiap segmen + rentang kosong (hanya lapisan latar) bila ada.
const spans = firstBlock.map((s) => ({ name: s.input ?? s.color, fit: s.fit ?? '-', a: s.start_ms, b: s.end_ms }));
const blockEnd = Math.min(30_000, spec.output.duration_ms);
let cur = 0;
for (const s of [...spans].sort((x, y) => x.a - y.a)) { if (s.a > cur) spans.push({ name: 'latar', fit: spec.background?.fit ?? '-', a: cur, b: s.a }); cur = Math.max(cur, s.b); }
if (cur < blockEnd) spans.push({ name: 'latar', fit: spec.background?.fit ?? '-', a: cur, b: blockEnd });
const segments = spans.sort((x, y) => x.a - y.a).map((s) => ({
  segment: s.name, fit: s.fit, from_ms: s.a, to_ms: s.b, ssim: avg(fullSsim, s.a, s.b), ssim_subtitle: avg(subSsim, s.a, s.b),
}));
const rms = (f) => [...spawnSync(FF, ['-hide_banner', '-i', f, '-af', 'asetnsamples=24000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1e8 }).stderr
  .matchAll(/RMS_level=(-?[\d.inf]+)/g)].map((m) => (m[1].includes('inf') ? -120 : +m[1]));
const ra = rms(`${OUT}/browser.mp4`), rb = rms(`${OUT}/reference.mp4`);
const n = Math.min(ra.length, rb.length);
const diffs = Array.from({ length: n }, (_, i) => Math.abs(ra[i] - rb[i]));
const audio = { mean_rms_diff_db: +(diffs.reduce((a, b) => a + b, 0) / n).toFixed(2), max_rms_diff_db: +Math.max(...diffs).toFixed(2) };
const minSsim = Math.min(...segments.flatMap((s) => [s.ssim, s.ssim_subtitle]));
const result = { pass: minSsim >= MIN_SSIM && audio.mean_rms_diff_db < 1, min_ssim: minSsim, segments, audio, browser: report.stats, jsHeapMB: report.jsHeapMB, userAgent: report.userAgent, crossOriginIsolated: report.crossOriginIsolated };
writeFileSync(`${OUT}/e2e-report.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
