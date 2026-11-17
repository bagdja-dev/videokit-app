// Cache file .vrm per perangkat & per akun (IndexedDB). Avatar 10–50 MB cukup diunduh sekali; kunci validitas = sha256.
import { avatarDownload, type AvatarDto } from './api';
import { sha256Hex } from './prepare';

const STORE = 'files';
const dbs = new Map<string, Promise<IDBDatabase>>();

function open(userId: string): Promise<IDBDatabase> {
  const name = `videokit-avatars-u-${userId}`;
  let p = dbs.get(name);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB tidak bisa dibuka'));
    });
    dbs.set(name, p);
  }
  return p;
}

interface Entry { sha256: string; blob: Blob }

const req = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export async function putCache(userId: string, id: string, sha256: string, blob: Blob): Promise<void> {
  const db = await open(userId);
  await req(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ sha256, blob } satisfies Entry, id));
}

export async function dropCache(userId: string, id: string): Promise<void> {
  const db = await open(userId).catch(() => null);
  if (db) await req(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)).catch(() => undefined);
}

/**
 * Bytes avatar: dari cache bila sha256 cocok, selain itu unduh (URL sementara dari API), verifikasi sha256, simpan.
 * `onProgress` 0..1 saat mengunduh.
 */
export async function loadAvatarBytes(userId: string, a: AvatarDto, onProgress?: (f: number) => void): Promise<{ bytes: ArrayBuffer; fromCache: boolean }> {
  const db = await open(userId).catch(() => null);
  if (db) {
    const hit = (await req(db.transaction(STORE, 'readonly').objectStore(STORE).get(a.id)).catch(() => undefined)) as Entry | undefined;
    if (hit?.sha256 === a.sha256) return { bytes: await hit.blob.arrayBuffer(), fromCache: true };
  }
  const dl = await avatarDownload(a.id);
  const res = await fetch(dl.url);
  if (!res.ok || !res.body) throw new Error(`Unduh avatar gagal (${res.status})`);
  const total = Number(res.headers.get('content-length')) || dl.size_bytes;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.byteLength;
    onProgress?.(total ? n / total : 0);
  }
  const blob = new Blob(parts as BlobPart[]);
  const bytes = await blob.arrayBuffer();
  if ((await sha256Hex(bytes)) !== dl.sha256) throw new Error('File avatar rusak saat diunduh (hash tidak cocok) — coba lagi');
  await putCache(userId, a.id, dl.sha256, blob).catch(() => undefined);
  return { bytes, fromCache: false };
}
