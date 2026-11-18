'use client';

// Kartu tool di beranda + tombol ? yang membuka popup panduan (infografis & langkah singkat).
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TOOLS, type ToolInfo } from '@/features/registry';
import LyricEditorGuide from '@/features/subtitle-video/ui/LyricEditorGuide';
import styles from '@/app/page.module.css';

const GUIDES: Record<string, () => React.ReactElement> = {
  'subtitle-video': LyricEditorGuide,
};

function GuideDialog({ tool, onClose }: { tool: ToolInfo; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const Guide = GUIDES[tool.id];
  return (
    <dialog ref={ref} className={styles.guideDialog} onClose={onClose} aria-labelledby="vk-guide-title" data-role="tool-guide"
      onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}>
      <div className={styles.guideHead}>
        <h2 id="vk-guide-title" className={styles.guideTitle}>{tool.name}</h2>
        <button className="vk-btn vk-btn-ghost" onClick={() => ref.current?.close()} aria-label="Tutup panduan">✕</button>
      </div>
      {Guide && <Guide />}
      <div className={styles.guideFoot}>
        <Link href={tool.href} className="vk-btn">Mulai sekarang</Link>
      </div>
    </dialog>
  );
}

export default function ToolCards() {
  const [guideFor, setGuideFor] = useState<ToolInfo | null>(null);
  return (
    <>
      <section className={styles.grid} aria-label="Daftar tool">
        {TOOLS.map((t) => (
          <div key={t.id} className={styles.cardWrap}>
            <Link href={t.href} className={`vk-card ${styles.card} ${styles.cardLink}`}>
              <h2 className={styles.cardTitle}>{t.name}</h2>
              <p className="vk-muted">{t.description}</p>
              <span className={styles.badge}>{t.badge}</span>
            </Link>
            {t.hasGuide && GUIDES[t.id] && (
              <button type="button" className={styles.helpBtn} aria-label={`Panduan ${t.name}`} title="Apa ini & cara pakai" onClick={() => setGuideFor(t)}>?</button>
            )}
          </div>
        ))}
      </section>
      {guideFor && <GuideDialog tool={guideFor} onClose={() => setGuideFor(null)} />}
    </>
  );
}
