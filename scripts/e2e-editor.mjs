// E2E editor "Video dari Subtitle": Chrome headless dikendalikan lewat DevTools Protocol seperti pengguna —
// buat project → unggah SRT → isi visual/audio → musik + video latar (with audio) → render → periksa MP4.
// Pakai: npm run e2e:editor   (SKIP_BUILD=1 untuk memakai out/ yang ada)
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { MOCK_USER, mockApiBuildEnv, startMockAuthApi } from './lib/mock-auth-api.mjs';

const FP = existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffprobe') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe' : 'ffprobe';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8790, DEBUG = 9555;
const OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });
if (!existsSync('public/dev-samples/clip_land.mp4')) execFileSync('node', ['scripts/make-dev-samples.mjs'], { stdio: 'inherit' });
if (!process.env.SKIP_BUILD) execFileSync('npm', ['run', 'build'], { stdio: 'inherit', env: mockApiBuildEnv() });
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
const mockApi = await startMockAuthApi({ mode: 'flow', appOrigin: `http://localhost:${PORT}` });
const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vk-ed-'));
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const fail = (m) => { console.error('GAGAL:', m); chrome.kill(); server.close(); mockApi.server.close(); process.exit(1); };
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
step('beranda publik: header tampil, belum login → tombol Masuk');
await cdp('Page.navigate', { url: `http://localhost:${PORT}/` });
await waitFor(`!!document.querySelector('header a[href*="/auth/login"]') && document.body.innerText.includes('Video dari Subtitle')`, 'beranda + tombol Masuk');
step('buka tool tanpa login → dialihkan ke login → kembali ke tool');
await cdp('Page.navigate', { url: `http://localhost:${PORT}/subtitle-video/` });
await waitFor(`location.pathname === '/subtitle-video/' && document.body.innerText.includes(${JSON.stringify(MOCK_USER.username)})`, 'kembali dari login, profil di header', 20_000);
if (mockApi.stats.logins !== 1) fail(`login dipanggil ${mockApi.stats.logins}× (harus 1)`);
const headerApp = await ev(`[...document.querySelectorAll('header span')].map(s=>s.textContent).includes('Video dari Subtitle')`);
if (!headerApp) fail('nama app aktif tidak tampil di tengah header');
await waitFor(`!!document.querySelector('button') && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Buat'))`, 'halaman daftar project');
step('buat project 9:16');
await click('Buat & buka');
await waitFor(`!!document.querySelector('input[aria-label="Unggah file SRT"]')`, 'editor terbuka');
step('unggah SRT');
await setFile('input[aria-label="Unggah file SRT"]', srtPath);
const cueCount = `document.querySelectorAll('[data-cue]').length`;
await waitFor(`${cueCount} === 10`, '10 cue di timeline');

const tab = (name) => ev(`[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent===${JSON.stringify(name)}).click()`);
const selectCue = async (n) => { await ev(`document.querySelector('[data-cue="${n}"]').click()`); await sleep(250); };
const pickVisual = (accept, file) => setFile(`[data-role="visual-editor"] input[type=file][accept="${accept}"]`, file);
// piksel non-hitam di pratinjau langsung (kanvas 2D, bisa dibaca)
const livePixels = `(()=>{const c=document.querySelector('[data-role="live-preview"]');const x=c.getContext('2d');const d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let p=0;p<d.length;p+=16)if(d[p]+d[p+1]+d[p+2]>60)n++;return n/(d.length/16);})()`;

