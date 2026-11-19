'use client';

// Tombol rekam/stop + timer + meter level + peringatan suara pecah — dipakai perekam cue & rekam sampel.
import { formatMs } from '../media';
import { getMicCleanup, setMicCleanup, type useMicRecorder } from '../mic';
import { useState } from 'react';
import styles from './editor.module.css';

type Rec = ReturnType<typeof useMicRecorder>;

export function MicControls({ rec, idleLabel, targetMs, role }: { rec: Rec; idleLabel: string; targetMs?: number; role: string }) {
  return (
    <>
      <div className={styles.mediaRow}>
        {rec.state === 'recording' ? (
          <button className={`vk-btn ${styles.recStop}`} onClick={rec.stop} data-role={`${role}-stop`}>■ Stop</button>
        ) : (
          <button className={`vk-btn ${styles.recBtn}`} onClick={() => void rec.start()} disabled={rec.state !== 'idle'} data-role={`${role}-start`}>
            {rec.state === 'starting' ? 'Menyiapkan mikrofon…' : rec.state === 'processing' ? 'Memproses…' : idleLabel}
          </button>
        )}
        {rec.state === 'recording' && (
          <>
            <span className={styles.recTime}>
              <span className={styles.recDot} aria-hidden />{formatMs(rec.elapsed)}
              {targetMs !== undefined && <span className={styles.muted}> / cue {formatMs(targetMs)}</span>}
            </span>
            <span className={styles.meter} aria-hidden data-hot={rec.level >= 0.9 || undefined}><span style={{ width: `${Math.min(100, Math.round(rec.level * 140))}%` }} /></span>
          </>
        )}
      </div>
      {rec.clipped && (
        <span className={styles.warn} role="status" data-role={`${role}-clipped`}>
          Suara sempat terlalu keras (pecah). Jauhkan sedikit mulut dari mikrofon atau bicara lebih pelan, lalu rekam ulang.
        </span>
      )}
      {rec.error && <span className={styles.error} role="alert">{rec.error}</span>}
    </>
  );
}

/** Saklar peredam bising bawaan browser (preferensi per perangkat, berlaku untuk rekaman berikutnya). */
export function MicCleanupToggle({ disabled }: { disabled?: boolean }) {
  const [on, setOn] = useState(getMicCleanup);
  return (
    <label className={styles.check} title="Matikan bila suara terdengar seperti robot, bergelombang, atau volumenya naik-turun sendiri">
      <input type="checkbox" checked={on} disabled={disabled} data-role="mic-cleanup"
        onChange={(e) => { setMicCleanup(e.target.checked); setOn(e.target.checked); }} />
      Peredam bising bawaan browser
    </label>
  );
}
