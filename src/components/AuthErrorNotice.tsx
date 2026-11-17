'use client';

import { useEffect, useState } from 'react';
import { loginUrl } from '@/core/auth/session';

const MESSAGES: Record<string, string> = {
  denied: 'Login dibatalkan.',
  state_expired: 'Waktu login habis. Silakan coba lagi.',
  missing_params: 'Respons login tidak lengkap. Silakan coba lagi.',
  token_failed: 'Login gagal diproses oleh server. Silakan coba lagi.',
  token_invalid: 'Sesi login tidak valid. Silakan coba lagi.',
};

/** Pesan dari videokit-api bila callback login gagal (`/?auth_error=<kode>`). */
export default function AuthErrorNotice() {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const c = params.get('auth_error');
    if (!c) return;
    // Bersihkan URL agar pesan tidak muncul lagi saat dimuat ulang.
    params.delete('auth_error');
    const qs = params.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
    queueMicrotask(() => setCode(c));
  }, []);

  if (!code) return null;
  return (
    <div role="alert" className="vk-card" style={{ borderColor: 'var(--vk-danger)', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="vk-danger" style={{ flex: 1, minWidth: 200 }}>{MESSAGES[code] ?? 'Login gagal. Silakan coba lagi.'}</span>
      <a className="vk-btn" href={loginUrl(`${location.origin}/`)}>Masuk lagi</a>
      <button className="vk-btn vk-btn-ghost" onClick={() => setCode(null)}>Tutup</button>
    </div>
  );
}
