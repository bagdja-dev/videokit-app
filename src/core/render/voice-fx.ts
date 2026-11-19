// Efek suara narasi (track role `voice`): rangkaian node Web Audio yang SAMA dipakai di render (OfflineAudioContext)
// dan pratinjau langsung (AudioContext), jadi yang terdengar saat menyunting = hasil MP4.
// Urutan: geser nada & ketebalan (offline, sebelum rangkaian) → high-pass (dengung) → EQ (hangat · jernih · desis) → kompresor →
// penguatan → ruang (reverb). Nada & ketebalan tidak punya node Web Audio, jadi diproses di depan (lihat PreFx).
import { encodeWav, mixToMono } from '@/core/audio/wav';
import { END_ECHO_DEFAULT_DELAY_MS, endEcho, endEchoTailMs } from '@/core/audio/echo';
import { formantShift } from '@/core/audio/formant';
import { pitchShift } from '@/core/audio/pitch';
import type { VoiceFx } from './types';

/** Ekor reverb maksimum (detik) — klip narasi diperpanjang sebesar ini agar gema tidak terpotong. */
export const REVERB_TAIL_S = 1.2;

export const hasVoiceFx = (fx: VoiceFx | undefined): fx is VoiceFx =>
  !!fx && Object.values(fx).some((v) => typeof v === 'number' && v !== 0);

const dbToGain = (db: number) => 10 ** (db / 20);

/** PRNG deterministik: impulse response reverb identik di setiap render & di pratinjau. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.round(REVERB_TAIL_S * ctx.sampleRate);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry32(0x5eed + ch);
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (rnd() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < ctx.sampleRate * 0.01 ? i / (ctx.sampleRate * 0.01) : 1);
    }
  }
  return ir;
}

export interface VoiceChain {
  input: AudioNode;
  output: AudioNode;
  disconnect(): void;
}

/** Bangun rangkaian efek. Hubungkan sumber ke `input`, lalu `output` ke tujuan. */
export function buildVoiceChain(ctx: BaseAudioContext, fx: VoiceFx): VoiceChain {
  const nodes: AudioNode[] = [];
  const add = <T extends AudioNode>(n: T): T => { nodes.push(n); return n; };
  const input = add(ctx.createGain());
  let tail: AudioNode = input;
  const chain = (n: AudioNode) => { tail.connect(n); tail = n; };

  if (fx.highpass_hz && fx.highpass_hz > 0) {
    const hp = add(ctx.createBiquadFilter());
    hp.type = 'highpass'; hp.frequency.value = fx.highpass_hz; hp.Q.value = 0.707;
    chain(hp);
  }
  const eq = (type: BiquadFilterType, freq: number, gainDb: number | undefined, q = 1) => {
    if (!gainDb) return;
    const f = add(ctx.createBiquadFilter());
    f.type = type; f.frequency.value = freq; f.gain.value = gainDb; f.Q.value = q;
    chain(f);
  };
  eq('lowshelf', 180, fx.warmth_db);
  eq('peaking', 3500, fx.clarity_db, 0.9);
  eq('highshelf', 8500, fx.air_db);

  const amount = Math.max(0, Math.min(1, fx.compress ?? 0));
  let makeupDb = 0;
  if (amount > 0) {
    const c = add(ctx.createDynamicsCompressor());
    c.threshold.value = -12 - 28 * amount;
    c.ratio.value = 1.5 + 4.5 * amount;
    c.knee.value = 10;
    c.attack.value = 0.005;
    c.release.value = 0.2;
    chain(c);
    makeupDb = 9 * amount; // kompensasi volume yang turun karena kompresi
  }
  const gain = add(ctx.createGain());
  gain.gain.value = dbToGain((fx.gain_db ?? 0) + makeupDb);
  chain(gain);

  const wet = Math.max(0, Math.min(1, fx.reverb ?? 0));
  let output: AudioNode = gain;
  if (wet > 0) {
    const mix = add(ctx.createGain());
    const dry = add(ctx.createGain());
    const send = add(ctx.createGain());
    const conv = add(ctx.createConvolver());
    conv.buffer = roomImpulse(ctx);
    dry.gain.value = 1 - wet * 0.35;
    send.gain.value = wet * 0.7;
    gain.connect(dry).connect(mix);
    gain.connect(send).connect(conv).connect(mix);
    output = mix;
  }
  return { input, output, disconnect: () => nodes.forEach((n) => n.disconnect()) };
}

