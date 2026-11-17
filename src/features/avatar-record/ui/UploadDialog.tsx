'use client';

import { useEffect, useRef, useState } from 'react';
import { confirmAvatar, createAvatar, deleteAvatar, putUpload, type AvatarDto } from '../api';
import { putCache } from '../cache';
import { prepareVrm, PrepareError, type PreparedAvatar } from '../prepare';
import styles from './avatar-record.module.css';

type Phase = { kind: 'checking' } | { kind: 'consent'; prep: PreparedAvatar; thumbUrl: string } | { kind: 'uploading'; progress: number } | { kind: 'error'; message: string };

const COMMERCIAL: Record<string, string> = { allowed: 'Boleh dipakai komersial', 'not-allowed': 'TIDAK boleh dipakai komersial', unknown: 'Izin komersial tidak tercantum' };

/** Alur unggah: periksa di browser → persetujuan lisensi → daftar ke API → PUT langsung ke storage → konfirmasi. */
export default function UploadDialog({ file, userId, onDone, onClose }: { file: File; userId: string; onDone: (a: AvatarDto) => void; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [name, setName] = useState(file.name.replace(/\.vrm$/i, '').slice(0, 60));
  const [accepted, setAccepted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    let alive = true;
    let url: string | null = null;
    prepareVrm(file)
      .then((prep) => {
        if (!alive) return;
        url = URL.createObjectURL(prep.thumbnail);
        if (prep.info.name && prep.info.name !== 'Tanpa nama') setName(prep.info.name.slice(0, 60));
        setPhase({ kind: 'consent', prep, thumbUrl: url });
      })
      .catch((e: unknown) => { if (alive) setPhase({ kind: 'error', message: e instanceof PrepareError ? e.message : `Pemeriksaan gagal: ${String(e)}` }); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); abortRef.current?.abort(); };
  }, [file]);

  const upload = async (prep: PreparedAvatar) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase({ kind: 'uploading', progress: 0 });
    let createdId: string | null = null;
    try {
      const info = prep.info;
      const created = await createAvatar({
        name: name.trim() || 'Avatar', size_bytes: prep.file.size, sha256: prep.sha256, vrm_version: info.vrmVersion,
        license_commercial: info.commercialUse === 'not-allowed' ? 'not_allowed' : info.commercialUse,
        license_url: info.licenseUrl && /^https?:\/\//.test(info.licenseUrl) ? info.licenseUrl.slice(0, 500) : undefined,
        license_authors: info.authors ? info.authors.slice(0, 300) : undefined,
        license_accepted: true,
        thumbnail_size_bytes: prep.thumbnail.size,
        thumbnail_mime_type: prep.thumbnail.type === 'image/webp' ? 'image/webp' : 'image/png',
      });
      createdId = created.avatar.id;
      const total = prep.file.size + prep.thumbnail.size;
      await putUpload(created.thumbnail_upload, prep.thumbnail, undefined, ac.signal);
      await putUpload(created.vrm_upload, prep.file, (f) => setPhase({ kind: 'uploading', progress: (prep.thumbnail.size + f * prep.file.size) / total }), ac.signal);
      const ready = await confirmAvatar(created.avatar.id);
      // Perangkat ini sudah punya filenya → simpan ke cache agar tidak perlu diunduh lagi.
      await putCache(userId, ready.id, prep.sha256, prep.file).catch(() => undefined);
      onDone(ready);
    } catch (e) {
      // Upload gagal/dibatalkan setelah avatar terdaftar → lepaskan slot sekarang (bukan menunggu 1 jam kedaluwarsa).
      if (createdId) await deleteAvatar(createdId).catch(() => undefined);
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const close = () => { abortRef.current?.abort(); dialogRef.current?.close(); onClose(); };

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={(e) => { e.preventDefault(); if (phase.kind !== 'uploading') close(); }} aria-labelledby="vk-upload-title">
      <h2 id="vk-upload-title" className={styles.h2}>Unggah avatar</h2>
      {phase.kind === 'checking' && (
        <div className={styles.center}><span className={styles.spinner} aria-hidden /><p className="vk-muted">Memeriksa avatar di perangkat ini…</p></div>
      )}
      {phase.kind === 'error' && (
        <>
          <p className="vk-danger" role="alert">{phase.message}</p>
          <div className={styles.actions}><button className="vk-btn" onClick={close}>Tutup</button></div>
        </>
      )}
      {phase.kind === 'consent' && (
        <form className={styles.consent} onSubmit={(e) => { e.preventDefault(); if (accepted) void upload(phase.prep); }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- blob URL lokal */}
          <img src={phase.thumbUrl} alt="" className={styles.consentThumb} />
          <div className={styles.consentBody}>
            <label className={styles.field}>Nama avatar
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
            </label>
            <ul className={styles.meta}>
              <li>Pembuat: {phase.prep.info.authors || '—'}</li>
              <li>VRM {phase.prep.info.vrmVersion} · {(phase.prep.file.size / 1e6).toFixed(1)} MB</li>
              <li className={phase.prep.info.commercialUse === 'not-allowed' ? 'vk-danger' : undefined}>
                {COMMERCIAL[phase.prep.info.commercialUse]}
                {phase.prep.info.licenseUrl && <> · <a href={phase.prep.info.licenseUrl} target="_blank" rel="noreferrer">baca lisensi</a></>}
              </li>
              {phase.prep.info.missingExpressions.length > 0 && (
                <li className="vk-danger">Ekspresi tidak ada ({phase.prep.info.missingExpressions.join(', ')}) — bagian itu tidak akan bergerak.</li>
              )}
            </ul>
            {phase.prep.info.commercialUse === 'not-allowed' && (
              <p className={styles.warn}>Pembuat avatar melarang penggunaan komersial. Jangan pakai untuk konten yang dimonetisasi tanpa izin pembuatnya.</p>
            )}
            <label className={styles.check}>
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              Saya berhak memakai avatar ini sesuai lisensinya.
            </label>
            <div className={styles.actions}>
              <button type="button" className="vk-btn vk-btn-ghost" onClick={close}>Batal</button>
              <button type="submit" className="vk-btn" disabled={!accepted || !name.trim()}>Unggah</button>
            </div>
          </div>
        </form>
      )}
      {phase.kind === 'uploading' && (
        <div className={styles.center}>
          <div className="vk-progress" style={{ width: '100%' }}><span style={{ width: `${Math.round(phase.progress * 100)}%` }} /></div>
          <p className="vk-muted">Mengunggah… {Math.round(phase.progress * 100)}%</p>
          <button className="vk-btn vk-btn-ghost" onClick={close}>Batalkan</button>
        </div>
      )}
    </dialog>
  );
}
