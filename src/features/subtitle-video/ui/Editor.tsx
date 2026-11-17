'use client';

import { useEffect, useState } from 'react';
import { decodeSrtBytes, parseSrt, toSrt, type SrtWarning } from '@/core/subtitle/srt';
import { LIMITS, OUTPUT_PRESETS, type OutputPreset } from '../model';
import { loadProject } from '../storage';
import { useEditor } from '../store';
import AudioBackgroundPanel from './AudioBackgroundPanel';
import CueList from './CueList';
import DesignPanel from './DesignPanel';
import RenderPanel from './RenderPanel';
import styles from './editor.module.css';

const SAVE_LABEL = { saved: 'Tersimpan di perangkat', saving: 'Menyimpan…', dirty: 'Belum tersimpan…', error: 'Gagal menyimpan' } as const;

function SrtImport({ hasCues }: { hasCues: boolean }) {
  const importCues = useEditor((s) => s.importCues);
  const [warnings, setWarnings] = useState<SrtWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.field}>
      <span className={`vk-btn ${hasCues ? 'vk-btn-ghost' : ''} ${styles.fileBtn}`} style={{ width: 'fit-content' }}>
        {hasCues ? 'Ganti SRT' : 'Unggah file SRT'}
        <input type="file" accept=".srt,application/x-subrip,text/plain" aria-label="Unggah file SRT"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (hasCues && !confirm('Mengganti SRT akan mengganti semua cue (visual & audio cue ikut terhapus). Lanjutkan?')) return;
            const { text, encoding } = decodeSrtBytes(await file.arrayBuffer());
            const r = parseSrt(text, encoding);
            if (!r.cues.length) { setError('Tidak ada cue yang bisa dibaca dari file ini'); return; }
            if (r.cues.length > LIMITS.maxCues) { setError(`Maksimal ${LIMITS.maxCues} cue`); return; }
            setError(null); setWarnings(r.warnings);
            importCues(r.cues);
          }} />
      </span>
      {error && <span className={styles.error}>{error}</span>}
      {warnings.length > 0 && (
        <div className={styles.warning}>
          {warnings.slice(0, 6).map((w, i) => <div key={i}>{w.cue ? `Cue ${w.cue}: ` : ''}{w.message}</div>)}
          {warnings.length > 6 && <div>…dan {warnings.length - 6} peringatan lain</div>}
        </div>
      )}
    </div>
  );
}

export default function Editor({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const project = useEditor((s) => s.project);
  const saveState = useEditor((s) => s.saveState);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { load, undo, redo, setTitle, setPreset } = useEditor.getState();
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadProject(projectId)
      .then((p) => (p ? load(p) : setLoadError('Project tidak ditemukan di perangkat ini')))
      .catch((e: unknown) => setLoadError(String(e)));
  }, [projectId, load]);

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z / Ctrl+Y = redo (kecuali sedang mengetik di kolom teks)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  if (loadError) return <main className={styles.page}><p className={styles.error}>{loadError}</p><button className="vk-btn" onClick={onBack}>Kembali</button></main>;
  if (!project || project.id !== projectId) return <main className={styles.page}><p className={styles.muted}>Memuat project…</p></main>;

  const downloadSrt = () => {
    const url = URL.createObjectURL(new Blob([toSrt(project.cues)], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${project.title.replace(/[^\w-]+/g, '_') || 'subtitle'}.srt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <button className="vk-btn vk-btn-ghost" onClick={onBack} aria-label="Kembali ke daftar project">←</button>
        <input className={styles.titleInput} value={project.title} maxLength={120} aria-label="Judul project" onChange={(e) => setTitle(e.target.value)} />
        <span className={styles.saveState} role="status">{SAVE_LABEL[saveState]}</span>
        <button className="vk-btn vk-btn-ghost" disabled={!canUndo} onClick={undo} title="Urungkan (Ctrl/Cmd+Z)">↶</button>
        <button className="vk-btn vk-btn-ghost" disabled={!canRedo} onClick={redo} title="Ulangi (Ctrl/Cmd+Shift+Z)">↷</button>
      </div>

      <section className="vk-card" style={{ marginBottom: 16 }}>
        <div className={styles.row} style={{ alignItems: 'flex-end', gap: 16 }}>
          <label className={styles.field}>Ukuran output
            <select value={project.preset} onChange={(e) => setPreset(e.target.value as OutputPreset)}>
              {(Object.keys(OUTPUT_PRESETS) as OutputPreset[]).map((k) => <option key={k} value={k}>{OUTPUT_PRESETS[k].label} — {OUTPUT_PRESETS[k].hint}</option>)}
            </select>
          </label>
          <SrtImport hasCues={project.cues.length > 0} />
          {project.cues.length > 0 && <button className="vk-btn vk-btn-ghost" onClick={downloadSrt}>Unduh SRT</button>}
        </div>
      </section>

      {project.cues.length === 0 ? (
        <section className="vk-card">
          <h2 className={styles.h2}>Mulai dengan file SRT</h2>
          <p className={styles.muted}>Tiap baris teks dalam satu cue diperlakukan sebagai satu bahasa (mis. baris 1 Indonesia, baris 2 English).</p>
        </section>
      ) : (
        <div className={styles.layout}>
          <CueList project={project} />
          <div className={styles.side}>
            <RenderPanel project={project} />
            <AudioBackgroundPanel project={project} />
            <DesignPanel project={project} />
          </div>
        </div>
      )}
    </main>
  );
}
