// Client videokit-api /avatars. Tipe = cerminan DTO C#-style di API (src/modules/avatar/dto/avatar.dto.ts) — jaga sinkron.
import { apiUrl } from '@/core/auth/session';

export type LicenseCommercial = 'allowed' | 'not_allowed' | 'unknown';

export interface AvatarDto {
  id: string;
  name: string;
  status: 'pending' | 'ready';
  size_bytes: number;
  sha256: string;
  vrm_version: '0' | '1';
  license_commercial: LicenseCommercial;
  license_url: string | null;
  license_authors: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

export interface AvatarQuotaDto { used: number; limit: number }
export interface AvatarListResponseDto { items: AvatarDto[]; quota: AvatarQuotaDto }
export interface UploadTargetDto { url: string; method: 'PUT'; headers: Record<string, string>; expires_at: string }
export interface CreateAvatarResponseDto { avatar: AvatarDto; vrm_upload: UploadTargetDto; thumbnail_upload: UploadTargetDto }
export interface AvatarDownloadResponseDto { url: string; expires_at: string; sha256: string; size_bytes: number }

export interface CreateAvatarRequestDto {
  name: string;
  size_bytes: number;
  sha256: string;
  vrm_version: '0' | '1';
  license_commercial: LicenseCommercial;
  license_url?: string;
  license_authors?: string;
  license_accepted: true;
  thumbnail_size_bytes: number;
  thumbnail_mime_type: 'image/png' | 'image/webp';
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
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

export const listAvatars = () => call<AvatarListResponseDto>('GET', '/avatars');
export const createAvatar = (dto: CreateAvatarRequestDto) => call<CreateAvatarResponseDto>('POST', '/avatars', dto);
export const confirmAvatar = (id: string) => call<AvatarDto>('POST', `/avatars/${id}/confirm`);
export const avatarDownload = (id: string) => call<AvatarDownloadResponseDto>('GET', `/avatars/${id}/download`);
export const renameAvatar = (id: string, name: string) => call<AvatarDto>('PATCH', `/avatars/${id}`, { name });
export const deleteAvatar = (id: string) => call<{ id: string; deleted: true }>('DELETE', `/avatars/${id}`);

/** PUT langsung ke storage (presigned) dengan progres — XHR karena fetch belum punya progres upload. */
export function putUpload(target: UploadTargetDto, body: Blob, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, `Upload gagal (${xhr.status})`)));
    xhr.onerror = () => reject(new ApiError(0, 'Upload terputus — periksa koneksi'));
    xhr.onabort = () => reject(new DOMException('Upload dibatalkan', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
