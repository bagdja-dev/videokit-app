'use client';

// Panel kanan editor: Setting · Subtitle · Display · Visual. Tab Subtitle & Visual bekerja pada cue terpilih
// (dipilih dari timeline); hasilnya langsung terlihat di pratinjau kiri.
import { useState } from 'react';
import { FONT_FAMILIES, findFamily, type Fit, type Underflow } from '@/core/render';
import type { LineStyleOverride } from '@/core/subtitle/ass';
import { formatMs } from '../media';
import { OUTPUT_PRESETS, sortCues, type Cue, type OutputPreset, type SubtitleVideoProject } from '../model';
import { usePlayback } from '../playback';
import { useEditor } from '../store';
import AudioBackgroundPanel from './AudioBackgroundPanel';
import DesignPanel from './DesignPanel';
import MediaButton from './MediaButton';
import SideModal from './SideModal';
import styles from './editor.module.css';

type Tab = 'setting' | 'subtitle' | 'visual';
const TABS: Array<[Tab, string]> = [['setting', 'Setting'], ['subtitle', 'Subtitle'], ['visual', 'Visual']];
const ANCHOR_LABEL = { bottom: 'Bawah', middle: 'Tengah', top: 'Atas' } as const;
const FIT_LABEL: Record<Fit, string> = { cover: 'Penuh (potong)', contain: 'Utuh (bergaris)', blur: 'Utuh + latar blur' };

function useSelectedCue(project: SubtitleVideoProject): { cue: Cue | null; index: number; isLast: boolean } {
  const selected = useEditor((s) => s.selectedCueId);
  const sorted = sortCues(project.cues);
  const index = sorted.findIndex((c) => c.id === selected);
  return { cue: index >= 0 ? sorted[index]! : null, index, isLast: index === sorted.length - 1 };
}

function NoCue() {
  return <p className={styles.muted}>Pilih cue di timeline bawah (atau sisipkan cue baru) untuk mengeditnya.</p>;
}

/**
 * Gaya satu baris pada cue terpilih. Di tab hanya ringkasan (contoh warna · font · ukuran) + tombol Gaya;
 * semua pengaturan & Reset ada di modal agar tab tetap rapi. Tanpa override = ikut gaya global (Setting).
 */
