'use client';

import { useEffect, type ReactNode } from 'react';
import { loginUrl, useSession } from '@/core/auth/session';
import styles from './RequireAuth.module.css';

/**
 * Gerbang fitur: isi hanya dirender untuk pengguna yang sudah login. Belum login → dialihkan ke SSO Bagdja
 * (biasanya tanpa form bila sudah masuk di produk Bagdja lain) lalu kembali ke halaman ini.
 * Setelah sempat lolos, halaman tidak dialihkan paksa walau sesi kemudian habis — pekerjaan tidak hilang.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const load = useSession((s) => s.load);
  const passed = useSession((s) => s.everAuthenticated);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (status === 'anonymous' && !passed) location.assign(loginUrl());
  }, [status, passed]);

  if (passed) return <>{children}</>;
  if (status === 'error') {
    return (
      <main className={styles.wrap}>
        <div className={`vk-card ${styles.card}`}>
          <h1 className={styles.title}>Layanan login tidak bisa dihubungi</h1>
          <p className="vk-muted">Periksa koneksi internet lalu coba lagi. Bila berlanjut, hubungi tim Bagdja.</p>
          <button className="vk-btn" onClick={() => void load(true)}>Coba lagi</button>
        </div>
      </main>
    );
  }
  return (
    <main className={styles.wrap} aria-busy>
      <div className={styles.card}>
        <span className={styles.spinner} aria-hidden />
        <p className="vk-muted">{status === 'anonymous' ? 'Mengalihkan ke halaman masuk Bagdja…' : 'Memeriksa sesi…'}</p>
        {status === 'anonymous' && <a className="vk-btn" href={loginUrl()}>Masuk dengan akun Bagdja</a>}
      </div>
    </main>
  );
}
