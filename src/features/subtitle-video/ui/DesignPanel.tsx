'use client';

import type { Anchor } from '@/core/subtitle/ass';
import { LATIN_V1_FAMILIES } from '@/core/subtitle/ass';
import type { SubtitleVideoProject } from '../model';
import { useEditor } from '../store';
import styles from './editor.module.css';

export default function DesignPanel({ project }: { project: SubtitleVideoProject }) {
  const updateDesign = useEditor((s) => s.updateDesign);
  const updateSlot = useEditor((s) => s.updateSlot);
  const d = project.design;
  return (
    <section className="vk-card">
      <h2 className={styles.h2}>Desain subtitle</h2>
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
      {d.slots.map((s, i) => {
        const family = LATIN_V1_FAMILIES.find((f) => f.family === s.font);
        return (
          <fieldset key={i} style={{ border: '1px solid var(--vk-border)', borderRadius: 10, marginTop: 12, padding: 10 }}>
            <legend className={styles.muted}>Baris {i + 1}</legend>
            <div className={styles.grid3}>
              <label className={styles.field}>Nama bahasa
                <input value={s.label} maxLength={30} onChange={(e) => updateSlot(i, { label: e.target.value })} />
              </label>
              <label className={styles.field}>Font
                <select value={s.font} onChange={(e) => updateSlot(i, { font: e.target.value })}>
                  {LATIN_V1_FAMILIES.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
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
              <label className={styles.check}><input type="checkbox" checked={s.bold} disabled={!family?.bold} onChange={(e) => updateSlot(i, { bold: e.target.checked })} />Tebal</label>
              <label className={styles.check}><input type="checkbox" checked={s.italic} disabled={!family?.italic} onChange={(e) => updateSlot(i, { italic: e.target.checked })} />Miring</label>
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
    </section>
  );
}
