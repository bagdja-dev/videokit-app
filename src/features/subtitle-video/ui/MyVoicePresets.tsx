'use client';

// "Preset saya": preset efek suara milik akun, disimpan di videokit-api (tabel voice_preset) → tersedia di semua
// perangkat & project. Pakai · simpan pengaturan sekarang sebagai preset baru · perbarui · hapus.
import { useEffect, useState } from 'react';
import { ApiError } from '@/core/api/client';
import type { VoiceSettings } from '../model';
import { useEditor } from '../store';
import { createVoicePreset, deleteVoicePreset, listVoicePresets, updateVoicePreset, type VoicePresetDto } from '../voice-presets-api';
import styles from './editor.module.css';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Terjadi kesalahan, coba lagi.');

export default function MyVoicePresets({ voice }: { voice: VoiceSettings }) {
  const setVoice = useEditor((s) => s.setVoice);
  const [items, setItems] = useState<VoicePresetDto[] | null>(null);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    let alive = true;
    listVoicePresets()
      .then((r) => { if (alive) { setItems(r.items); setLimit(r.limit); } })
      .catch((e) => { if (alive) { setItems([]); setError(errText(e)); } });
    return () => { alive = false; };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const apply = (p: VoicePresetDto) => setVoice({ preset: 'saved', fx: { ...p.fx }, savedId: p.id, savedName: p.name });
  const save = () => run(async () => {
    const p = await createVoicePreset({ name: name.trim(), fx: voice.fx });
    setItems((l) => [p, ...(l ?? [])]);
    setVoice({ preset: 'saved', fx: { ...p.fx }, savedId: p.id, savedName: p.name });
    setNaming(false); setName('');
  });
  const overwrite = (id: string) => run(async () => {
    const p = await updateVoicePreset(id, { fx: voice.fx });
    setItems((l) => [p, ...(l ?? []).filter((x) => x.id !== id)]);
    setVoice({ preset: 'saved', fx: { ...p.fx }, savedId: p.id, savedName: p.name });
  });
  const remove = (p: VoicePresetDto) => {
    if (!confirm(`Hapus preset "${p.name}"?`)) return;
    void run(async () => {
      await deleteVoicePreset(p.id);
      setItems((l) => (l ?? []).filter((x) => x.id !== p.id));
      if (voice.savedId === p.id) setVoice({ ...voice, preset: 'custom', savedId: undefined, savedName: undefined });
    });
  };

  const savedStill = voice.savedId && items?.some((p) => p.id === voice.savedId);
  const full = (items?.length ?? 0) >= limit;
  return (
    <div className={styles.field} data-role="my-presets">
      <span>Preset saya <span className={styles.muted}>· tersimpan di akun, bisa dipakai di perangkat lain</span></span>
      {items === null ? <span className={styles.muted}>Memuat…</span> : items.length === 0 && !error ? (
        <span className={styles.muted}>Belum ada. Setel suara sampai pas, lalu simpan sebagai preset.</span>
      ) : (
        <ul className={styles.myPresets}>
          {items.map((p) => {
            const active = voice.savedId === p.id;
            return (
              <li key={p.id} className={`${styles.myPreset} ${active ? styles.presetActive : ''}`} data-saved-preset={p.name}>
                <button type="button" className={styles.myPresetApply} onClick={() => apply(p)} disabled={busy} aria-pressed={active && voice.preset === 'saved'}>
                  <strong>{p.name}</strong>
                  {active && voice.preset === 'custom' && <span className={styles.muted}> · diubah</span>}
                </button>
                <button type="button" className={styles.linkBtn} onClick={() => remove(p)} disabled={busy} aria-label={`Hapus preset ${p.name}`}>Hapus</button>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.mediaRow}>
        {savedStill && voice.preset === 'custom' && (
          <button className="vk-btn vk-btn-ghost" disabled={busy} onClick={() => void overwrite(voice.savedId!)} data-role="preset-overwrite">
            Perbarui &quot;{voice.savedName}&quot;
          </button>
        )}
        {!naming ? (
          <button className="vk-btn vk-btn-ghost" disabled={busy || full} onClick={() => setNaming(true)} data-role="preset-save-open"
            title={full ? `Maksimal ${limit} preset — hapus yang lama dulu` : undefined}>
            + Simpan sebagai preset baru
          </button>
        ) : (
          <form className={styles.mediaRow} onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save(); }}>
            <input className={styles.presetName} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus
              placeholder="Nama preset, mis. Narasi Sunda" aria-label="Nama preset" data-role="preset-name" />
            <button className="vk-btn" type="submit" disabled={busy || !name.trim()} data-role="preset-save">Simpan</button>
            <button className="vk-btn vk-btn-ghost" type="button" onClick={() => { setNaming(false); setName(''); }}>Batal</button>
          </form>
        )}
      </div>
      {error && <span className={styles.error} role="alert" data-role="preset-error">{error}</span>}
    </div>
  );
}
