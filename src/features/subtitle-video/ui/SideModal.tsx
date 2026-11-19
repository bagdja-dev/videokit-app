'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import styles from './editor.module.css';

/**
 * Modal panel samping (kanan) untuk mengedit pengaturan tanpa mengubah tata letak editor. Latar tipis supaya
 * pratinjau di kiri tetap terlihat dan langsung mencerminkan perubahan.
 */
export default function SideModal({ open, title, onClose, children, role }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; role?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    // Event `close` datang setelah d.close() kita sendiri (tertunda); abaikan bila modal memang sudah ditutup lewat
    // prop — kalau tidak, event yang terlambat bisa ikut menutup modal lain yang baru dibuka (state modal dipakai bersama).
    <dialog ref={ref} className={styles.sideModal} onClose={() => { if (open) onClose(); }} onCancel={onClose} aria-label={title} data-role={role}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.sideModalInner}>
        <div className={styles.dialogHead}>
          <strong>{title}</strong>
          <button className="vk-btn vk-btn-ghost" onClick={onClose} aria-label="Tutup">Selesai</button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}
