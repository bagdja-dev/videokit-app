import AuthErrorNotice from '@/components/AuthErrorNotice';
import ToolCards from '@/components/ToolCards';
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
      <ToolCards />
    </main>
  );
}