/** Ekor yang ditambahkan efek setelah akhir klip narasi (ms): gema ruangan & gema ujung kalimat. */
export function voiceTailMs(fx: VoiceFx | undefined): number {
  if (!fx) return 0;
  const reverb = (fx.reverb ?? 0) > 0 ? REVERB_TAIL_S * 1000 : 0;
  const echo = (fx.end_echo ?? 0) >= 0.01 ? endEchoTailMs(fx.end_echo_delay_ms ?? END_ECHO_DEFAULT_DELAY_MS) : 0;
  return echo + reverb;
}

/**
 * Proses potongan narasi offline: `offsetS`…`offsetS+lengthS` dari `buffer` melewati pra-proses lalu rangkaian efek.
 * Hasil diperpanjang sebesar ekor efek (gema). Diproses per klip (bukan per potongan render 20 dtk) agar kompresor
 * & gema tidak terputus di batas potongan.
 */
export async function processVoiceBuffer(buffer: AudioBuffer, fx: VoiceFx, offsetS: number, lengthS: number): Promise<AudioBuffer> {
  const frames = Math.max(1, Math.round((lengthS + voiceTailMs(fx) / 1000) * buffer.sampleRate));
  const ctx = new OfflineAudioContext(2, frames, buffer.sampleRate);
  const src = ctx.createBufferSource();
  const pre = preFxOf(fx);
  const fxChain = buildVoiceChain(ctx, fx);
  src.connect(fxChain.input);
  fxChain.output.connect(ctx.destination);
  if (pre) {
    src.buffer = preprocessBuffer(ctx, buffer, pre, offsetS, lengthS); // sudah dipotong; bisa lebih panjang (gema)
    src.start(0);
  } else {
    src.buffer = buffer;
    src.start(0, offsetS, lengthS);
  }
  return ctx.startRendering();
}

/**
 * Efek yang tidak punya node Web Audio (nada, ketebalan/formant, gema ujung kalimat) → diproses offline pada sampel,
 * sebelum rangkaian node. Dipakai render, pratinjau langsung, dan "Coba dengar" sehingga hasilnya identik.
 */
export interface PreFx { pitch: number; formant: number; echo: number; echoDelayMs: number }

export function preFxOf(fx: VoiceFx | undefined): PreFx | null {
  const pre: PreFx = {
    pitch: fx?.pitch_semitones ?? 0, formant: fx?.formant ?? 0,
    echo: fx?.end_echo ?? 0, echoDelayMs: fx?.end_echo_delay_ms ?? END_ECHO_DEFAULT_DELAY_MS,
  };
  return Math.abs(pre.pitch) >= 0.01 || Math.abs(pre.formant) >= 0.01 || pre.echo >= 0.01 ? pre : null;
}

/** Kunci pembanding pra-proses ('' = tidak ada). */
export const preFxKey = (pre: PreFx | null): string => (pre ? JSON.stringify(pre) : '');
export const preFxFromKey = (key: string): PreFx | null => (key ? (JSON.parse(key) as PreFx) : null);

export function applyPreFx(x: Float32Array, sampleRate: number, pre: PreFx): Float32Array {
  let y = Math.abs(pre.pitch) >= 0.01 ? pitchShift(x, sampleRate, pre.pitch) : x;
  if (Math.abs(pre.formant) >= 0.01) y = formantShift(y, sampleRate, pre.formant);
  if (pre.echo >= 0.01) y = endEcho(y, sampleRate, pre.echo, pre.echoDelayMs);
  return y === x ? x.slice() : y;
}

/** Potongan `offsetS`…`offsetS+lengthS` (default: seluruhnya) setelah pra-proses; jumlah kanal tetap, bisa lebih panjang. */
export function preprocessBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, pre: PreFx, offsetS = 0, lengthS?: number): AudioBuffer {
  const from = Math.min(buffer.length, Math.round(offsetS * buffer.sampleRate));
  const to = lengthS === undefined ? buffer.length : Math.min(buffer.length, from + Math.round(lengthS * buffer.sampleRate));
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, ch) => applyPreFx(buffer.getChannelData(ch).subarray(from, to), buffer.sampleRate, pre));
  const out = ctx.createBuffer(buffer.numberOfChannels, Math.max(1, ...chans.map((c) => c.length)), buffer.sampleRate);
  chans.forEach((c, ch) => out.copyToChannel(c as Float32Array<ArrayBuffer>, ch));
  return out;
}

/** Berkas audio → WAV mono setelah pra-proses (untuk pratinjau langsung yang memutar elemen <audio>). */
export async function preprocessedWav(blob: Blob, pre: PreFx): Promise<Blob> {
  const decoder = new OfflineAudioContext(1, 1, 48_000);
  const buf = await decoder.decodeAudioData(await blob.arrayBuffer());
  const mono = mixToMono(Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)));
  return new Blob([encodeWav(applyPreFx(mono, buf.sampleRate, pre), buf.sampleRate)], { type: 'audio/wav' });
}