step('tab Visual: cue 1 video landscape (blur)');
await selectCue(1);
await tab('Visual');
await waitFor(`!!document.querySelector('[data-role="visual-editor"]')`, 'tab visual');
await pickVisual('video/*,image/*', sample('clip_land.mp4'));
await waitFor(`document.body.innerText.includes('clip_land.mp4')`, 'visual cue 1 tersimpan');
step('cue 4: gambar contain + audio cue');
await selectCue(4);
await waitFor(`!!document.querySelector('[data-cue="4"][data-selected]')`, 'cue 4 terpilih');
await pickVisual('video/*,image/*', sample('image.png'));
await waitFor(`document.body.innerText.includes('image.png')`, 'visual cue 4');
await ev(`(()=>{const s=document.querySelector('[data-role="visual-editor"] select');s.value='contain';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await pickVisual('audio/*', sample('vo1.m4a'));
await waitFor(`document.body.innerText.includes('vo1.m4a')`, 'audio cue 4');
step('cue 7: video HEVC');
await selectCue(7);
await waitFor(`!!document.querySelector('[data-cue="7"][data-selected]')`, 'cue 7 terpilih');
await pickVisual('video/*,image/*', sample('clip_hevc.mp4'));
await waitFor(`document.body.innerText.includes('clip_hevc.mp4')`, 'visual cue 7');

const closeModal = () => ev(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Selesai').click()`);
step('tab Setting → modal Latar & audio: musik + video latar dengan audio');
await tab('Setting');
await ev(`document.querySelector('[data-role="open-audio"]').click()`);
await waitFor(`!!document.querySelector('dialog[open][data-role="audio-modal"]')`, 'modal latar & audio', 5000);
await setFile('input[aria-label="Pilih musik"]', sample('bgm.m4a'));
await waitFor(`document.body.innerText.includes('bgm.m4a')`, 'musik latar');
await setFile('input[aria-label="Pilih video/gambar latar"]', sample('clip_bg.mp4'));
await waitFor(`document.body.innerText.includes('clip_bg.mp4') && [...document.querySelectorAll('label')].some(l=>l.textContent.includes('With audio'))`, 'video latar');
await ev(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('With audio'));const c=l.querySelector('input');if(!c.checked)c.click();})()`);
await sleep(300);
for (const [name, w, h] of [['editor-v2-modal', 1440, 1000]]) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await cdp('Page.captureScreenshot', { format: 'png' }).then((r) => writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')));
}
await cdp('Emulation.clearDeviceMetricsOverride');
await closeModal();
await waitFor(`!document.querySelector('dialog[open]') && document.querySelector('[data-role="summary-audio"]').innerText.includes('clip_bg.mp4') && document.querySelector('[data-role="summary-audio"]').innerText.includes('dengan audio')`, 'ringkasan latar & audio', 5000);

step('pratinjau langsung: klik cue 4 → gambar + subtitle tampil; putar → waktu berjalan');
await selectCue(4);
await waitFor(`${livePixels} > 0.2 && !document.body.innerText.includes('Menyiapkan subtitle')`, 'pratinjau cue 4', 20_000);
await ev(`document.querySelector('[data-role="play-toggle"]').click()`);
await sleep(1500);
const playedTime = await ev(`document.querySelector('input[aria-label="Posisi pratinjau"]').value`);
await ev(`document.querySelector('[data-role="play-toggle"]').click()`);
if (!(+playedTime > 9500)) fail(`posisi tidak berjalan saat diputar (${playedTime} ms, mulai 9000)`);
for (const [name, w, h] of [['editor-v2-desktop', 1440, 1000], ['editor-v2-mobile', 390, 1500]]) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await sleep(700);
  await cdp('Page.captureScreenshot', { format: 'png' }).then((r) => writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')));
}
await cdp('Emulation.clearDeviceMetricsOverride');

step('tab Subtitle: gaya khusus cue 2 (warna) → Reset');
await selectCue(2);
await tab('Subtitle');
await waitFor(`!!document.querySelector('[data-role="line-style-0"]')`, 'baris gaya');
await ev(`[...document.querySelectorAll('[data-role="line-style-0"] button')].find(b=>b.textContent==='Gaya').click()`);
await waitFor(`!!document.querySelector('dialog[open][data-role="line-style-modal"]')`, 'modal gaya baris', 5000);
await ev(`(()=>{const i=[...document.querySelectorAll('dialog[open][data-role="line-style-modal"] label')].find(l=>l.textContent.startsWith('Warna teks')).querySelector('input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'#ff0000');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await waitFor(`document.querySelector('[data-role="line-style-0"]').hasAttribute('data-overridden')`, 'override gaya aktif', 5000);
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await cdp('Page.captureScreenshot', { format: 'png' }).then((r) => writeFileSync(`${OUT}/editor-v2-line-style.png`, Buffer.from(r.result.data, 'base64')));
await cdp('Emulation.clearDeviceMetricsOverride');
await ev(`[...document.querySelectorAll('dialog[open][data-role="line-style-modal"] button')].find(b=>b.textContent==='Reset ke gaya global').click()`);
await waitFor(`!document.querySelector('[data-role="line-style-0"]').hasAttribute('data-overridden')`, 'reset gaya', 5000);
await closeModal();
await waitFor(`!document.querySelector('dialog[open]')`, 'modal gaya tertutup', 5000);

step('Setting → modal Subtitle global: default 2 gaya baris walau SRT punya cue 3 baris; tambah → 3, hapus → 2');
await tab('Setting');
await ev(`document.querySelector('[data-role="open-subtitle-global"]').click()`);
const slotCount = `document.querySelectorAll('[data-role="display-panel"] fieldset[data-slot]').length`;
await waitFor(`${slotCount} === 2 && document.querySelector('[data-role="display-panel"]').innerText.includes('juga dipakai baris 3')`, '2 gaya default', 5000);
await ev(`document.querySelector('[data-role="add-slot"]').click()`);
await waitFor(`${slotCount} === 3`, 'gaya baris 3 ditambah', 5000);
await ev(`[...document.querySelectorAll('[data-role="display-panel"] button')].find(b=>b.textContent==='Hapus gaya baris 3').click()`);
await waitFor(`${slotCount} === 2`, 'gaya baris 3 dihapus', 5000);
await closeModal();
await waitFor(`!document.querySelector('dialog[open]')`, 'modal tertutup', 5000);

step('sisipkan cue di tengah cue 1 (belah) → 11 cue');
await ev(`(()=>{const r=document.querySelector('input[aria-label="Posisi pratinjau"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(r,'1500');r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await sleep(300);
await ev(`document.querySelector('[data-role="insert-cue"]').click()`);
await waitFor(`${cueCount} === 11 && !!document.querySelector('[data-cue="2"][data-selected]')`, 'cue baru tersisip & terpilih', 5000);

step('geser tepi kanan cue 3 ke kiri (drag) → waktu berubah, satu undo mengembalikan');
const endOf = `[...document.querySelectorAll('[data-role="cue-editor"] label')].find(l=>l.textContent.startsWith('Selesai'))?.querySelector('input')?.value`;
await selectCue(3);
await tab('Subtitle');
const endBefore = await ev(endOf);
await ev(`document.querySelector('[data-cue="3"]').scrollIntoView({block:'center',inline:'center'})`);
await sleep(200);
const box = await ev(`(()=>{const h=document.querySelector('[data-cue="3"] [data-edge="end"]').getBoundingClientRect();return {x:h.x+h.width/2,y:h.y+h.height/2};})()`);
const mouse = (type, x) => cdp('Input.dispatchMouseEvent', { type, x, y: box.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
await mouse('mousePressed', box.x);
for (let i = 1; i <= 5; i++) await mouse('mouseMoved', box.x - i * 6);
await mouse('mouseReleased', box.x - 30);
await sleep(300);
const endAfter = await ev(endOf);
if (!(+endAfter < +endBefore)) fail(`drag tidak mengubah akhir cue (${endBefore} → ${endAfter})`);
await ev(`document.activeElement?.blur()`);
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
await waitFor(`(${endOf}) === ${JSON.stringify(endBefore)}`, 'undo drag (satu langkah)', 5000);
// kembalikan jumlah cue ke 10 agar durasi & isi render sama dengan uji sebelumnya
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
await waitFor(`${cueCount} === 10`, 'undo sisip cue', 5000);

// helper: data cue dari timeline (atribut title berisi waktu) & drag tetikus
const cueStart = (n) => ev(`(()=>{const t=document.querySelector('[data-cue="${n}"]').title;return t.split(' · ')[1].split('–')[0];})()`);
const undo = async () => {
  await ev(`document.activeElement?.blur()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
  await sleep(300);
};
const dragX = async (sel, dx) => {
  await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center',inline:'center'})`);
  await sleep(200);
  const b = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const m = (type, x) => cdp('Input.dispatchMouseEvent', { type, x, y: b.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await m('mousePressed', b.x);
  for (let i = 1; i <= 6; i++) await m('mouseMoved', b.x + (dx * i) / 6);
  await m('mouseReleased', b.x + dx);
  await sleep(300);
};

step('sisipkan & geser di tengah cue 2 → cue baru setelah cue 2, cue sesudahnya mundur 2 dtk; undo');
const c3Before = await cueStart(3);
await ev(`(()=>{const r=document.querySelector('input[aria-label="Posisi pratinjau"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(r,'4000');r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await sleep(300);
await ev(`document.querySelector('[data-role="insert-ripple"]').click()`);
await waitFor(`${cueCount} === 11 && !!document.querySelector('[data-cue="3"][data-selected]')`, 'cue tersisip (ripple) & terpilih', 5000);
const c4After = await cueStart(4);
if (c4After !== '0:08.0') fail(`cue sesudahnya tidak bergeser 2 dtk (cue 3 lama ${c3Before} → kini cue 4 ${c4After})`);
await undo();
await waitFor(`${cueCount} === 10`, 'undo sisip & geser', 5000);

step('seret badan cue 5 ke kanan → cue 5 & sesudahnya bergeser, cue 4 tetap; undo');
const c4 = await cueStart(4), c5 = await cueStart(5), c6 = await cueStart(6);
await dragX('[data-cue="5"] [class*="blockText"]', 40);
const [n4, n5, n6] = [await cueStart(4), await cueStart(5), await cueStart(6)];
if (!(n4 === c4 && n5 !== c5 && n6 !== c6)) fail(`ripple drag salah: cue4 ${c4}→${n4}, cue5 ${c5}→${n5}, cue6 ${c6}→${n6}`);
await undo();
await waitFor(`(()=>{const t=document.querySelector('[data-cue="5"]').title;return t.includes(${JSON.stringify(c5)});})()`, 'undo seret badan (satu langkah)', 5000);

step('seret penanda posisi di penggaris → posisi putar berpindah');
const pos = () => ev(`+document.querySelector('input[aria-label="Posisi pratinjau"]').value`);
const p0 = await pos();
await dragX('[data-role="timeline-ruler"]', 80);
const p1 = await pos();
if (!(Math.abs(p1 - p0) > 500)) fail(`posisi tidak berpindah saat seret penggaris (${p0} → ${p1})`);

step('geser semua cue +1 dtk (cue pertama 0:00.5 → 0:01.5) lalu undo');
await ev(`document.querySelector('[data-role="open-shift"]').click()`);
await waitFor(`!!document.querySelector('dialog[open][data-role="shift-modal"]')`, 'modal geser semua', 5000);
await ev(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='+1 dtk').click()`);
await waitFor(`document.querySelector('[data-role="shift-preview"]').innerText.includes('0:01.5')`, 'pratinjau geser', 5000);
await ev(`document.querySelector('[data-role="shift-apply"]').click()`);
await waitFor(`!document.querySelector('dialog[open]')`, 'modal tertutup', 5000);
await selectCue(1);
await tab('Subtitle');
const startOf = `[...document.querySelectorAll('[data-role="cue-editor"] label')].find(l=>l.textContent.startsWith('Mulai'))?.querySelector('input')?.value`;
await waitFor(`(${startOf}) === '1.50'`, 'cue 1 mulai 1,50 dtk', 5000);
await ev(`document.activeElement?.blur()`);
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
await waitFor(`(${startOf}) === '0.50'`, 'undo geser semua (satu langkah)', 5000);

step('cek simpan otomatis');
await waitFor(`document.body.innerText.includes('Tersimpan di perangkat')`, 'simpan otomatis', 10_000);

step('render penuh');
await ev(`document.querySelector('[data-role="open-render"]').click()`);
await waitFor(`[...document.querySelectorAll('dialog[open] button')].some(b=>b.textContent.trim()==='Render video'&&!b.disabled)`, 'tombol render aktif');
const t0 = Date.now();
await ev(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim()==='Render video').click()`);
await waitFor(`document.body.innerText.includes('Hasil akhir') || document.querySelector('[data-role="render-error"]')?.innerText`, 'render selesai', 300_000);
const err = await ev(`document.querySelector('[data-role="render-error"]')?.innerText ?? ''`);
if (err) fail(`render: ${err}`);
const renderSec = ((Date.now() - t0) / 1000).toFixed(1);

step('ambil MP4 & reload project (persistensi)');
const b64 = await ev(`(async()=>{const v=document.querySelector('video');const b=new Uint8Array(await (await fetch(v.src)).arrayBuffer());let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s);})()`);
writeFileSync(`${OUT}/editor.mp4`, Buffer.from(b64, 'base64'));
await cdp('Page.reload', {});
await waitFor(`${cueCount} === 10`, 'cue utuh setelah reload');
await tab('Setting');
await waitFor(`document.body.innerText.includes('clip_bg.mp4')`, 'video latar utuh setelah reload');

const probe = JSON.parse(execFileSync(FP, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', `${OUT}/editor.mp4`]).toString());
const v = probe.streams.find((s) => s.width), a = probe.streams.find((s) => !s.width);
const result = { pass: v?.codec_name === 'h264' && v.width === 1080 && v.height === 1920 && a?.codec_name === 'aac' && Math.abs(+probe.format.duration - 30) < 0.2, renderSeconds: +renderSec, video: v, audio: a, duration: +probe.format.duration };
console.log(JSON.stringify(result, null, 2));
step('logout dari menu profil');
await ev(`document.querySelector('header button[aria-haspopup="menu"]').click()`);
await sleep(200);
await ev(`[...document.querySelectorAll('[role=menuitem]')].find(a=>a.textContent==='Keluar').click()`);
await waitFor(`location.pathname === '/' && !!document.querySelector('header a[href*="/auth/login"]')`, 'kembali ke beranda sebagai tamu');
chrome.kill(); server.close(); mockApi.server.close();
process.exit(result.pass ? 0 : 1);
