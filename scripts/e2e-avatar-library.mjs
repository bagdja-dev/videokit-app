// E2E A1 — perpustakaan avatar dari sisi pengguna (Chrome headless + API tiruan): unggah VRM → persetujuan lisensi →
// PUT presigned → konfirmasi → daftar & thumbnail → pratinjau avatar → reload (cache perangkat, tanpa unduh ulang) →
// slot penuh (2) → hapus. Pakai: npm run e2e:avatar-library   (SKIP_BUILD=1 memakai out/ yang ada)
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { mockApiBuildEnv, startMockAuthApi } from './lib/mock-auth-api.mjs';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8793, DEBUG = 9577, OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });
if (!existsSync('public/dev-samples/avatar/Seed-san.vrm')) execFileSync('node', ['scripts/vendor-mediapipe.mjs'], { stdio: 'inherit' });
if (!process.env.SKIP_BUILD) execFileSync('npm', ['run', 'build'], { stdio: 'inherit', env: mockApiBuildEnv() });
const VRM = resolve(process.env.VRM ?? 'public/dev-samples/avatar/Seed-san.vrm');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
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
const api = await startMockAuthApi({ mode: 'always', appOrigin: `http://localhost:${PORT}` });
const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vk-al-'));
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG}`, '--no-first-run', '--enable-unsafe-swiftshader', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const finish = (code) => { chrome.kill('SIGKILL'); server.close(); api.server.close(); process.exit(code); };
setTimeout(() => { console.error('TIMEOUT'); finish(2); }, 240_000).unref();

let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://localhost:${DEBUG}/json`)).json()).find((t) => t.type === 'page'); } catch { /* */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => { ws.onopen = ok; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, what, ms = 30_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(250); }
  console.error(`menunggu ${what}: ${await ev('document.body.innerText.slice(0,600)')}`);
  return false;
};
const setFile = async (selector, file) => {
  const r = await cdp('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
  await cdp('DOM.setFileInputFiles', { files: [file], objectId: r.result.result.objectId });
};
const shot = async (name, w, h) => {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await sleep(600);
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
};
const previewPixels = `(()=>{const c=document.querySelector('[data-role="avatar-preview"]');if(!c)return 0;const o=document.createElement('canvas');o.width=c.width;o.height=c.height;const x=o.getContext('2d');x.drawImage(c,0,0);const d=x.getImageData(0,0,o.width,o.height).data;let n=0;for(let p=3;p<d.length;p+=4)if(d[p]>0)n++;return n/(o.width*o.height);})()`;
const upload = async (name) => {
  await setFile('input[aria-label="Pilih file avatar VRM"]', VRM);
  if (!(await waitFor(`!!document.querySelector('dialog[open] input[type=checkbox]')`, 'dialog persetujuan', 30_000))) return false;
  await ev(`(()=>{const i=document.querySelector('dialog[open] input:not([type])');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(name)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await ev(`document.querySelector('dialog[open] input[type=checkbox]').click()`);
  await sleep(150);
  await ev(`document.querySelector('dialog[open] button[type=submit]').click()`);
  return waitFor(`!document.querySelector('dialog[open]') && !!document.querySelector('[data-avatar=${JSON.stringify(name)}]')`, `avatar ${name} di daftar`, 60_000);
};

await cdp('Page.enable'); await cdp('DOM.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `http://localhost:${PORT}/avatar-record/` });
check('halaman Avatar Rekam: header + slot kosong 0/2', await waitFor(`document.body.innerText.includes('Avatar saya') && document.querySelector('[data-role="avatar-quota"]')?.innerText==='0/2 slot' && [...document.querySelectorAll('header span')].some(s=>s.textContent==='Avatar Rekam')`, 'halaman'));
check('unggah avatar 1 (periksa → setuju lisensi → PUT → confirm)', await upload('Seed Satu'));
const meta = await ev(`document.querySelector('[data-avatar="Seed Satu"]').innerText`);
check('lisensi dari metadata VRM tampil', /Komersial OK|Non-komersial|Lisensi/.test(meta), meta.replace(/\n/g, ' | '));
check('thumbnail tampil (CORS + COEP)', await waitFor(`(()=>{const i=document.querySelector('[data-avatar="Seed Satu"] img');return !!i && i.complete && i.naturalWidth>0;})()`, 'thumbnail', 10_000));
check('pratinjau avatar ter-render', await waitFor(`${previewPixels} > 0.05`, 'pratinjau', 30_000), `${((await ev(previewPixels)) * 100).toFixed(0)}% piksel`);
const sent = [...api.avatars.values()][0];
check('API menerima sha256 + versi VRM + persetujuan', /^[0-9a-f]{64}$/.test(sent.sha256) && (process.env.VRM ? ['0', '1'].includes(sent.vrm_version) : sent.vrm_version === '1') && sent.license_accepted === true && sent.thumbnail_mime_type === 'image/webp');
await shot('avatar-library-desktop', 1280, 900);

// bingkai manual: buka panel, geser zoom & naik/turun, simpan → tersimpan di server + thumbnail diganti
const setRange = (label, v) => ev(`(()=>{const i=document.querySelector('[data-role="framing-panel"] input[aria-label=${JSON.stringify(label)}]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'${v}');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const pixelsBefore = await ev(previewPixels);
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Atur bingkai').click()`);
await waitFor(`!!document.querySelector('[data-role="framing-panel"]')`, 'panel bingkai', 5000);
const thumbSrcBefore = await ev(`document.querySelector('[data-avatar="Seed Satu"] img').src`);
await setRange('Perbesar', '1.6');
await setRange('Naik / turun', '0.08');
await sleep(500);
const pixelsZoom = await ev(previewPixels);
check('slider bingkai langsung mengubah pratinjau', Math.abs(pixelsZoom - pixelsBefore) > 0.02, `${(pixelsBefore * 100).toFixed(0)}% → ${(pixelsZoom * 100).toFixed(0)}% piksel terisi`);
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Simpan bingkai').click()`);
check('simpan bingkai → server + thumbnail baru', await waitFor(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Simpan bingkai')?.disabled && document.querySelector('[data-avatar="Seed Satu"] img')?.src !== ${JSON.stringify(thumbSrcBefore)}`, 'simpan bingkai', 20_000)
  && [...api.avatars.values()][0].framing?.zoom === 1.6 && api.stats.thumbnailReplacements === 1);
await shot('avatar-framing-desktop', 1280, 1000);
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const downloadsBefore = api.stats.vrmDownloads;
await cdp('Page.reload', {});
check('reload: avatar tetap ada (server) & pratinjau dari cache perangkat', await waitFor(`!!document.querySelector('[data-avatar="Seed Satu"]') && ${previewPixels} > 0.05`, 'reload', 30_000) && api.stats.vrmDownloads === downloadsBefore, `unduhan VRM: ${api.stats.vrmDownloads - downloadsBefore}`);
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Atur bingkai').click()`);
check('bingkai tersimpan setelah reload', await waitFor(`document.querySelector('[data-role="framing-panel"] input[aria-label="Perbesar"]')?.value === '1.6'`, 'nilai bingkai', 5000));

check('unggah avatar 2', await upload('Seed Dua'));
check('slot penuh 2/2: tombol unggah hilang + catatan premium', await waitFor(`document.querySelector('[data-role="avatar-quota"]')?.innerText==='2/2 slot' && ![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Unggah avatar .vrm')) && document.body.innerText.includes('slot tambahan (premium)')`, 'slot penuh'));
await shot('avatar-library-mobile', 390, 900);
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// perangkat lain (cache kosong) → harus mengunduh dari storage dan memverifikasi sha256
await ev(`indexedDB.databases().then(ds=>Promise.all(ds.filter(d=>d.name.startsWith('videokit-avatars-')).map(d=>new Promise(r=>{const q=indexedDB.deleteDatabase(d.name);q.onsuccess=q.onerror=q.onblocked=()=>r();}))))`);
const before2 = api.stats.vrmDownloads;
await cdp('Page.reload', {});
check('perangkat baru (cache kosong): unduh dari storage, sha256 cocok, avatar tampil', await waitFor(`${previewPixels} > 0.05`, 'unduh', 30_000) && api.stats.vrmDownloads === before2 + 1);

await ev(`window.confirm = () => true`);
await ev(`[...document.querySelector('[data-avatar="Seed Dua"]').querySelectorAll('button')].find(b=>b.textContent==='Hapus').click()`);
check('hapus avatar → 1/2, slot unggah muncul lagi', await waitFor(`document.querySelector('[data-role="avatar-quota"]')?.innerText==='1/2 slot' && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Unggah avatar .vrm'))`, 'hapus'));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} lulus`);
finish(failed ? 1 : 0);