function LineStyleRow({ project, cue, line }: { project: SubtitleVideoProject; cue: Cue; line: number }) {
  const { setCueLineStyle, resetCueLineStyle } = useEditor.getState();
  const [open, setOpen] = useState(false);
  const slot = project.design.slots[Math.min(line, project.design.slots.length - 1)]!;
  const o = cue.lineStyles?.[line] ?? null;
  const eff = { ...slot, ...(o ?? {}) };
  const family = findFamily(eff.font);
  const set = (patch: LineStyleOverride) => setCueLineStyle(cue.id, line, patch);
  const overridden = !!o && Object.keys(o).length > 0;
  return (
    <div className={styles.styleRow} data-role={`line-style-${line}`} data-overridden={overridden || undefined}>
      <span className={styles.swatch} style={{ background: eff.color, borderColor: eff.outlineColor }} aria-hidden />
      <span className={styles.styleSummary}>{eff.font} · {eff.size}px{eff.bold ? ' · tebal' : ''}{eff.italic ? ' · miring' : ''}{eff.box ? ' · kotak' : ''}</span>
      <button className={`vk-btn vk-btn-ghost ${overridden ? styles.styleBtnOn : ''}`} aria-haspopup="dialog" onClick={() => setOpen(true)}
        title={overridden ? 'Gaya khusus cue ini aktif' : 'Atur gaya baris ini untuk cue ini'}>Gaya</button>
      <SideModal open={open} onClose={() => setOpen(false)} title={`Gaya baris ${line + 1} · cue ini`} role="line-style-modal">
        <p className={styles.muted}>Hanya berlaku untuk cue ini. Gaya default semua cue diatur di Setting → Subtitle global.</p>
        <div className={styles.modalForm}>
          <label className={styles.field}>Font
            <select value={eff.font} onChange={(e) => set({ font: e.target.value })}>
              {FONT_FAMILIES.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
            </select>
          </label>
          <div className={styles.grid2}>
            <label className={styles.field}>Ukuran (px)
              <input type="number" min={12} max={200} value={eff.size} onChange={(e) => set({ size: +e.target.value })} />
            </label>
            <label className={styles.field}>Warna teks
              <input type="color" value={eff.color} onChange={(e) => set({ color: e.target.value.toUpperCase() })} />
            </label>
            <label className={styles.field}>Warna garis tepi
              <input type="color" value={eff.outlineColor} onChange={(e) => set({ outlineColor: e.target.value.toUpperCase() })} />
            </label>
            <label className={styles.field}>Tebal garis tepi
              <input type="number" min={0} max={20} value={eff.outline} onChange={(e) => set({ outline: +e.target.value })} />
            </label>
          </div>
          <div className={styles.row}>
            <label className={styles.check}><input type="checkbox" checked={eff.bold} disabled={!family?.files.bold} onChange={(e) => set({ bold: e.target.checked })} />Tebal</label>
            <label className={styles.check}><input type="checkbox" checked={eff.italic} disabled={!family?.files.italic} onChange={(e) => set({ italic: e.target.checked })} />Miring</label>
            <label className={styles.check}><input type="checkbox" checked={eff.box} onChange={(e) => set({ box: e.target.checked })} />Kotak latar</label>
          </div>
          {eff.box && (
            <div className={styles.grid2}>
              <label className={styles.field}>Warna kotak
                <input type="color" value={eff.boxColor} onChange={(e) => set({ boxColor: e.target.value.toUpperCase() })} />
              </label>
              <label className={styles.field}>Opasitas kotak ({eff.boxOpacity}%)
                <input type="range" min={0} max={100} value={eff.boxOpacity} onChange={(e) => set({ boxOpacity: +e.target.value })} />
              </label>
            </div>
          )}
          <button className="vk-btn vk-btn-ghost" disabled={!overridden} onClick={() => resetCueLineStyle(cue.id, line)}>Reset ke gaya global</button>
        </div>
      </SideModal>
    </div>
  );
}

function SubtitleTab({ project }: { project: SubtitleVideoProject }) {
  const { cue, index } = useSelectedCue(project);
  const { updateCueLine, updateCueTiming, addCueLine, removeCueLine } = useEditor.getState();
  if (!cue) return <NoCue />;
  const sec = (ms: number) => (ms / 1000).toFixed(2);
  return (
    <div className={styles.tabBody} data-role="cue-editor">
      <div className={styles.row}>
        <strong>Cue #{index + 1}</strong>
        <label className={styles.inlineNum}>Mulai <input type="number" step={0.05} min={0} value={sec(cue.start_ms)} key={`s${cue.id}${cue.start_ms}`}
          onBlur={(e) => updateCueTiming(cue.id, Math.round(+e.target.value * 1000), cue.end_ms)} />s</label>
        <label className={styles.inlineNum}>Selesai <input type="number" step={0.05} min={0} value={sec(cue.end_ms)} key={`e${cue.id}${cue.end_ms}`}
          onBlur={(e) => updateCueTiming(cue.id, cue.start_ms, Math.round(+e.target.value * 1000))} />s</label>
      </div>
      {cue.lines.map((text, i) => {
        const slot = project.design.slots[Math.min(i, project.design.slots.length - 1)]!;
        return (
          <div key={`${cue.id}-${i}`} className={styles.lineBlock}>
            <div className={styles.lineHead}>
              <span>Baris {i + 1} · {slot.label}</span>
              {cue.lines.length > 1 && <button className={styles.linkBtn} onClick={() => removeCueLine(cue.id, i)}>Hapus baris</button>}
            </div>
            <textarea rows={2} defaultValue={text} key={`${cue.id}-${i}-${text}`} aria-label={`Teks baris ${i + 1}`} className={styles.lineInput}
              onBlur={(e) => { if (e.target.value !== text) updateCueLine(cue.id, i, e.target.value.replace(/\n+/g, ' ').trim()); }} />
            <LineStyleRow project={project} cue={cue} line={i} />
          </div>
        );
      })}
      <button className="vk-btn vk-btn-ghost" onClick={() => addCueLine(cue.id)}>+ Baris bahasa</button>
    </div>
  );
}

function VisualTab({ project }: { project: SubtitleVideoProject }) {
  const { cue, isLast } = useSelectedCue(project);
  const { setCueVisual, setCueAudio, extendVisualToNext } = useEditor.getState();
  if (!cue) return <NoCue />;
  const visualRef = cue.visual ? project.media[cue.visual.mediaId] : undefined;
  const audioRef = cue.audio ? project.media[cue.audio.mediaId] : undefined;
  return (
    <div className={styles.tabBody} data-role="visual-editor">
      <p className={styles.muted}>Visual tampil dari awal cue ini sampai cue berikutnya. Pratinjau di kiri menunjukkan teks di atas visual.</p>
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

function SettingTab({ project }: { project: SubtitleVideoProject }) {
  const { setPreset, setBackgroundColor } = useEditor.getState();
  const [modal, setModal] = useState<'subtitle' | 'audio' | null>(null);
  const d = project.design;
  const music = project.music, bg = project.backgroundVideo;
  const mediaName = (id?: string) => (id ? project.media[id]?.name ?? '—' : '—');
  return (
    <div className={styles.tabBody}>
      <div className={styles.grid2}>
        <label className={styles.field}>Ukuran output
          <select value={project.preset} onChange={(e) => setPreset(e.target.value as OutputPreset)}>
            {(Object.keys(OUTPUT_PRESETS) as OutputPreset[]).map((k) => <option key={k} value={k}>{OUTPUT_PRESETS[k].label} — {OUTPUT_PRESETS[k].hint}</option>)}
          </select>
        </label>
        <label className={styles.field}>Warna latar (cue tanpa visual)
          <input type="color" value={project.backgroundColor} onChange={(e) => setBackgroundColor(e.target.value.toUpperCase())} />
        </label>
      </div>

      <div className={styles.summary} data-role="summary-subtitle">
        <div className={styles.summaryHead}>
          <strong>Subtitle global</strong>
          <button className="vk-btn vk-btn-ghost" onClick={() => setModal('subtitle')} data-role="open-subtitle-global">Atur</button>
        </div>
        <span className={styles.muted}>Posisi {ANCHOR_LABEL[d.anchor].toLowerCase()} · jarak {d.marginV}/{d.marginH} px</span>
        {d.slots.map((s, i) => (
          <span key={i} className={styles.summaryLine}>
            <span className={styles.swatch} style={{ background: s.color, borderColor: s.outlineColor }} />
            Baris {i + 1}{i === d.slots.length - 1 ? '+' : ''} · {s.label} · {s.font} {s.size}px{s.bold ? ' · tebal' : ''}{s.italic ? ' · miring' : ''}{s.box ? ' · kotak' : ''}
          </span>
        ))}
      </div>

      <div className={styles.summary} data-role="summary-audio">
        <div className={styles.summaryHead}>
          <strong>Latar &amp; audio</strong>
          <button className="vk-btn vk-btn-ghost" onClick={() => setModal('audio')} data-role="open-audio">Atur</button>
        </div>
        <span className={styles.muted}>Musik: {music ? `${mediaName(music.mediaId)} (${Math.round(music.volume * 100)}%)` : 'tidak ada'}</span>
        <span className={styles.muted}>Video latar: {bg ? `${mediaName(bg.mediaId)}${bg.withAudio ? ' · dengan audio' : ''}` : 'tidak ada'}</span>
        {(music || bg?.withAudio) && <span className={styles.muted}>Ducking: {Math.round(project.duckingLevel * 100)}%</span>}
      </div>

      <SideModal open={modal === 'subtitle'} onClose={() => setModal(null)} title="Subtitle global" role="subtitle-global-modal">
        <DesignPanel project={project} />
      </SideModal>
      <SideModal open={modal === 'audio'} onClose={() => setModal(null)} title="Latar & audio" role="audio-modal">
        <AudioBackgroundPanel project={project} />
      </SideModal>
    </div>
  );
}

export default function EditorTabs({ project, footer }: { project: SubtitleVideoProject; footer?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>('subtitle');
  usePlayback((s) => s.playing); // render ulang ringan saat main/jeda (status tombol)
  return (
    <section className={`vk-card ${styles.tabsCard}`}>
      <div className={styles.tabs} role="tablist" aria-label="Pengaturan editor">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`${styles.tab} ${tab === k ? styles.tabActive : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'setting' && <SettingTab project={project} />}
        {tab === 'subtitle' && <SubtitleTab project={project} />}
        {tab === 'visual' && <VisualTab project={project} />}
      </div>
      {footer && <div className={styles.tabsFooter}>{footer}</div>}
    </section>
  );
}
