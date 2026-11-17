'use client';

import type { Fit } from '@/core/render';
import type { SubtitleVideoProject } from '../model';
import { useEditor } from '../store';
import MediaButton from './MediaButton';
import styles from './editor.module.css';

export default function AudioBackgroundPanel({ project }: { project: SubtitleVideoProject }) {
  const { setMusic, setBackgroundVideo, setDuckingLevel } = useEditor.getState();
  const music = project.music, bg = project.backgroundVideo;
  const bgRef = bg ? project.media[bg.mediaId] : undefined;

  return (
    <section className="vk-card">
      <h2 className={styles.h2}>Latar</h2>

      <div className={styles.field}>Musik latar (opsional)
        <div className={styles.mediaRow}>
          <MediaButton label={music ? 'Ganti musik' : 'Pilih musik'} kinds={['audio']} onPicked={(ref) => setMusic({ mediaId: ref.id, volume: music?.volume ?? 0.8 })} />
          {music && <span>{project.media[music.mediaId]?.name}</span>}
          {music && (
            <>
              <label className={styles.check}>Volume
                <input type="range" min={0} max={1} step={0.05} value={music.volume} onChange={(e) => setMusic({ ...music, volume: +e.target.value })} />
              </label>
              <button className="vk-btn vk-btn-ghost" onClick={() => setMusic(undefined)}>Hapus</button>
            </>
          )}
        </div>
      </div>

      <div className={styles.field} style={{ marginTop: 12 }}>Video latar (opsional) — diputar berulang di bawah semua visual; tampil pada cue tanpa visual
        <div className={styles.mediaRow}>
          <MediaButton label={bg ? 'Ganti video latar' : 'Pilih video/gambar latar'} kinds={['video', 'image']}
            onPicked={(ref) => setBackgroundVideo({ mediaId: ref.id, fit: bg?.fit ?? 'cover', withAudio: bg?.withAudio ?? false, volume: bg?.volume ?? 0.5 })} />
          {bgRef && <span>{bgRef.name}</span>}
          {bg && <button className="vk-btn vk-btn-ghost" onClick={() => setBackgroundVideo(undefined)}>Hapus</button>}
        </div>
      </div>
      {bg && (
        <div className={styles.row} style={{ marginTop: 8 }}>
          <label className={styles.field}>Tampilan
            <select value={bg.fit} onChange={(e) => setBackgroundVideo({ ...bg, fit: e.target.value as Fit })}>
              <option value="cover">Penuh (potong)</option><option value="contain">Utuh</option><option value="blur">Utuh + blur</option>
            </select>
          </label>
          {bgRef?.kind === 'video' && (
            <label className={styles.check}>
              <input type="checkbox" checked={bg.withAudio} onChange={(e) => setBackgroundVideo({ ...bg, withAudio: e.target.checked })} />
              With audio
            </label>
          )}
          {bg.withAudio && (
            <label className={styles.check}>Volume
              <input type="range" min={0} max={1} step={0.05} value={bg.volume} onChange={(e) => setBackgroundVideo({ ...bg, volume: +e.target.value })} />
            </label>
          )}
        </div>
      )}

      {(music || bg?.withAudio) && (
        <label className={styles.field} style={{ marginTop: 12 }}>Volume latar saat narasi berbunyi (ducking): {Math.round(project.duckingLevel * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={project.duckingLevel} onChange={(e) => setDuckingLevel(+e.target.value)} />
        </label>
      )}
    </section>
  );
}
