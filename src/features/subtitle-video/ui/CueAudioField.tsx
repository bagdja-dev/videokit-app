'use client';

// Audio cue (narasi/efek) dengan tiga sumber: Unggah file · Rekam dari mikrofon · Generate (TTS, belum aktif).
// Rekaman disimpan sebagai WAV di IndexedDB seperti media unggahan, jadi alur pratinjau & render tidak berubah.
import { useEffect, useRef, useState } from 'react';
import { formatMs, importMedia } from '../media';
import type { Cue, SubtitleVideoProject } from '../model';
import { micSupported, useMicRecorder } from '../mic';
import { usePlayback } from '../playback';
import { loadMedia } from '../storage';
import { useEditor } from '../store';
import MediaButton from './MediaButton';
import { MicCleanupToggle, MicControls } from './MicControls';
import styles from './editor.module.css';

type Source = 'upload' | 'record' | 'generate';
const RECORD_PREFIX = 'rekaman-cue-';

function Recorder({ cue, cueNumber }: { cue: Cue; cueNumber: number }) {
  const { addMedia, setCueAudio } = useEditor.getState();
  const rec = useMicRecorder({
    onDone: async ({ wav }) => {
      const file = new File([wav], `${RECORD_PREFIX}${cueNumber}.wav`, { type: 'audio/wav' });
      const ref = await importMedia(file, ['audio']);
      addMedia(ref);
      setCueAudio(cue.id, { mediaId: ref.id, volume: cue.audio?.volume ?? 1 });
    },
  });

  if (!micSupported()) return <p className={styles.error}>Browser ini tidak mendukung rekam mikrofon. Pakai Chrome/Edge/Safari versi terbaru.</p>;
  const lines = cue.lines.filter((l) => l.trim());
  return (
    <div className={styles.recorder} data-role="cue-recorder" data-state={rec.state}>
      {rec.state === 'recording' && (
        <div className={styles.prompter} aria-label="Teks cue untuk dibaca">
          {lines.length ? lines.map((l, i) => <p key={i} className={i === 0 ? styles.prompterMain : styles.muted}>{l}</p>) : <p className={styles.muted}>(cue tanpa teks)</p>}
        </div>
      )}
      <MicControls rec={rec} role="record" idleLabel={cue.audio ? '● Rekam ulang' : '● Mulai rekam'} targetMs={cue.end_ms - cue.start_ms} />
      {rec.state === 'idle' && !rec.error && (
        <span className={styles.muted}>Teks cue tampil saat merekam. Rekam ulang akan mengganti rekaman sebelumnya (bisa diurungkan).</span>
      )}
      <MicCleanupToggle disabled={rec.state !== 'idle'} />
    </div>
  );
}

/** Putar audio cue saja (tanpa video), untuk mendengar hasil rekaman/unggahan. */
function ListenButton({ mediaId }: { mediaId: string }) {
  const [playing, setPlaying] = useState(false);
  const el = useRef<HTMLAudioElement | null>(null);
  const stop = () => {
    const a = el.current;
    if (!a) return;
    a.pause();
    URL.revokeObjectURL(a.src);
    el.current = null;
    setPlaying(false);
  };
  useEffect(() => stop, [mediaId]);
  const play = async () => {
    const blob = await loadMedia(mediaId);
    if (!blob) return;
    usePlayback.getState().setPlaying(false);
    const a = new Audio(URL.createObjectURL(blob));
    a.onended = stop;
    el.current = a;
    setPlaying(true);
    await a.play().catch(stop);
  };
  return (
    <button className="vk-btn vk-btn-ghost" onClick={() => (playing ? stop() : void play())} data-role="cue-audio-listen">
      {playing ? '■ Stop' : '▶ Dengar'}
    </button>
  );
}

const SOURCES: Array<{ id: Source; label: string; disabled?: boolean; hint?: string }> = [
  { id: 'upload', label: 'Unggah' },
  { id: 'record', label: 'Rekam' },
  { id: 'generate', label: 'Generate', disabled: true, hint: 'Segera: suara AI dari teks cue (TTS)' },
];

export default function CueAudioField({ project, cue, cueNumber }: { project: SubtitleVideoProject; cue: Cue; cueNumber: number }) {
  const { setCueAudio, fitCueToDuration } = useEditor.getState();
  const audioRef = cue.audio ? project.media[cue.audio.mediaId] : undefined;
  const [source, setSource] = useState<Source>(audioRef?.name.startsWith(RECORD_PREFIX) ? 'record' : 'upload');
  const cueMs = cue.end_ms - cue.start_ms;
  const overflow = audioRef?.durationMs && audioRef.durationMs > cueMs + 50 ? audioRef.durationMs : 0;

  return (
    <div className={styles.field} data-role="cue-audio">
      Audio cue (narasi/efek)
      <div className={styles.segmented} role="radiogroup" aria-label="Sumber audio cue">
        {SOURCES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={source === s.id} disabled={s.disabled}
            className={`${styles.segBtn} ${source === s.id ? styles.segActive : ''}`} title={s.hint}
            onClick={() => setSource(s.id)} data-source={s.id}>
            {s.label}{s.disabled && <span className={styles.soon}>Segera</span>}
          </button>
        ))}
      </div>

      {source === 'upload' && (
        <div className={styles.mediaRow}>
          <MediaButton label={audioRef ? 'Ganti audio' : 'Pilih audio'} kinds={['audio']}
            onPicked={(ref) => setCueAudio(cue.id, { mediaId: ref.id, volume: cue.audio?.volume ?? 1 })} />
        </div>
      )}
      {source === 'record' && <Recorder key={cue.id} cue={cue} cueNumber={cueNumber} />}

      {audioRef && cue.audio && (
        <div className={styles.audioCurrent} data-role="cue-audio-current">
          <div className={styles.mediaRow}>
            <span className={styles.audioName}>{audioRef.name}{audioRef.durationMs ? ` · ${formatMs(audioRef.durationMs)}` : ''}</span>
            <ListenButton mediaId={audioRef.id} />
            <button className="vk-btn vk-btn-ghost" onClick={() => setCueAudio(cue.id, undefined)}>Hapus</button>
          </div>
          <label className={styles.check}>Volume
            <input type="range" min={0} max={1.5} step={0.05} value={cue.audio.volume} onChange={(e) => setCueAudio(cue.id, { ...cue.audio!, volume: +e.target.value })} />
          </label>
          {overflow > 0 && (
            <div className={styles.fitHint} data-role="audio-overflow">
              <span>Audio {formatMs(overflow)} lebih panjang dari cue ({formatMs(cueMs)}); sisanya terpotong.</span>
              <button className="vk-btn vk-btn-ghost" onClick={() => fitCueToDuration(cue.id, overflow)} data-role="fit-cue-to-audio">
                Panjangkan cue sesuai audio
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
