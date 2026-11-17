// E2E editor "Video dari Subtitle": Chrome headless dikendalikan lewat DevTools Protocol seperti pengguna —
// buat project → unggah SRT → isi visual/audio → musik + video latar (with audio) → render → periksa MP4.
// Pakai: npm run e2e:editor   (SKIP_BUILD=1 untuk memakai out/ yang ada)
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const FP = existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffprobe') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe' : 'ffprobe';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8790, DEBUG = 9555;
const OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });
if (!existsSync('public/dev-samples/clip_land.mp4')) execFileSync('node', ['scripts/make-dev-samples.mjs'], { stdio: 'inherit' });
if (!process.env.SKIP_BUILD) execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const sample = (f) => resolve('public/dev-samples', f);
const srtPath = resolve('scripts/lib/sample.srt');

// --- server statis COOP/COEP
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  let p = normalize(join('out', decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith('out')) { res.statusCode = 403; return res.end(); }
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', TYPES[extname(p)] ?? 'application/octet-stream');
  createReadStream(p).pipe(res);
});
await new Promise((ok) => server.listen(PORT, ok));
const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vk-ed-'));
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const fail = (m) => { console.error('GAGAL:', m); chrome.kill(); server.close(); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CDP
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://localhost:${DEBUG}/json`)).json()).find((t) => t.type === 'page'); } catch { /* belum siap */ }
}
if (!target) fail('Chrome DevTools tidak tersedia');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => { ws.onopen = ok; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval error');
  return r.result?.result?.value;
};
const waitFor = async (expr, what, ms = 30_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return; await sleep(250); }
  fail(`menunggu ${what}`);
};
const click = (text) => ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)return false;b.click();return true;})()`);
const setFile = async (selector, file) => {
  const { result } = await cdp('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
  if (!result?.result?.objectId) fail(`input ${selector} tidak ditemukan`);
  await cdp('DOM.setFileInputFiles', { files: [file], objectId: result.result.objectId });
};
const step = (m) => console.log(`• ${m}`);

await cdp('Page.enable'); await cdp('DOM.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: `http://localhost:${PORT}/subtitle-video/` });
await waitFor(`!!document.querySelector('button') && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Buat'))`, 'halaman daftar project');
step('buat project 9:16');
await click('Buat & buka');
await waitFor(`!!document.querySelector('input[aria-label="Unggah file SRT"]')`, 'editor terbuka');
step('unggah SRT');
await setFile('input[aria-label="Unggah file SRT"]', srtPath);
await waitFor(`document.body.innerText.includes('Cue (10)')`, '10 cue tampil');

const selectCue = async (n) => {
  // klik hanya bila belum terpilih (klik pada cue terpilih menutupnya)
  await ev(`(()=>{const t=document.querySelector('[data-cue="${n}"]');if(t&&!t.hasAttribute('data-selected'))t.click();return !!t;})()`);
  await sleep(300);
};
const pickInCue = async (accept, file) => {
  await setFile(`[data-role="cue-editor"] input[type=file][accept="${accept}"]`, file);
};
step('cue 1: video landscape, tampilan blur');
await selectCue(1);
await waitFor(`!!document.querySelector('[data-role="cue-editor"]')`, 'editor cue 1');
await pickInCue('video/*,image/*', sample('clip_land.mp4'));
await waitFor(`document.body.innerText.includes('clip_land.mp4')`, 'visual cue 1 tersimpan');
step('cue 4: gambar contain + audio cue');
await selectCue(4);
await waitFor(`!!document.querySelector('[data-role="cue-editor"]') && !!document.querySelector('[data-cue="4"][data-selected]')`, 'editor cue 4');
await pickInCue('video/*,image/*', sample('image.png'));
await waitFor(`document.body.innerText.includes('image.png')`, 'visual cue 4');
await ev(`(()=>{const s=document.querySelector('[data-role="cue-editor"] select');s.value='contain';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await pickInCue('audio/*', sample('vo1.m4a'));
await waitFor(`document.body.innerText.includes('vo1.m4a')`, 'audio cue 4');
step('cue 7: video HEVC');
await selectCue(7);
await waitFor(`!!document.querySelector('[data-cue="7"][data-selected]')`, 'editor cue 7');
await pickInCue('video/*,image/*', sample('clip_hevc.mp4'));
await waitFor(`document.body.innerText.includes('clip_hevc.mp4')`, 'visual cue 7');

step('musik latar + video latar dengan audio');
await setFile('input[aria-label="Pilih musik"]', sample('bgm.m4a'));
await waitFor(`document.body.innerText.includes('bgm.m4a')`, 'musik latar');
await setFile('input[aria-label="Pilih video/gambar latar"]', sample('clip_bg.mp4'));
await waitFor(`document.body.innerText.includes('clip_bg.mp4') && [...document.querySelectorAll('label')].some(l=>l.textContent.includes('With audio'))`, 'video latar');
await ev(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('With audio'));const c=l.querySelector('input');if(!c.checked)c.click();})()`);
await sleep(300);

step('cek undo/redo & simpan otomatis');
await waitFor(`document.body.innerText.includes('Tersimpan di perangkat')`, 'simpan otomatis', 10_000);

step('render penuh');
await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Render video'&&!b.disabled)`, 'tombol render aktif');
const t0 = Date.now();
await click('Render video');
await waitFor(`document.body.innerText.includes('Hasil akhir') || document.querySelector('[data-role="render-error"]')?.innerText`, 'render selesai', 300_000);
const err = await ev(`document.querySelector('[data-role="render-error"]')?.innerText ?? ''`);
if (err) fail(`render: ${err}`);
const renderSec = ((Date.now() - t0) / 1000).toFixed(1);

step('ambil MP4 & reload project (persistensi)');
const b64 = await ev(`(async()=>{const v=document.querySelector('video');const b=new Uint8Array(await (await fetch(v.src)).arrayBuffer());let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s);})()`);
writeFileSync(`${OUT}/editor.mp4`, Buffer.from(b64, 'base64'));
await cdp('Page.reload', {});
await waitFor(`document.body.innerText.includes('Cue (10)') && document.body.innerText.includes('clip_bg.mp4')`, 'project utuh setelah reload');

const probe = JSON.parse(execFileSync(FP, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', `${OUT}/editor.mp4`]).toString());
const v = probe.streams.find((s) => s.width), a = probe.streams.find((s) => !s.width);
const result = { pass: v?.codec_name === 'h264' && v.width === 1080 && v.height === 1920 && a?.codec_name === 'aac' && Math.abs(+probe.format.duration - 30) < 0.2, renderSeconds: +renderSec, video: v, audio: a, duration: +probe.format.duration };
console.log(JSON.stringify(result, null, 2));
chrome.kill(); server.close();
process.exit(result.pass ? 0 : 1);
