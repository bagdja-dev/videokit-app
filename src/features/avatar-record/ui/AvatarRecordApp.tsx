'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/core/auth/session';
import { NO_FRAMING_ADJUST, type FramingAdjust } from '@/core/avatar/avatar-scene';
import {
  ApiError, confirmThumbnail, deleteAvatar, listAvatars, putUpload, renameAvatar, replaceThumbnail, updateAvatar, type AvatarDto, type AvatarListResponseDto,
} from '../api';
import { dropCache, loadAvatarBytes } from '../cache';
import { renderThumbnail } from '../prepare';
import UploadDialog from './UploadDialog';
import { useLiveAvatar } from './useLiveAvatar';
import styles from './avatar-record.module.css';

const COMMERCIAL_BADGE: Record<AvatarDto['license_commercial'], string> = { allowed: 'Komersial OK', not_allowed: 'Non-komersial', unknown: 'Lisensi ?' };

const sameAdjust = (a: FramingAdjust, b: FramingAdjust) => a.zoom === b.zoom && a.offset_x === b.offset_x && a.offset_y === b.offset_y;

function FramingSlider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className={styles.slider}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} aria-label={label} />
      <output>{format(value)}</output>
    </label>
  );
}

function Preview({ avatar, userId, onSaved }: { avatar: AvatarDto; userId: string; onSaved: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  // Komponen di-remount per avatar (key), jadi status awal = sedang memuat.
  const [loading, setLoading] = useState<{ progress: number } | null>({ progress: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const saved = avatar.framing ?? NO_FRAMING_ADJUST;
  const [adjust, setAdjust] = useState<FramingAdjust>(saved);
  const [framingOpen, setFramingOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const live = useLiveAvatar(canvasRef, videoRef, bytes, adjust);
  const { id: avatarId, sha256 } = avatar;

  useEffect(() => {
    let alive = true;
    loadAvatarBytes(userId, { id: avatarId, sha256 }, (p) => { if (alive) setLoading({ progress: p }); })
      .then((r) => { if (alive) { setBytes(r.bytes); setLoading(null); } })
      .catch((e: unknown) => { if (alive) { setLoadError(e instanceof Error ? e.message : String(e)); setLoading(null); } });
    return () => { alive = false; };
  }, [avatarId, sha256, userId]);

  /** Simpan bingkai ke server lalu perbarui thumbnail dengan bingkai yang sama. */
  const saveFraming = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateAvatar(avatarId, { framing: adjust });
      if (bytes) {
        const { thumbnail } = await renderThumbnail(bytes, adjust);
        const target = await replaceThumbnail(avatarId, { size_bytes: thumbnail.size, mime_type: thumbnail.type === 'image/webp' ? 'image/webp' : 'image/png' });
        await putUpload(target, thumbnail);
        await confirmThumbnail(avatarId);
      }
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const dirty = !sameAdjust(adjust, saved);

  return (
    <section className={`vk-card ${styles.preview}`} aria-label={`Pratinjau ${avatar.name}`}>
      <div className={styles.stage}>
        <canvas ref={canvasRef} width={480} height={640} className={styles.canvas} data-role="avatar-preview" />
        <video ref={videoRef} className={styles.cam} muted playsInline hidden={!live.camOn} />
        {loading && (
          <div className={styles.overlay}>
            <span className={styles.spinner} aria-hidden />
            <span>{loading.progress > 0 ? `Mengunduh avatar ${Math.round(loading.progress * 100)}%` : 'Memuat avatar…'}</span>
          </div>
        )}
      </div>
      {loadError && <p className="vk-danger" role="alert">{loadError}</p>}
      {live.error && <p className="vk-danger" role="alert">{live.error}</p>}
      <div className={styles.row}>
        {!live.camOn
          ? <button className="vk-btn" disabled={!bytes || live.starting} onClick={() => void live.startCamera()}>{live.starting ? 'Menyiapkan kamera…' : 'Coba dengan kamera'}</button>
          : <button className="vk-btn vk-btn-ghost" onClick={live.stopCamera}>Matikan kamera</button>}
        <button className="vk-btn vk-btn-ghost" disabled={!live.camOn || !live.faceFound} onClick={() => live.calibrate()}>
          {live.calibrated ? 'Kalibrasi ulang' : 'Kalibrasi pose netral'}
        </button>
        <label className={styles.check}><input type="checkbox" checked={live.mirror} onChange={(e) => live.setMirror(e.target.checked)} /> Cermin</label>
        <button className="vk-btn vk-btn-ghost" aria-expanded={framingOpen} onClick={() => setFramingOpen((o) => !o)}>Atur bingkai</button>
      </div>
      {framingOpen && (
        <div className={styles.framing} data-role="framing-panel">
          <FramingSlider label="Perbesar" value={adjust.zoom} min={0.5} max={2.5} step={0.05} format={(v) => `${v.toFixed(2)}×`}
            onChange={(zoom) => setAdjust((a) => ({ ...a, zoom }))} />
          <FramingSlider label="Naik / turun" value={adjust.offset_y} min={-0.5} max={0.5} step={0.01} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`}
            onChange={(offset_y) => setAdjust((a) => ({ ...a, offset_y }))} />
          <FramingSlider label="Kiri / kanan" value={adjust.offset_x} min={-0.5} max={0.5} step={0.01} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`}
            onChange={(offset_x) => setAdjust((a) => ({ ...a, offset_x }))} />
          <div className={styles.row}>
            <button className="vk-btn vk-btn-ghost" disabled={saving || sameAdjust(adjust, NO_FRAMING_ADJUST)} onClick={() => setAdjust(NO_FRAMING_ADJUST)}>Reset ke otomatis</button>
            <button className="vk-btn vk-btn-ghost" disabled={saving || !dirty} onClick={() => setAdjust(saved)}>Batal</button>
            <button className="vk-btn" disabled={saving || !dirty || !bytes} onClick={() => void saveFraming()}>{saving ? 'Menyimpan…' : 'Simpan bingkai'}</button>
          </div>
          {saveError && <p className="vk-danger" role="alert">{saveError}</p>}
          <p className="vk-muted">Bingkai disimpan per avatar dan dipakai juga saat render video; thumbnail ikut diperbarui.</p>
        </div>
      )}
      <p className="vk-muted">
        {live.camOn
          ? (live.faceFound ? 'Wajah terdeteksi. Duduk santai, lihat kamera, lalu tekan Kalibrasi.' : 'Wajah belum terlihat — pastikan wajah di tengah kamera & cukup cahaya.')
          : 'Tanpa kamera, avatar diputar dengan gerakan contoh. Gambar kamera tidak disimpan atau dikirim.'}
        {live.camOn && ` · ${live.fps.track} fps lacak`}
      </p>
    </section>
  );
}

/** Tool Avatar Rekam — langkah 1: perpustakaan avatar (maks. slot gratis per akun), unggah, pratinjau kamera. */
export default function AvatarRecordApp() {
  const userId = useSession((s) => s.user?.userId);
  const [data, setData] = useState<AvatarListResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const applyList = useCallback((d: AvatarListResponseDto) => {
    setData(d);
    setError(null);
    setSelected((cur) => (cur && d.items.some((a) => a.id === cur) ? cur : d.items[0]?.id ?? null));
  }, []);
  const applyError = useCallback((e: unknown) => {
    setError(e instanceof ApiError && e.status === 404 ? 'Fitur avatar belum aktif di server (database belum dikonfigurasi).' : e instanceof Error ? e.message : String(e));
  }, []);
  const refresh = useCallback(() => listAvatars().then(applyList).catch(applyError), [applyList, applyError]);
  useEffect(() => { listAvatars().then(applyList).catch(applyError); }, [applyList, applyError]);

  const remove = async (a: AvatarDto) => {
    if (!confirm(`Hapus avatar "${a.name}"? File akan dihapus dari semua perangkat dan slot kembali tersedia.`)) return;
    setBusyId(a.id);
    try {
      await deleteAvatar(a.id);
      if (userId) await dropCache(userId, a.id);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusyId(null); }
  };
  const cancelPending = async (id: string) => {
    setBusyId(id);
    try { await deleteAvatar(id); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusyId(null); }
  };
  const rename = async (a: AvatarDto) => {
    const name = prompt('Nama avatar', a.name)?.trim();
    if (!name || name === a.name) return;
    setBusyId(a.id);
    try { await renameAvatar(a.id, name.slice(0, 60)); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusyId(null); }
  };

  const full = !!data && data.quota.used >= data.quota.limit;
  const pendingItems = data?.pending ?? [];
  const emptySlots = data ? Math.max(0, data.quota.limit - data.items.length - pendingItems.length) : 0;
  const current = data?.items.find((a) => a.id === selected) ?? null;

  return (
    <main className={styles.page}>
      <ol className={styles.steps} aria-label="Langkah">
        <li className={styles.stepActive}>1. Avatar</li>
        <li>2. Video <span className={styles.soon}>segera</span></li>
        <li>3. Rekam <span className={styles.soon}>segera</span></li>
      </ol>

      {error && <div className={`vk-card ${styles.errorBox}`} role="alert">{error} <button className="vk-btn vk-btn-ghost" onClick={() => void refresh()}>Coba lagi</button></div>}

      <div className={styles.layout}>
        <section className="vk-card">
          <div className={styles.libHead}>
            <h2 className={styles.h2}>Avatar saya</h2>
            {data && <span className={styles.quota} data-role="avatar-quota">{data.quota.used}/{data.quota.limit} slot</span>}
          </div>
          {!data && !error && <p className="vk-muted">Memuat…</p>}
          <div className={styles.slots}>
            {data?.items.map((a) => (
              <article key={a.id} className={`${styles.slot} ${a.id === selected ? styles.slotSelected : ''}`} data-avatar={a.name}>
                <button className={styles.slotPick} onClick={() => setSelected(a.id)} aria-pressed={a.id === selected}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL sementara storage privat */}
                  {a.thumbnail_url ? <img src={a.thumbnail_url} alt="" crossOrigin="anonymous" className={styles.thumb} /> : <span className={styles.thumbEmpty} />}
                  <strong className={styles.slotName}>{a.name}</strong>
                  <span className={`${styles.badge} ${a.license_commercial === 'not_allowed' ? styles.badgeWarn : ''}`}>{COMMERCIAL_BADGE[a.license_commercial]}</span>
                </button>
                <div className={styles.slotActions}>
                  <button className="vk-btn vk-btn-ghost" disabled={busyId === a.id} onClick={() => void rename(a)}>Ganti nama</button>
                  <button className="vk-btn vk-btn-ghost" disabled={busyId === a.id} onClick={() => void remove(a)}>Hapus</button>
                </div>
              </article>
            ))}
            {pendingItems.map((p) => (
              <article key={p.id} className={`${styles.slot} ${styles.slotPending}`} data-pending={p.name}>
                <div className={styles.pendingBody}>
                  <strong className={styles.slotName}>{p.name}</strong>
                  <span className={styles.muted}>Unggahan belum selesai — slot bebas otomatis pukul {new Date(p.expires_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.</span>
                </div>
                <div className={styles.slotActions}>
                  <button className="vk-btn vk-btn-ghost" disabled={busyId === p.id} onClick={() => void cancelPending(p.id)}>Batalkan</button>
                </div>
              </article>
            ))}
            {data && Array.from({ length: full ? 0 : emptySlots }, (_, i) => (
              <button key={`empty-${i}`} className={styles.slotEmpty} onClick={() => fileRef.current?.click()}>
                <span className={styles.plus} aria-hidden>+</span>
                Unggah avatar .vrm
              </button>
            ))}
          </div>
          <input ref={fileRef} type="file" accept=".vrm" hidden aria-label="Pilih file avatar VRM"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setUploadFile(f); }} />
          {full && <p className={styles.note}>Slot avatar penuh. Hapus salah satu untuk mengganti — slot tambahan (premium) segera hadir.</p>}
          <p className={styles.note}>Belum punya avatar? Buat gratis di <a href="https://vroid.com/en/studio" target="_blank" rel="noreferrer">VRoid Studio</a> lalu ekspor sebagai .vrm (maks. 50 MB).</p>
        </section>

        {current && userId ? <Preview key={current.id} avatar={current} userId={userId} onSaved={() => void refresh()} /> : (
          <section className={`vk-card ${styles.previewEmpty}`}><p className="vk-muted">Unggah avatar untuk melihat pratinjau dan mencobanya dengan kamera.</p></section>
        )}
      </div>

      {uploadFile && userId && (
        <UploadDialog file={uploadFile} userId={userId} onClose={() => setUploadFile(null)}
          onDone={(a) => { setUploadFile(null); setSelected(a.id); void refresh(); }} />
      )}
    </main>
  );
}
