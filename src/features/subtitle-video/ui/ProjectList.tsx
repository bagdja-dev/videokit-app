'use client';

import { useEffect, useState } from 'react';
import { createProject, OUTPUT_PRESETS, type OutputPreset } from '../model';
import { listProjects, requestPersistence, saveProject, type ProjectSummary } from '../storage';
import styles from './editor.module.css';

export default function ProjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [title, setTitle] = useState('Video baru');
  const [preset, setPreset] = useState<OutputPreset>('9x16');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProjects().then(setProjects).catch((e: unknown) => setError(`Penyimpanan lokal tidak tersedia: ${String(e)}`));
  }, []);

  const create = async () => {
    const p = createProject(title.trim() || 'Video baru', preset);
    await saveProject(p);
    void requestPersistence();
    onOpen(p.id);
  };

  return (
    <main className={styles.page}>
      <h1 style={{ margin: '0 0 4px', color: 'var(--vk-primary)' }}>Video Lyric Editor</h1>
      <p className={styles.muted}>Unggah SRT, isi tiap baris dengan klip atau gambar, atur gaya teks per bahasa. Semua diproses di perangkat ini.</p>

      <section className="vk-card" style={{ margin: '16px 0' }}>
        <h2 className={styles.h2}>Buat project</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <label className={styles.field}>Judul
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </label>
          <div className={styles.presets} role="radiogroup" aria-label="Ukuran output">
            {(Object.keys(OUTPUT_PRESETS) as OutputPreset[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={preset === k}
                className={`${styles.preset} ${preset === k ? styles.presetActive : ''}`} onClick={() => setPreset(k)}>
                <strong>{OUTPUT_PRESETS[k].label}</strong>
                <div className={styles.muted}>{OUTPUT_PRESETS[k].width}×{OUTPUT_PRESETS[k].height} · {OUTPUT_PRESETS[k].hint}</div>
              </button>
            ))}
          </div>
          <div><button className="vk-btn" onClick={() => void create()}>Buat &amp; buka</button></div>
        </div>
      </section>

      <h2 className={styles.h2}>Project di perangkat ini</h2>
      {error && <p className={styles.error}>{error}</p>}
      {projects && !projects.length && <p className={styles.muted}>Belum ada project.</p>}
      <div className={styles.projects}>
        {projects?.map((p) => (
          <button key={p.id} className={`vk-card ${styles.projectCard}`} onClick={() => onOpen(p.id)}>
            <strong>{p.title}</strong>
            <span className={styles.muted}>{OUTPUT_PRESETS[p.preset].label} · {p.cueCount} cue</span>
            <span className={styles.muted}>Diubah {new Date(p.updatedAt).toLocaleString('id-ID')}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
