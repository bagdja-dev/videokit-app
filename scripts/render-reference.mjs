// Renderer referensi ffmpeg + libass untuk Render Spec v1 — pembanding executor browser dan bibit executor
// server (Fase 6). Aturan wajib identik dengan compositor.worker.ts: BT.709, latar blur via downscale,
// freeze frame terakhir, amplop ducking sama.
// Pakai: node scripts/render-reference.mjs <spec.json> <out.mp4>   (path input = url relatif ke public/)
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FF = process.env.FFMPEG ?? (existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' : 'ffmpeg');
const FP = FF.replace(/ffmpeg$/, 'ffprobe');
const [specPath = 'public/dev-samples/spec.json', outPath = 'e2e-output/reference.mp4'] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const { width: W, height: H, fps: FPS, duration_ms } = spec.output;
const DUR = duration_ms / 1000;
const BLUR_DOWNSCALE = 8;
const pathOf = (key) => join('public', spec.inputs[key].url.replace(/^\//, ''));
const durationOf = (p) => +execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString();

const args = ['-hide_banner', '-loglevel', 'error', '-y'];
const filters = [];
let n = 0;
const addInput = (key, extra = []) => { args.push(...extra, '-i', pathOf(key)); return n++; };

// Fit menghasilkan lapisan RGBA ukuran output. `contain` diberi padding TRANSPARAN sehingga area kosong
// memperlihatkan lapisan di bawahnya (latar atau background_color) — aturan sama dengan compositor.worker.ts.
const fit = (src, f, label) => {
  if (f === 'cover') filters.push(`[${src}]format=rgba,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[${label}]`);
  else if (f === 'contain') filters.push(`[${src}]format=rgba,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1[${label}]`);
  else {
    const sw = Math.round(W / BLUR_DOWNSCALE), sh = Math.round(H / BLUR_DOWNSCALE);
    filters.push(`[${src}]format=rgba,split[${label}a][${label}b]`);
    filters.push(`[${label}a]scale=${Math.round(sw * 1.15)}:${Math.round(sh * 1.15)}:force_original_aspect_ratio=increase,crop=${sw}:${sh},gblur=sigma=5,scale=${W}:${H}:flags=bilinear[${label}bg]`);
    filters.push(`[${label}b]scale=${W}:${H}:force_original_aspect_ratio=decrease[${label}fg]`);
    filters.push(`[${label}bg][${label}fg]overlay=(W-w)/2:(H-h)/2:format=auto,setsar=1[${label}]`);
  }
};

// Lapisan dasar sepanjang durasi: video/gambar latar (loop) di atas background_color, atau warna polos.
filters.push(`color=c=${spec.output.background_color}:s=${W}x${H}:r=${FPS}:d=${DUR},format=rgba[base0]`);
let base = 'base0';
if (spec.background) {
  const bgInp = spec.inputs[spec.background.input];
  const idx = bgInp.kind === 'image'
    ? addInput(spec.background.input, ['-loop', '1', '-framerate', String(FPS), '-t', String(DUR)])
    : addInput(spec.background.input, ['-stream_loop', '-1', '-threads', '1']);
  filters.push(`[${idx}:v]trim=duration=${DUR},setpts=PTS-STARTPTS,fps=${FPS}[bgr]`);
  fit('bgr', spec.background.fit ?? 'cover', 'bgf');
  filters.push(`[base0][bgf]overlay=0:0:shortest=1:format=auto[base1]`);
  base = 'base1';
}

// Tiap segmen jadi lapisan RGBA yang muncul hanya di rentangnya, ditumpuk di atas lapisan dasar.
[...spec.video_track].sort((a, b) => a.start_ms - b.start_ms).forEach((seg, i) => {
  const d = (seg.end_ms - seg.start_ms) / 1000;
  const st = seg.start_ms / 1000;
  const L = `v${i}`;
  if (seg.color) {
    filters.push(`color=c=${seg.color}:s=${W}x${H}:r=${FPS}:d=${d},format=rgba[${L}f]`);
  } else if (spec.inputs[seg.input].kind === 'image') {
    const idx = addInput(seg.input, ['-loop', '1', '-framerate', String(FPS), '-t', String(d)]);
    fit(`${idx}:v`, seg.fit, `${L}f`);
  } else {
    const idx = addInput(seg.input, ['-threads', '1']);
    filters.push(`[${idx}:v]trim=start=${(seg.source_in_ms ?? 0) / 1000}:duration=${d},setpts=PTS-STARTPTS,fps=${FPS},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d}[${L}r]`);
    fit(`${L}r`, seg.fit, `${L}f`);
  }
  filters.push(`[${L}f]fps=${FPS},trim=duration=${d},setpts=PTS-STARTPTS+${st}/TB[${L}t]`);
  filters.push(`[${base}][${L}t]overlay=0:0:format=auto:eof_action=pass:enable='between(t,${st},${(seg.end_ms / 1000 - 0.0001).toFixed(4)})'[c${i}]`);
  base = `c${i}`;
});
// fontsdir ffmpeg hanya satu folder → gabungkan paket font sesuai font_set (latin-v1 / latin-cjk-v1).
const fontsDir = () => {
  const dir = 'e2e-output/fonts-' + spec.subtitles.font_set;
  mkdirSync(dir, { recursive: true });
  const sets = spec.subtitles.font_set === 'latin-cjk-v1' ? ['latin-v1', 'cjk-v1'] : ['latin-v1'];
  for (const set of sets) for (const f of readdirSync(join('public/fonts', set))) {
    if (/\.(ttf|otf)$/.test(f) && !existsSync(join(dir, f))) copyFileSync(join('public/fonts', set, f), join(dir, f));
  }
  return dir;
};
const subs = spec.subtitles ? `ass=${pathOf(spec.subtitles.input)}:fontsdir=${fontsDir()},` : '';
filters.push(`[${base}]trim=duration=${DUR},format=gbrp,${subs}scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]`);

// Audio — amplop latar identik dengan src/core/render/envelope.ts; boleh lebih dari satu track latar
// (musik + audio video latar), masing-masing di-loop, fade, dan ducking oleh voice.
const voices = spec.audio_tracks.filter((a) => a.role === 'voice');
const vEnd = (v) => v.end_ms ?? v.start_ms + durationOf(pathOf(v.input)) * 1000;
const aLabels = [];
spec.audio_tracks.filter((a) => a.role === 'background').forEach((bg, bi) => {
  const d = bg.ducking;
  const spans = voices.map((v) => ({ start: v.start_ms, end: vEnd(v) }));
  const at = (t) => {
    let g = 1;
    if (bg.fade_in_ms && t < bg.fade_in_ms) g = Math.min(g, t / bg.fade_in_ms);
    if (bg.fade_out_ms && t > duration_ms - bg.fade_out_ms) g = Math.min(g, (duration_ms - t) / bg.fade_out_ms);
    if (d) { let k = 0; for (const s of spans) k = Math.max(k, Math.max(0, Math.min(1, (t - (s.start - d.attack_ms)) / d.attack_ms, (s.end + d.release_ms - t) / d.release_ms))); g *= 1 - (1 - d.level) * k; }
    return Math.max(0, g) * (bg.volume ?? 1);
  };
  const ts = new Set([0, duration_ms, bg.fade_in_ms ?? 0, duration_ms - (bg.fade_out_ms ?? 0)]);
  if (d) spans.forEach((s) => [s.start - d.attack_ms, s.start, s.end, s.end + d.release_ms].forEach((t) => ts.add(t)));
  const pts = [...ts].filter((t) => t >= 0 && t <= duration_ms).sort((a, b) => a - b).map((t) => ({ t, g: at(t) }));
  let expr = pts.at(-1).g.toFixed(5);
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i], b = pts[i + 1];
    if (b.t <= a.t) continue;
    expr = `if(lt(t\\,${(b.t / 1000).toFixed(3)})\\,(${a.g.toFixed(5)}+(${(b.g - a.g).toFixed(5)})*(t-${(a.t / 1000).toFixed(3)})/${((b.t - a.t) / 1000).toFixed(3)})\\,${expr})`;
  }
  const idx = addInput(bg.input, bg.loop ? ['-stream_loop', '-1'] : []);
  filters.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${DUR},asetpts=PTS-STARTPTS,volume='${expr}':eval=frame,apad[abg${bi}]`);
  aLabels.push(`abg${bi}`);
});
voices.forEach((v, i) => {
  const idx = addInput(v.input);
  filters.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${(vEnd(v) - v.start_ms) / 1000},asetpts=PTS-STARTPTS,volume=${v.volume ?? 1},adelay=${v.start_ms}:all=1,apad[av${i}]`);
  aLabels.push(`av${i}`);
});
filters.push(aLabels.length
  ? `${aLabels.map((l) => `[${l}]`).join('')}amix=inputs=${aLabels.length}:normalize=0:duration=longest,atrim=0:${DUR}[aout]`
  : `anullsrc=r=48000:cl=stereo,atrim=0:${DUR}[aout]`);

args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]',
  '-threads', process.env.VK_THREADS ?? '0',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(DUR), '-movflags', '+faststart', outPath);
const t0 = Date.now();
const r = spawnSync(FF, args, { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`referensi ffmpeg: ${outPath} dalam ${((Date.now() - t0) / 1000).toFixed(1)} dtk`);
