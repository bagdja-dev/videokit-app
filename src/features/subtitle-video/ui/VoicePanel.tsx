'use client';

// Setting → Suara narasi: preset + pengaturan manual efek suara untuk semua audio cue, dengan "Coba dengar"
// (bandingkan dengan asli). Rangkaian efek = core/render/voice-fx, sama dengan pratinjau & render MP4.
import { useEffect, useRef, useState } from 'react';
import { micSupported, useMicRecorder } from '../mic';
import { buildVoiceChain, hasVoiceFx, preFxFromKey, preFxKey, preFxOf, preprocessBuffer, type VoiceChain, type VoiceFx } from '@/core/render';
import { sortCues, VOICE_PRESETS, type BuiltinVoicePreset, type SubtitleVideoProject, type VoiceSettings } from '../model';
import { usePlayback } from '../playback';
import { loadMedia } from '../storage';
import { useEditor } from '../store';
import { MicCleanupToggle, MicControls } from './MicControls';
import MyVoicePresets from './MyVoicePresets';
import styles from './editor.module.css';

/** Rekaman sampel bertahan selama sesi (tutup-buka modal), tidak disimpan ke project. */
let sessionSample: Blob | null = null;

interface Knob { key: keyof VoiceFx; label: string; hint: string; min: number; max: number; step: number; unit: 'db' | 'hz' | 'pct' | 'st' | 'thick' | 'ms';
  /** Nilai bila belum diisi (default 0). */ defaultValue?: number;
  /** Hanya aktif bila slider ini > 0. */ dependsOn?: keyof VoiceFx }
const KNOBS: Knob[] = [
  { key: 'formant', label: 'Ketebalan (tipis ↔ tebal)', hint: '− suara lebih tipis · + lebih tebal/besar. Nada tidak berubah', min: -1, max: 1, step: 0.05, unit: 'thick' },
  { key: 'pitch_semitones', label: 'Nada (berat ↔ ringan)', hint: '− lebih berat/rendah · + lebih ringan/lembut. Geser sedikit (±1–3) agar tetap alami', min: -6, max: 6, step: 0.5, unit: 'st' },
  { key: 'highpass_hz', label: 'Buang dengung', hint: 'Memotong suara rendah: dengung AC/kipas, getaran meja', min: 0, max: 200, step: 10, unit: 'hz' },
  { key: 'warmth_db', label: 'Hangat', hint: '+ suara lebih berat & empuk · − lebih tipis', min: -6, max: 8, step: 0.5, unit: 'db' },
  { key: 'clarity_db', label: 'Jelas', hint: '+ kata lebih jelas & maju', min: -4, max: 10, step: 0.5, unit: 'db' },
  { key: 'air_db', label: 'Cerah', hint: '+ lebih cerah · − kurangi desis huruf "s"', min: -8, max: 6, step: 0.5, unit: 'db' },
  { key: 'compress', label: 'Ratakan volume', hint: 'Suara pelan dinaikkan, yang keras ditahan', min: 0, max: 1, step: 0.05, unit: 'pct' },
  { key: 'gain_db', label: 'Keras suara', hint: 'Penguatan akhir', min: -6, max: 12, step: 0.5, unit: 'db' },
  { key: 'end_echo', label: 'Gema ujung kalimat', hint: 'Kata terakhir tiap cue dipantulkan beberapa kali, makin pelan', min: 0, max: 1, step: 0.05, unit: 'pct' },
  { key: 'end_echo_delay_ms', label: 'Jarak pantulan gema', hint: 'Pendek = ruangan kecil · panjang = lembah/gunung', min: 100, max: 1000, step: 25, unit: 'ms', defaultValue: 350, dependsOn: 'end_echo' },
  { key: 'reverb', label: 'Gema ruangan', hint: 'Sedikit gema membuat suara rekaman kamar lebih menyatu', min: 0, max: 1, step: 0.05, unit: 'pct' },
];

const fmt = (k: Knob, v: number) =>
  k.unit === 'pct' ? `${Math.round(v * 100)}%`
    : k.unit === 'hz' ? (v > 0 ? `${v} Hz` : 'mati')
      : k.unit === 'st' ? (v === 0 ? 'asli' : `${v > 0 ? '+' : ''}${v} semiton`)
        : k.unit === 'thick' ? (v === 0 ? 'asli' : `${v > 0 ? 'tebal' : 'tipis'} ${Math.round(Math.abs(v) * 100)}%`)
        : k.unit === 'ms' ? `${v} ms`
          : `${v > 0 ? '+' : ''}${v} dB`;

const PRESET_ORDER: BuiltinVoicePreset[] = ['off', 'clear', 'warm', 'storyteller'];

/** Contoh audio untuk "Coba dengar": audio cue terpilih, atau audio cue pertama. */
function sampleCue(project: SubtitleVideoProject, selectedId: string | null) {
  const withAudio = sortCues(project.cues).filter((c) => c.audio);
  const i = Math.max(0, withAudio.findIndex((c) => c.id === selectedId));
  const cue = withAudio[i];
  return cue ? { cue, number: sortCues(project.cues).indexOf(cue) + 1, name: project.media[cue.audio!.mediaId]?.name ?? 'audio' } : null;
}

