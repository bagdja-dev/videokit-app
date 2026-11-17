'use client';

import type { Fit, Underflow } from '@/core/render';
import { formatMs } from '../media';
import type { Cue, SubtitleVideoProject } from '../model';
import { useEditor } from '../store';
import MediaButton from './MediaButton';
import styles from './editor.module.css';

const FIT_LABEL: Record<Fit, string> = { cover: 'Penuh (potong)', contain: 'Utuh (bergaris)', blur: 'Utuh + latar blur' };

function CueEditor({ cue, project, isLast }: { cue: Cue; project: SubtitleVideoProject; isLast: boolean }) {
  const { setCueVisual, setCueAudio, updateCueLines, extendVisualToNext } = useEditor.getState();
  const visualRef = cue.visual ? project.media[cue.visual.mediaId] : undefined;
  const audioRef = cue.audio ? project.media[cue.audio.mediaId] : undefined;

  return (
    <div className={styles.cueEditor} data-role="cue-editor" onClick={(e) => e.stopPropagation()}>
      <label className={styles.field}>Teks (satu baris per bahasa)
        <textarea rows={Math.max(2, cue.lines.length)} defaultValue={cue.lines.join('\n')} key={cue.id + cue.lines.join('|')}
          onBlur={(e) => {
            const lines = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean);
            if (lines.length && lines.join('\n') !== cue.lines.join('\n')) updateCueLines(cue.id, lines);
          }} />
      </label>

      <div className={styles.field}>Visual
        <div className={styles.mediaRow}>
          <MediaButton label={visualRef ? 'Ganti visual' : 'Pilih video/gambar'} kinds={['video', 'image']}
            onPicked={(ref) => setCueVisual(cue.id, { mediaId: ref.id, fit: cue.visual?.fit ?? 'blur', sourceInMs: 0, underflow: 'freeze', keepAudio: false })} />
          {visualRef && <span>{visualRef.name}{visualRef.durationMs ? ` · ${formatMs(visualRef.durationMs)}` : ''}</span>}
          {cue.visual && <button className="vk-btn vk-btn-ghost" onClick={() => setCueVisual(cue.id, undefined)}>Hapus</button>}
        </div>
      </div>
      {cue.visual && (
        <div className={styles.grid2}>
          <label className={styles.field}>Tampilan
            <select value={cue.visual.fit} onChange={(e) => setCueVisual(cue.id, { ...cue.visual!, fit: e.target.value as Fit })}>
              {(Object.keys(FIT_LABEL) as Fit[]).map((f) => <option key={f} value={f}>{FIT_LABEL[f]}</option>)}
            </select>
          </label>
          {visualRef?.kind === 'video' && (
            <>
              <label className={styles.field}>Mulai klip dari (detik)
                <input type="number" min={0} step={0.1} value={(cue.visual.sourceInMs / 1000).toFixed(1)}
                  onChange={(e) => setCueVisual(cue.id, { ...cue.visual!, sourceInMs: Math.max(0, Math.round(+e.target.value * 1000)) })} />
              </label>
              <label className={styles.field}>Bila klip lebih pendek
                <select value={cue.visual.underflow} onChange={(e) => setCueVisual(cue.id, { ...cue.visual!, underflow: e.target.value as Underflow })}>
                  <option value="freeze">Tahan frame terakhir</option>
                  <option value="loop">Ulang (loop)</option>
                </select>
              </label>
              <label className={styles.check}>
                <input type="checkbox" checked={cue.visual.keepAudio} onChange={(e) => setCueVisual(cue.id, { ...cue.visual!, keepAudio: e.target.checked })} />
                Pakai suara asli klip
              </label>
            </>
          )}
          {!isLast && <button className="vk-btn vk-btn-ghost" onClick={() => extendVisualToNext(cue.id)}>Lanjutkan ke cue berikutnya</button>}
        </div>
      )}

      <div className={styles.field}>Audio cue (narasi/efek)
        <div className={styles.mediaRow}>
          <MediaButton label={audioRef ? 'Ganti audio' : 'Pilih audio'} kinds={['audio']}
            onPicked={(ref) => setCueAudio(cue.id, { mediaId: ref.id, volume: cue.audio?.volume ?? 1 })} />
          {audioRef && <span>{audioRef.name}</span>}
          {cue.audio && (
            <>
              <label className={styles.check}>Volume
                <input type="range" min={0} max={1.5} step={0.05} value={cue.audio.volume} onChange={(e) => setCueAudio(cue.id, { ...cue.audio!, volume: +e.target.value })} />
              </label>
              <button className="vk-btn vk-btn-ghost" onClick={() => setCueAudio(cue.id, undefined)}>Hapus</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CueList({ project }: { project: SubtitleVideoProject }) {
  const selected = useEditor((s) => s.selectedCueId);
  const select = useEditor((s) => s.select);
  const cues = [...project.cues].sort((a, b) => a.start_ms - b.start_ms);
  const withVisual = cues.filter((c) => c.visual).length;

  return (
    <section className="vk-card">
      <h2 className={styles.h2}>Cue ({cues.length}) <span className={styles.muted}>· {withVisual} berisi visual</span></h2>
      <div className={styles.cueList}>
        {cues.map((c, i) => {
          const isSel = c.id === selected;
          return (
            <div key={c.id} data-cue={i + 1} data-selected={isSel || undefined} className={`${styles.cue} ${isSel ? styles.cueSelected : ''}`} onClick={() => select(isSel ? null : c.id)}>
              <div className={styles.cueHead}><span>#{i + 1}</span><span>{formatMs(c.start_ms)} → {formatMs(c.end_ms)}</span></div>
              <div className={styles.cueLines}>
                {c.lines.map((l, k) => <span key={k} className={k > 0 ? styles.cueLine2 : undefined}>{l}</span>)}
              </div>
              <div className={styles.chips}>
                {c.visual ? <span className={styles.chip}>🎞 {project.media[c.visual.mediaId]?.name ?? 'visual'}</span>
                  : <span className={`${styles.chip} ${styles.chipMissing}`}>{project.backgroundVideo ? 'latar' : 'tanpa visual'}</span>}
                {c.audio && <span className={styles.chip}>🔊 audio</span>}
              </div>
              {isSel && <CueEditor cue={c} project={project} isLast={i === cues.length - 1} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
