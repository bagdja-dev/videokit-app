'use client';

import { useState } from 'react';
import type { MediaKind, MediaRef } from '../model';
import { importMedia } from '../media';
import { useEditor } from '../store';
import styles from './editor.module.css';

const ACCEPT: Record<MediaKind, string> = { video: 'video/*', image: 'image/*', audio: 'audio/*' };

/** Tombol pilih file lokal → disimpan ke IndexedDB → MediaRef dikembalikan lewat onPicked. */
export default function MediaButton({ label, kinds, onPicked }: { label: string; kinds: MediaKind[]; onPicked: (ref: MediaRef) => void }) {
  const addMedia = useEditor((s) => s.addMedia);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className={styles.row}>
      <span className={`vk-btn vk-btn-ghost ${styles.fileBtn}`} aria-busy={busy}>
        {busy ? 'Memproses…' : label}
        <input type="file" accept={kinds.map((k) => ACCEPT[k]).join(',')} disabled={busy} aria-label={label}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBusy(true); setError(null);
            try {
              const ref = await importMedia(file, kinds);
              addMedia(ref);
              onPicked(ref);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }} />
      </span>
      {error && <span className={styles.error}>{error}</span>}
    </span>
  );
}
