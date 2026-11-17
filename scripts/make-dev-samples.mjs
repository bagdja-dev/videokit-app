// Buat sampel dev di public/dev-samples/: media sintetis bertag BT.709, subs.ass, spec.json (Render Spec v1).
// Butuh ffmpeg (FFMPEG=/path). Pakai: npm run samples   (opsi: DURATION_REPEAT=20 untuk uji 10 menit)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildAss, parseSrt } from './lib/dev-ass.mjs';

const FF = process.env.FFMPEG ?? (existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' : 'ffmpeg');
const OUT = 'public/dev-samples';
const REPEAT = Math.max(1, +(process.env.DURATION_REPEAT ?? 1));
mkdirSync(OUT, { recursive: true });

const ff = (...args) => execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const TAG = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const SC = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';
const make = (name, fn) => { if (!existsSync(`${OUT}/${name}`)) fn(`${OUT}/${name}`); };

make('clip_land.mp4', (o) => ff('-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=8', '-f', 'lavfi', '-i', 'sine=f=440:d=8', '-vf', SC, '-c:v', 'libx264', ...TAG, '-c:a', 'aac', '-shortest', o));
make('clip_port.mp4', (o) => ff('-f', 'lavfi', '-i', 'testsrc=s=1080x1920:r=30:d=8,hue=h=120', '-vf', SC, '-c:v', 'libx264', ...TAG, o));
make('clip_short.mp4', (o) => ff('-f', 'lavfi', '-i', 'mandelbrot=s=1280x720:r=30', '-t', '2', '-vf', SC, '-c:v', 'libx264', ...TAG, o));
make('clip_hevc.mp4', (o) => ff('-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=7,hue=h=240', '-vf', SC, '-c:v', 'libx265', '-tag:v', 'hvc1', ...TAG, '-x265-params', 'log-level=error:colorprim=bt709:transfer=bt709:colormatrix=bt709', o));
make('clip_bg.mp4', (o) => ff('-f', 'lavfi', '-i', 'testsrc2=s=540x960:r=30:d=4,hue=h=180:s=0.6', '-f', 'lavfi', '-i', 'aevalsrc=0.3*sin(2*PI*330*t)*(0.6+0.4*sin(2*PI*0.5*t)):s=48000:d=4', '-t', '4', '-vf', SC, '-c:v', 'libx264', ...TAG, '-c:a', 'aac', '-shortest', o));
make('image.png', (o) => ff('-f', 'lavfi', '-i', 'gradients=s=1600x1200:d=1:speed=0', '-frames:v', '1', o));
make('bgm.m4a', (o) => ff('-f', 'lavfi', '-i', 'aevalsrc=0.25*sin(2*PI*220*t)+0.18*sin(2*PI*277.18*t)+0.12*sin(2*PI*329.63*t):s=48000:d=10', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', o));
make('vo1.m4a', (o) => ff('-f', 'lavfi', '-i', 'aevalsrc=0.6*sin(2*PI*880*t)*(0.5+0.5*sin(2*PI*4*t)):s=48000:d=2', '-ac', '2', '-c:a', 'aac', o));
make('vo2.m4a', (o) => ff('-f', 'lavfi', '-i', 'aevalsrc=0.6*sin(2*PI*660*t)*(0.5+0.5*sin(2*PI*3*t)):s=48000:d=2', '-ac', '2', '-c:a', 'aac', o));

const output = { width: 1080, height: 1920, fps: 30, duration_ms: 30_000 * REPEAT, background_color: '#000000' };
const design = {
  anchor: 'bottom', margin_v: 260, margin_h: 80,
  slots: [
    { font: 'Poppins', bold: true, italic: false, size: 72, color: '#FFFFFF', outline_color: '#000000', outline: 4, shadow: 2 },
    { font: 'Poppins', bold: false, italic: true, size: 48, color: '#FFE066', outline_color: '#000000', outline: 3, shadow: 1 },
  ],
};
const block = [
  { input: 'clip_land', start_ms: 0, end_ms: 6000, source_in_ms: 500, fit: 'blur', underflow: 'freeze' },
  { input: 'clip_port', start_ms: 6000, end_ms: 12000, source_in_ms: 0, fit: 'cover', underflow: 'freeze' },
  { input: 'image', start_ms: 12000, end_ms: 18000, fit: 'contain' },
  { input: 'clip_short', start_ms: 18000, end_ms: 23000, source_in_ms: 0, fit: 'cover', underflow: 'freeze' },
  { input: 'clip_hevc', start_ms: 24000, end_ms: 29500, source_in_ms: 0, fit: 'cover', underflow: 'freeze' },
];
const shift = (o, k) => ({ ...o, start_ms: o.start_ms + k * 30_000, end_ms: o.end_ms + k * 30_000 });
const voices = [
  { input: 'vo1', role: 'voice', start_ms: 2000, end_ms: 4000, volume: 1 },
  { input: 'vo2', role: 'voice', start_ms: 13000, end_ms: 15000, volume: 1 },
];
const url = (f) => `/dev-samples/${f}`;
const spec = {
  spec_version: 1,
  output,
  inputs: {
    clip_land: { kind: 'video', url: url('clip_land.mp4') }, clip_port: { kind: 'video', url: url('clip_port.mp4') },
    clip_short: { kind: 'video', url: url('clip_short.mp4') }, clip_hevc: { kind: 'video', url: url('clip_hevc.mp4') },
    image: { kind: 'image', url: url('image.png') }, clip_bg: { kind: 'video', url: url('clip_bg.mp4') }, bgm: { kind: 'audio', url: url('bgm.m4a') },
    vo1: { kind: 'audio', url: url('vo1.m4a') }, vo2: { kind: 'audio', url: url('vo2.m4a') },
    subs: { kind: 'subtitle', url: url('subs.ass') },
  },
  // Video latar (loop) + audionya ikut di-mix sebagai track latar kedua, ikut ducking.
  background: { input: 'clip_bg', fit: 'cover' },
  video_track: Array.from({ length: REPEAT }, (_, k) => block.map((s) => shift(s, k))).flat(),
  audio_tracks: [
    { input: 'bgm', role: 'background', start_ms: 0, loop: true, volume: 0.8, fade_in_ms: 500, fade_out_ms: 1500, ducking: { level: 0.25, attack_ms: 200, release_ms: 400 } },
    { input: 'clip_bg', role: 'background', start_ms: 0, loop: true, volume: 0.5, fade_in_ms: 500, fade_out_ms: 1500, ducking: { level: 0.25, attack_ms: 200, release_ms: 400 } },
    ...Array.from({ length: REPEAT }, (_, k) => voices.map((v) => shift(v, k))).flat(),
  ],
  subtitles: { input: 'subs', font_set: 'latin-v1' },
};
const cues = parseSrt(readFileSync('scripts/lib/sample.srt', 'utf8'));
const allCues = Array.from({ length: REPEAT }, (_, k) => cues.map((c) => shift(c, k))).flat();
writeFileSync(`${OUT}/subs.ass`, buildAss(allCues, design, output));
writeFileSync(`${OUT}/spec.json`, JSON.stringify(spec, null, 2));
console.log(`dev-samples siap: ${output.duration_ms / 1000} detik, ${spec.video_track.length} segmen, ${allCues.length} cue`);
