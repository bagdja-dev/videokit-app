'use client';

import { useState } from 'react';
import { sortCues, type SubtitleVideoProject } from '../model';
import { formatTime, usePlayback } from '../playback';
import { useEditor } from '../store';
import SideModal from './SideModal';
import styles from './editor.module.css';

type Mode = 'by' | 'to';
type Scope = 'all' | 'from';

/** Geser semua cue sekaligus: "geser sebesar ±detik" atau "cue pertama mulai di detik X". Satu langkah undo. */
export default function ShiftCuesModal({ project, open, onClose }: { project: SubtitleVideoProject; open: boolean; onClose: () => void }) {
  const shiftCues = useEditor((s) => s.shiftCues);
  const shiftCuesFrom = useEditor((s) => s.shiftCuesFrom);
  const selectedId = useEditor((s) => s.selectedCueId);
  const [scope, setScope] = useState<Scope>('all');
  const [mode, setMode] = useState<Mode>('by');
  const [bySec, setBySec] = useState(0);
  const [toSec, setToSec] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const sorted = sortCues(project.cues);
  const selIdx = sorted.findIndex((c) => c.id === selectedId);
  const effScope: Scope = scope === 'from' && selIdx >= 0 ? 'from' : 'all';
  const anchorIdx = effScope === 'from' ? selIdx : 0;
  const first = sorted[anchorIdx]?.start_ms ?? 0;
  // batas mundur: 0 untuk semua cue; akhir cue sebelumnya untuk "mulai dari cue terpilih"
  const floor = effScope === 'from' && anchorIdx > 0 ? sorted[anchorIdx - 1]!.end_ms : 0;
  const lastEnd = sorted.length ? Math.max(...sorted.map((c) => c.end_ms)) : 0;
  const requested = Math.round((mode === 'by' ? bySec * 1000 : toSec * 1000 - first));
  const delta = Math.max(floor - first, requested);
  const firstLabel = effScope === 'from' ? `Cue #${anchorIdx + 1}` : 'Cue pertama';
  const nudge = (s: number) => setBySec((v) => Math.round((v + s) * 10) / 10);

  const apply = () => {
    const applied = effScope === 'from' ? shiftCuesFrom(sorted[anchorIdx]!.id, delta) : shiftCues(delta);
    if (applied !== 0) usePlayback.getState().seek(first + applied);
    setNote(null);
    setBySec(0);
    onClose();
  };

  return (
    <SideModal open={open} onClose={() => { setNote(null); onClose(); }} title="Geser cue" role="shift-modal">
      <p className={styles.muted}>
        Semua cue bergeser bersama visual & audio cue-nya. Musik latar dan video latar tidak ikut bergeser (diputar sepanjang video).
      </p>
      <div className={styles.modalForm}>
        <div className={styles.row} role="radiogroup" aria-label="Cue yang digeser">
          <label className={styles.check}><input type="radio" name="shift-scope" checked={effScope === 'all'} onChange={() => setScope('all')} />Semua cue</label>
          <label className={styles.check}>
            <input type="radio" name="shift-scope" checked={effScope === 'from'} disabled={selIdx < 0} onChange={() => setScope('from')} />
            {selIdx >= 0 ? `Mulai dari cue #${selIdx + 1} & sesudahnya` : 'Mulai dari cue terpilih (pilih cue dulu)'}
          </label>
        </div>
        <div className={styles.row} role="radiogroup" aria-label="Cara menggeser">
          <label className={styles.check}><input type="radio" name="shift-mode" checked={mode === 'by'} onChange={() => setMode('by')} />Geser sebesar</label>
          <label className={styles.check}><input type="radio" name="shift-mode" checked={mode === 'to'} onChange={() => { setMode('to'); setToSec(Math.round(first / 100) / 10); }} />{firstLabel} mulai di</label>
        </div>
        {mode === 'by' ? (
          <>
            <label className={styles.field}>Geser (detik; negatif = lebih cepat)
              <input type="number" step={0.1} value={bySec} aria-label="Geser detik" onChange={(e) => setBySec(+e.target.value)} />
            </label>
            <div className={styles.row}>
              {[-1, -0.1, 0.1, 1].map((s) => (
                <button key={s} className="vk-btn vk-btn-ghost" onClick={() => nudge(s)}>{s > 0 ? `+${String(s).replace('.', ',')}` : String(s).replace('.', ',')} dtk</button>
              ))}
            </div>
          </>
        ) : (
          <label className={styles.field}>Detik mulai {firstLabel.toLowerCase()}
            <input type="number" step={0.1} min={0} value={toSec} aria-label="Mulai cue pertama" onChange={(e) => setToSec(Math.max(0, +e.target.value))} />
          </label>
        )}
        <div className={styles.summary} data-role="shift-preview">
          <span>{firstLabel}: {formatTime(first)} → <strong>{formatTime(first + delta)}</strong></span>
          <span>Cue terakhir berakhir: {formatTime(lastEnd)} → <strong>{formatTime(lastEnd + delta)}</strong></span>
          {requested < delta && <span className={styles.error}>{effScope === 'from' ? `Dibatasi: tidak boleh menimpa cue #${anchorIdx}.` : 'Dibatasi: cue pertama tidak bisa sebelum 0:00.'}</span>}
        </div>
        {note && <p className={styles.error}>{note}</p>}
        <button className="vk-btn" disabled={delta === 0} onClick={apply} data-role="shift-apply">
          {delta === 0 ? 'Tidak ada perubahan' : `Geser ${delta > 0 ? '+' : ''}${(delta / 1000).toFixed(1).replace('.', ',')} detik`}
        </button>
      </div>
    </SideModal>
  );
}