interface TryState {
  ctx: AudioContext;
  src: AudioBufferSourceNode;
  pre: GainNode;
  chain: VoiceChain | null;
  /** Audio asli (sebelum pra-proses) & kunci pra-proses (nada/ketebalan) yang sedang terpasang pada `src`. */
  orig: AudioBuffer;
  applied: string;
  /** Jam ctx saat `src` mulai & posisi awalnya — untuk melanjutkan dari titik yang sama saat nada diganti. */
  startedAt: number;
  offset: number;
}

function useTryListen(fx: VoiceFx, bypass: boolean) {
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = useRef<TryState | null>(null);
  const { pitch_semitones: _p, formant: _f, end_echo: _e, end_echo_delay_ms: _d, ...chainFx } = fx; // eslint-disable-line @typescript-eslint/no-unused-vars
  const fxKey = !bypass && hasVoiceFx(chainFx) ? JSON.stringify(chainFx) : '';
  const preKey = bypass ? '' : preFxKey(preFxOf(fx));

  const wire = (key: string) => {
    const s = st.current;
    if (!s) return;
    s.pre.disconnect();
    s.chain?.disconnect();
    s.chain = key ? buildVoiceChain(s.ctx, JSON.parse(key)) : null;
    if (s.chain) { s.pre.connect(s.chain.input); s.chain.output.connect(s.ctx.destination); }
    else s.pre.connect(s.ctx.destination);
  };
  useEffect(() => { wire(fxKey); }, [fxKey]);

  /** Putar `orig` setelah pra-proses `key`, mulai dari posisi `pos` (detik), berulang. */
  const startSource = (s: TryState, key: string, pos: number) => {
    const pre = preFxFromKey(key);
    const buffer = pre ? preprocessBuffer(s.ctx, s.orig, pre) : s.orig;
    const src = s.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(s.pre);
    const at = buffer.duration > 0 ? pos % buffer.duration : 0;
    src.start(0, at);
    Object.assign(s, { src, applied: key, startedAt: s.ctx.currentTime, offset: at });
  };

  // Nada/ketebalan berubah saat diputar → proses ulang (ditunda sebentar saat slider digeser), lanjut dari posisi sama.
  useEffect(() => {
    const s = st.current;
    if (!s || s.applied === preKey) return;
    const t = setTimeout(() => {
      const cur = st.current;
      if (!cur || cur.applied === preKey) return;
      const pos = cur.offset + (cur.ctx.currentTime - cur.startedAt);
      try { cur.src.stop(); } catch { /* sudah berhenti */ }
      cur.src.disconnect();
      startSource(cur, preKey, pos);
    }, 250);
    return () => clearTimeout(t);
  }, [preKey]);

  const stop = () => {
    const s = st.current;
    st.current = null;
    setPlaying(false);
    if (s) { try { s.src.stop(); } catch { /* sudah berhenti */ } void s.ctx.close().catch(() => undefined); }
  };
  useEffect(() => stop, []);

  const play = async (blob: Blob | undefined, volume = 1) => {
    stop();
    if (!blob) return;
    usePlayback.getState().setPlaying(false);
    setBusy(true);
    try {
      const ctx = new AudioContext();
      const orig = await ctx.decodeAudioData(await blob.arrayBuffer());
      const pre = ctx.createGain();
      pre.gain.value = volume;
      const s: TryState = { ctx, src: ctx.createBufferSource(), pre, chain: null, orig, applied: '', startedAt: 0, offset: 0 };
      st.current = s;
      wire(fxKey);
      startSource(s, preKey, 0);
      setPlaying(true);
    } finally {
      setBusy(false);
    }
  };
  return { playing, busy, play, stop };
}

