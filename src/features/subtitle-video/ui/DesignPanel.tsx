'use client';

import type { Anchor } from '@/core/subtitle/ass';
import { FONT_FAMILIES, findFamily } from '@/core/render/fonts';
import { MIN_STYLE_SLOTS, type SubtitleVideoProject } from '../model';
import { useEditor } from '../store';
import styles from './editor.module.css';

export default function DesignPanel({ project }: { project: SubtitleVideoProject }) {
  const updateDesign = useEditor((s) => s.updateDesign);
  const updateSlot = useEditor((s) => s.updateSlot);
  const { addSlot, removeSlot } = useEditor.getState();
  const d = project.design;
  const maxLines = Math.max(1, ...project.cues.map((c) => c.lines.length));
  const last = d.slots.length - 1;
  return (
    <section className="vk-card" data-role="display-panel">
      <h2 className={styles.h2}>Posisi subtitle</h2>
      <div className={styles.grid3}>
        <label className={styles.field}>Posisi
          <select value={d.anchor} onChange={(e) => updateDesign({ anchor: e.target.value as Anchor })}>
            <option value="bottom">Bawah</option><option value="middle">Tengah</option><option value="top">Atas</option>
          </select>
        </label>
        <label className={styles.field}>Jarak tepi atas/bawah
          <input type="number" min={0} max={900} value={d.marginV} onChange={(e) => updateDesign({ marginV: +e.target.value })} />
        </label>
        <label className={styles.field}>Jarak tepi samping
          <input type="number" min={0} max={500} value={d.marginH} onChange={(e) => updateDesign({ marginH: +e.target.value })} />
        </label>
      </div>
      <h2 className={styles.h2} style={{ marginTop: 20 }}>Gaya default per baris</h2>
      <p className={styles.muted}>
        Berlaku untuk semua cue. Gaya khusus satu cue diatur di tab Subtitle. Baris cue yang melebihi daftar ini memakai
        gaya baris terakhir.
      </p>
      <p className={styles.muted} style={{ marginTop: 8 }}>
        Huruf Korea, Jepang, dan Mandarin pada baris berfont Latin otomatis memakai Noto Sans yang sesuai. Font tersebut
        baru diunduh saat render bila dipakai (±5–9 MB per file, tersimpan di cache browser).
      </p>
      {d.slots.map((s, i) => {
        const family = findFamily(s.font);
        return (
          <fieldset key={i} data-slot={i + 1} style={{ border: '1px solid var(--vk-border)', borderRadius: 10, marginTop: 12, padding: 10 }}>
            <legend className={styles.muted}>
              Baris {i + 1}{i === last ? ` — juga dipakai baris ${i + 2} dst.` : ''}
            </legend>
            {i >= MIN_STYLE_SLOTS && (
              <div className={styles.row} style={{ justifyContent: 'flex-end', marginBottom: 6 }}>
                <button className={styles.linkBtn} onClick={() => removeSlot(i)}>Hapus gaya baris {i + 1}</button>
              </div>
            )}
            <div className={styles.grid3}>
              <label className={styles.field}>Nama bahasa
                <input value={s.label} maxLength={30} onChange={(e) => updateSlot(i, { label: e.target.value })} />
              </label>
              <label className={styles.field}>Font
                <select value={s.font} onChange={(e) => updateSlot(i, { font: e.target.value })}>
                  <optgroup label="Latin">
                    {FONT_FAMILIES.filter((f) => !f.cjk).map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
                  </optgroup>
                  <optgroup label="Korea / Jepang / Mandarin">
                    {FONT_FAMILIES.filter((f) => f.cjk).map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
                  </optgroup>
                </select>
              </label>
              <label className={styles.field}>Ukuran
                <input type="number" min={12} max={200} value={s.size} onChange={(e) => updateSlot(i, { size: +e.target.value })} />
              </label>
              <label className={styles.field}>Warna teks
                <input type="color" value={s.color} onChange={(e) => updateSlot(i, { color: e.target.value.toUpperCase() })} />
              </label>
              <label className={styles.field}>Warna garis tepi
                <input type="color" value={s.outlineColor} onChange={(e) => updateSlot(i, { outlineColor: e.target.value.toUpperCase() })} />
              </label>
              <label className={styles.field}>Tebal garis tepi
                <input type="number" min={0} max={20} value={s.outline} onChange={(e) => updateSlot(i, { outline: +e.target.value })} />
              </label>
            </div>
            <div className={styles.row} style={{ marginTop: 8 }}>
              <label className={styles.check}><input type="checkbox" checked={s.bold} disabled={!family?.files.bold} onChange={(e) => updateSlot(i, { bold: e.target.checked })} />Tebal</label>
              <label className={styles.check}><input type="checkbox" checked={s.italic} disabled={!family?.files.italic} onChange={(e) => updateSlot(i, { italic: e.target.checked })} />Miring</label>
              <label className={styles.check}><input type="checkbox" checked={s.box} onChange={(e) => updateSlot(i, { box: e.target.checked })} />Kotak latar</label>
              {s.box && (
                <>
                  <input type="color" aria-label="Warna kotak" value={s.boxColor} onChange={(e) => updateSlot(i, { boxColor: e.target.value.toUpperCase() })} />
                  <label className={styles.check}>Opasitas
                    <input type="range" min={0} max={100} value={s.boxOpacity} onChange={(e) => updateSlot(i, { boxOpacity: +e.target.value })} />
                  </label>
                </>
              )}
            </div>
          </fieldset>
        );
      })}
      <div className={styles.row} style={{ marginTop: 12 }}>
        <button className="vk-btn vk-btn-ghost" onClick={addSlot} data-role="add-slot">+ Tambah gaya baris {d.slots.length + 1}</button>
        {maxLines > d.slots.length && (
          <span className={styles.muted}>Ada cue dengan {maxLines} baris — baris {d.slots.length + 1}–{maxLines} saat ini memakai gaya baris {d.slots.length}.</span>
        )}
      </div>
    </section>
  );
}
