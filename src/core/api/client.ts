// Pemanggil videokit-api bersama: cookie sesi (credentials include), pesan galat dari API dalam bahasa pengguna.
import { apiUrl } from '@/core/auth/session';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
}

export async function apiCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      method, credentials: 'include', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Server VideoKit tidak bisa dihubungi');
  }
  const data = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data!.message.join('; ') : data?.message;
    throw new ApiError(res.status, res.status === 401 ? 'Sesi berakhir — silakan masuk lagi' : msg || `Permintaan gagal (${res.status})`);
  }
  return data as T;
}
