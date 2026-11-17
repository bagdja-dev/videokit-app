import Link from 'next/link';
import styles from './page.module.css';

interface ToolCard {
  title: string;
  description: string;
  /** Rute tool; tanpa href berarti belum tersedia. */
  href?: string;
  badge: string;
}

// Halaman kartu tool (VideoKit overview §1). Editor "Video dari Subtitle" dibangun di Fase 3.
const TOOLS: ToolCard[] = [
  { title: 'Video dari Subtitle', description: 'Unggah SRT, isi tiap baris dengan klip atau gambar, atur gaya teks per bahasa.', badge: 'Segera hadir' },
  { title: 'Render Lab', description: 'Uji mesin render di browser memakai video contoh. Halaman internal tim.', href: '/dev/render-lab/', badge: 'Internal' },
];

export default function HomePage() {
  return (
    <main className="vk-container">
      <header className={styles.header}>
        <h1 className={styles.title}>VideoKit</h1>
        <p className="vk-muted">Racik video vertikal &amp; YouTube tanpa ribet ngedit.</p>
      </header>
      <section className={styles.grid} aria-label="Daftar tool">
        {TOOLS.map((t) => {
          const body = (
            <>
              <h2 className={styles.cardTitle}>{t.title}</h2>
              <p className="vk-muted">{t.description}</p>
              <span className={styles.badge}>{t.badge}</span>
            </>
          );
          return t.href ? (
            <Link key={t.title} href={t.href} className={`vk-card ${styles.card} ${styles.cardLink}`}>{body}</Link>
          ) : (
            <article key={t.title} className={`vk-card ${styles.card} ${styles.cardDisabled}`} title="Belum tersedia">
              {body}
            </article>
          );
        })}
      </section>
    </main>
  );
}