export default function VoicePanel({ project }: { project: SubtitleVideoProject }) {
  const setVoice = useEditor((s) => s.setVoice);
  const selected = useEditor((s) => s.selectedCueId);
  const voice: VoiceSettings = project.voice ?? { preset: 'off', fx: {} };
  const [bypass, setBypass] = useState(false);
  const listen = useTryListen(voice.fx, bypass);
  const cueSample = sampleCue(project, selected);
  const [sample, setSample] = useState<Blob | null>(() => sessionSample);
  const [src, setSrc] = useState<'sample' | 'cue'>(() => (sessionSample || !cueSample ? 'sample' : 'cue'));
  const rec = useMicRecorder({
    maxMs: 60_000,
    onDone: ({ wav }) => {
      const blob = new Blob([wav], { type: 'audio/wav' });
      sessionSample = blob;
      setSample(blob);
      void listen.play(blob); // langsung putar berulang supaya bisa langsung disetel
    },
  });
  const selCue = project.cues.find((c) => c.id === selected);
  const prompt = selCue?.lines.find((l) => l.trim()) ?? 'Pilih satu cue dulu supaya teksnya tampil di sini, atau baca bebas satu-dua kalimat naskahmu.';
  const canPlay = src === 'sample' ? !!sample : !!cueSample;
  const playCurrent = async () => {
    if (src === 'sample') return listen.play(sample ?? undefined);
    if (cueSample) return listen.play(await loadMedia(cueSample.cue.audio!.mediaId), cueSample.cue.audio!.volume);
  };

  const choosePreset = (p: BuiltinVoicePreset) => setVoice(p === 'off' ? undefined : { preset: p, fx: { ...VOICE_PRESETS[p].fx } });
  // Ubah slider → kustom; preset akun yang terakhir dipakai tetap dicatat (untuk "Perbarui").
  const setKnob = (k: keyof VoiceFx, v: number) => setVoice({ ...voice, preset: 'custom', fx: { ...voice.fx, [k]: v } });

  return (
    <section className="vk-card" data-role="voice-panel">
      <p className={styles.muted}>Berlaku untuk semua audio cue (narasi/rekaman). Musik & audio latar tidak terpengaruh. Hasilnya sama di pratinjau dan video akhir.</p>

      <div className={styles.field}>Preset
        <div className={styles.presetGrid} role="radiogroup" aria-label="Preset suara">
          {PRESET_ORDER.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={voice.preset === p} data-preset={p}
              className={`${styles.presetBtn} ${voice.preset === p ? styles.presetActive : ''}`} onClick={() => choosePreset(p)}>
              <strong>{VOICE_PRESETS[p].label}</strong>
              <span>{VOICE_PRESETS[p].hint}</span>
            </button>
          ))}
        </div>
        {voice.preset === 'custom' && <span className={styles.muted} data-role="voice-custom">Kustom: diubah dari preset.</span>}
      </div>

      <MyVoicePresets voice={voice} />

      <div className={styles.tryBox} data-role="voice-try">
        <strong className={styles.tryTitle}>Uji coba suara</strong>
        <div className={styles.segmented} role="radiogroup" aria-label="Sumber uji coba">
          <button type="button" role="radio" aria-checked={src === 'sample'} data-try-source="sample"
            className={`${styles.segBtn} ${src === 'sample' ? styles.segActive : ''}`} onClick={() => { listen.stop(); setSrc('sample'); }}>Rekam sampel</button>
          <button type="button" role="radio" aria-checked={src === 'cue'} data-try-source="cue" disabled={!cueSample}
            title={cueSample ? undefined : 'Belum ada audio cue'}
            className={`${styles.segBtn} ${src === 'cue' ? styles.segActive : ''}`} onClick={() => { listen.stop(); setSrc('cue'); }}>
            {cueSample ? `Audio cue #${cueSample.number}` : 'Audio cue'}
          </button>
        </div>

        {src === 'sample' && (
          micSupported() ? (
            <div className={styles.recorder} data-role="voice-sample">
              <div className={styles.prompter}>
                <span className={styles.muted}>Baca dengan gaya narasimu, ±5–10 detik:</span>
                <p className={styles.prompterMain}>{prompt}</p>
              </div>
              <MicControls rec={rec} role="sample" idleLabel={sample ? '● Rekam ulang sampel' : '● Rekam sampel'} />
              <MicCleanupToggle disabled={rec.state !== 'idle'} />
              {sample && rec.state === 'idle' && <span className={styles.muted} data-role="sample-ready">Sampel siap. Putar, lalu geser preset/slider sambil mendengar.</span>}
            </div>
          ) : <span className={styles.error}>Browser ini tidak mendukung rekam mikrofon.</span>
        )}
        {src === 'cue' && cueSample && <span className={styles.muted}>Cue #{cueSample.number} · {cueSample.name}</span>}

        <div className={styles.mediaRow}>
          <button className="vk-btn" disabled={!canPlay || rec.state !== 'idle'} data-role="voice-try-play"
            onClick={() => (listen.playing ? listen.stop() : void playCurrent())}>
            {listen.busy ? 'Menyiapkan…' : listen.playing ? '■ Stop' : '▶ Coba dengar (diulang)'}
          </button>
          <label className={styles.check}>
            <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} data-role="voice-bypass" />
            Dengar suara asli
          </label>
        </div>
      </div>

      <div className={styles.knobs}>
        {KNOBS.map((k) => {
          const v = voice.fx[k.key] ?? k.defaultValue ?? 0;
          const off = !!k.dependsOn && !(voice.fx[k.dependsOn] ?? 0);
          return (
            <label key={k.key} className={`${styles.knob} ${off ? styles.knobOff : ''}`} title={k.hint}>
              <span className={styles.knobHead}><span>{k.label}</span><output>{fmt(k, v)}</output></span>
              <input type="range" min={k.min} max={k.max} step={k.step} value={v} data-knob={k.key} disabled={off}
                onChange={(e) => setKnob(k.key, +e.target.value)} />
              <span className={styles.knobHint}>{k.hint}</span>
            </label>
          );
        })}
      </div>
      <p className={styles.muted}>Tips: rekam di ruangan kecil yang banyak kain (lemari baju, kamar dengan kasur), jarak mulut ±15 cm dari HP/mikrofon. Efek membantu, tapi rekaman yang bersih tetap paling penting.</p>
    </section>
  );
}
