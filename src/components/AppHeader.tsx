'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { displayName, loginUrl, logoutUrl, switchAccountUrl, useSession, type SessionUser } from '@/core/auth/session';
import { toolForPath } from '@/features/registry';
import styles from './AppHeader.module.css';

function Avatar({ user, size = 32 }: { user: SessionUser; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = displayName(user).charAt(0).toUpperCase();
  if (user.avatar && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- avatar eksternal (Google), static export tanpa optimasi gambar
    return <img className={styles.avatar} src={user.avatar} alt="" width={size} height={size} referrerPolicy="no-referrer" crossOrigin="anonymous" onError={() => setBroken(true)} />;
  }
  return <span className={styles.avatarInitial} style={{ width: size, height: size }} aria-hidden>{initial}</span>;
}

function ProfileMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const name = displayName(user);
  return (
    <div className={styles.profile} ref={ref}>
      <button type="button" className={styles.profileButton} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar user={user} />
        <span className={styles.profileName}>{name}</span>
        <svg className={styles.caret} width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.menuHead}>
            <Avatar user={user} size={40} />
            <div className={styles.menuWho}>
              <strong>{name}</strong>
              {user.email && <span className={styles.menuEmail}>{user.email}</span>}
            </div>
          </div>
          <a role="menuitem" className={styles.menuItem} href={switchAccountUrl()}>Ganti akun</a>
          <a role="menuitem" className={styles.menuItem} href={logoutUrl()}>Keluar</a>
        </div>
      )}
    </div>
  );
}

/** Header global: nama website (kiri), app aktif (tengah), profil (kanan). */
export default function AppHeader() {
  const pathname = usePathname();
  const tool = toolForPath(pathname);
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const load = useSession((s) => s.load);

  useEffect(() => { void load(); }, [load]);

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="VideoKit — beranda">
          <svg className={styles.logo} viewBox="0 0 32 32" width="28" height="28" aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--vk-primary)" />
            <path d="M12 9.5v13l10.5-6.5z" fill="var(--vk-on-primary)" />
          </svg>
          <span className={styles.brandText}>
            <strong>VideoKit</strong>
            <span className={styles.brandBy}>by Bagdja</span>
          </span>
        </Link>

        <div className={styles.center}>
          {tool && <span className={styles.appName} title={tool.name}>{tool.name}</span>}
        </div>

        <div className={styles.right}>
          {status === 'authenticated' && user ? (
            <ProfileMenu user={user} />
          ) : status === 'idle' || status === 'loading' ? (
            <span className={styles.skeleton} aria-label="Memeriksa sesi" />
          ) : (
            <a className={`vk-btn ${styles.loginBtn}`} href={loginUrl()} title={status === 'error' ? 'Layanan login sedang tidak bisa dihubungi' : undefined}>
              Masuk
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
