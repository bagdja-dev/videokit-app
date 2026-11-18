// Sesi login SSO Bagdja lewat BFF videokit-api. Token TIDAK pernah ada di JavaScript: tersimpan di cookie
// httpOnly milik API; app hanya menanyakan `GET /auth/me` (credentials: 'include').
import { create } from 'zustand';

export interface SessionUser {
  userId: string;
  email?: string;
  username?: string;
  avatar?: string;
  /** ISO 8601 */
  expiresAt?: string;
}

export type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'anonymous' | 'error';

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** Pernah login di muat-halaman ini — gerbang fitur tidak mengalihkan paksa saat sesi kemudian habis. */
  everAuthenticated: boolean;
  load: (force?: boolean) => Promise<void>;
}

/**
 * URL videokit-api. Produksi: NEXT_PUBLIC_VIDEOKIT_API_URL (diset saat build). Development tanpa env: host yang
 * sama dengan app pada port 5031 — agar uji dari tablet/HP lewat IP LAN tetap mengarah ke mesin dev.
 */
export function apiUrl(): string {
  const env = process.env.NEXT_PUBLIC_VIDEOKIT_API_URL;
  if (env) return env.replace(/\/+$/, '');
  if (typeof location === 'undefined') return 'http://localhost:5031';
  return `${location.protocol}//${location.hostname}:5031`;
}

export const loginUrl = (returnTo: string = location.href) =>
  `${apiUrl()}/auth/login?return_to=${encodeURIComponent(returnTo)}`;

export const switchAccountUrl = (returnTo: string = location.href) => `${loginUrl(returnTo)}&force_login=1`;

export const logoutUrl = () => `${apiUrl()}/auth/logout?return_to=${encodeURIComponent(`${location.origin}/`)}`;

/** Nama tampilan: username → bagian depan email → "Pengguna". */
export const displayName = (u: SessionUser) => u.username || u.email?.split('@')[0] || 'Pengguna';

let inflight: Promise<void> | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

export const useSession = create<SessionState>((set, get) => ({
  status: 'idle',
  user: null,
  everAuthenticated: false,
  load: (force = false) => {
    if (inflight) return inflight;
    if (!force && (get().status === 'authenticated' || get().status === 'anonymous')) return Promise.resolve();
    // KHUSUS `next dev`: lewati SSO dengan akun tiruan bila NEXT_PUBLIC_VK_DEV_AUTH=mock (uji fitur sebelum client app
    // di bagdja-console siap). NODE_ENV di-inline saat build → cabang ini hilang dari build produksi.
    if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_VK_DEV_AUTH === 'mock') {
      set({ status: 'authenticated', user: { userId: '00000000-0000-4000-8000-000000000000', username: 'dev-lokal', email: 'dev@localhost' }, everAuthenticated: true });
      return Promise.resolve();
    }
    set({ status: 'loading' });
    inflight = (async () => {
      try {
        const res = await fetch(`${apiUrl()}/auth/me`, { credentials: 'include', cache: 'no-store' });
        if (res.status === 401) {
          set({ status: 'anonymous', user: null });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const user = (await res.json()) as SessionUser;
        set({ status: 'authenticated', user, everAuthenticated: true });
        clearTimeout(expiryTimer);
        const ms = user.expiresAt ? Date.parse(user.expiresAt) - Date.now() : NaN;
        // Sesi habis → header menampilkan "Masuk" lagi. Halaman yang sedang dipakai tidak dialihkan paksa
        // (pekerjaan tidak hilang); permintaan berikutnya ke API yang meminta login ulang.
        if (Number.isFinite(ms) && ms > 0 && ms < 2 ** 31) expiryTimer = setTimeout(() => set({ status: 'anonymous' }), ms); // profil disimpan: editor tetap terbuka
      } catch {
        set({ status: 'error', user: null });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },
}));
