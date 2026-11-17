import Link from 'next/link';
import AuthErrorNotice from '@/components/AuthErrorNotice';
import { TOOLS } from '@/features/registry';
import styles from './page.module.css';

// Halaman kartu tool (VideoKit overview §1). Publik (terindeks); membuka tool meminta login Bagdja.
export default function HomePage() {
  return (
    <main className="vk-container">
      <AuthErrorNotice />
      <header className={styles.header}>
        <h1 className={styles.title}>VideoKit</h1>
        <p className="vk-muted">Racik video vertikal &amp; YouTube tanpa ribet ngedit. Masuk dengan akun Bagdja untuk memakai tool.</p>
      </header>
      <section className={styles.grid} aria-label="Daftar tool">
        {TOOLS.map((t) => (
          <Link key={t.id} href={t.href} className={`vk-card ${styles.card} ${styles.cardLink}`}>
            <h2 className={styles.cardTitle}>{t.name}</h2>
            <p className="vk-muted">{t.description}</p>
            <span className={styles.badge}>{t.badge}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
