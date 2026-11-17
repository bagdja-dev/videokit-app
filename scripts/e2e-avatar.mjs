// E2E PoC Avatar (Fase A0): build → server statis COOP/COEP → Chrome headless membuka /dev/avatar-lab/?auto=1 →
// model Face Landmarker dimuat, uji determinisme avatar di worker (2 worker, 90 frame), render 10 dtk MP4 dengan
// video konten + avatar + suara → MP4 diperiksa ffprobe & frame diekstrak.
// Pakai: npm run e2e:avatar   (SKIP_BUILD=1 untuk memakai out/ yang ada)
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { mockApiBuildEnv, startMockAuthApi } from './lib/mock-auth-api.mjs';

const FF = existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' : 'ffmpeg';
const FP = existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffprobe') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe' : 'ffprobe';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8792;
const OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });
if (!existsSync('public/dev-samples/clip_land.mp4')) execFileSync('node', ['scripts/make-dev-samples.mjs'], { stdio: 'inherit' });
if (!process.env.SKIP_BUILD) execFileSync('npm', ['run', 'build'], { stdio: 'inherit', env: mockApiBuildEnv() });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.png': 'image/png', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.vrm': 'model/gltf-binary', '.task': 'application/octet-stream' };
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
let resolveReport;
const reportP = new Promise((r) => { resolveReport = r; });
const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/__e2e/upload') { writeFileSync(`${OUT}/avatar.mp4`, await body(req)); return res.end('ok'); }
  if (req.method === 'POST' && url.pathname === '/__e2e/report') { const r = JSON.parse((await body(req)).toString()); res.end('ok'); return resolveReport(r); }
  let p = normalize(join('out', decodeURIComponent(url.pathname)));
  if (!p.startsWith('out')) { res.statusCode = 403; return res.end(); }
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[extname(p)] ?? 'application/octet-stream');
  res.setHeader('Content-Length', statSync(p).size);
  createReadStream(p).pipe(res);
});
await new Promise((ok) => server.listen(PORT, ok));
const mockApi = await startMockAuthApi({ mode: 'always', appOrigin: `http://localhost:${PORT}` });
const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vk-av-'));
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  `http://localhost:${PORT}/dev/avatar-lab/?auto=1`], { stdio: 'ignore' });
const timer = setTimeout(() => { console.error('TIMEOUT'); chrome.kill('SIGKILL'); process.exit(2); }, +(process.env.TIMEOUT_MS ?? 300_000));
const report = await reportP;
clearTimeout(timer);
chrome.kill('SIGKILL'); server.close(); mockApi.server.close();

let probe = null;
if (existsSync(`${OUT}/avatar.mp4`)) {
  probe = JSON.parse(execFileSync(FP, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', `${OUT}/avatar.mp4`]).toString());
  for (const t of [1, 4, 8]) execFileSync(FF, ['-v', 'error', '-y', '-ss', String(t), '-i', `${OUT}/avatar.mp4`, '-frames:v', '1', '-vf', 'scale=960:-1', `${OUT}/avatar_${t}s.png`]);
}
const v = probe?.streams.find((s) => s.width), a = probe?.streams.find((s) => !s.width);
const pass = !!report.ok && v?.codec_name === 'h264' && a?.codec_name === 'aac' && Math.abs(+probe.format.duration - 10) < 0.2;
const out = { pass, ...report, mp4: probe && { video: v, audio: a, duration: +probe.format.duration } };
writeFileSync(`${OUT}/e2e-avatar.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
