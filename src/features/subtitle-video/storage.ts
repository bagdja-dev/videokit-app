// Penyimpanan lokal MVP (tanpa server): dokumen project & file media di IndexedDB.
// File media disimpan sebagai Blob (Chrome menyimpannya di disk, bukan RAM). Saat videokit-api tersedia,
// lapisan ini diganti/ditambah sinkronisasi ke server tanpa mengubah model dokumen.
import type { SubtitleVideoProject } from './model';

// Satu database per akun: perangkat bersama tidak menampilkan project akun lain.
const LEGACY_DB_NAME = 'videokit';
const dbNameFor = (userId: string) => `videokit-u-${userId}`;
const DB_VERSION = 1;
const PROJECTS = 'projects';
const MEDIA = 'media';

let dbPromise: Promise<IDBDatabase> | null = null;
let boundUser: string | null = null;

function openNamed(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB tidak bisa dibuka'));
  });
}

function openDb(): Promise<IDBDatabase> {
  if (!boundUser) return Promise.reject(new Error('Penyimpanan belum terikat ke akun (belum login)'));
  if (!dbPromise) dbPromise = openNamed(dbNameFor(boundUser));
  return dbPromise;
}

const readAll = <T>(db: IDBDatabase, store: string) => new Promise<{ keys: IDBValidKey[]; values: T[] }>((resolve, reject) => {
  const t = db.transaction(store, 'readonly');
  const s = t.objectStore(store);
  const keys = s.getAllKeys();
  const values = s.getAll();
  t.oncomplete = () => resolve({ keys: keys.result, values: values.result as T[] });
  t.onerror = () => reject(t.error);
});

/**
 * Data MVP sebelum ada login tersimpan di database tanpa akun ('videokit'). Diadopsi oleh akun PERTAMA yang
 * login di perangkat ini: disalin ke database akun, lalu database lama dihapus SETELAH salinan berhasil.
 */
async function adoptLegacyDb(target: IDBDatabase): Promise<void> {
  const dbs = (await indexedDB.databases?.().catch(() => [])) ?? [];
  if (!dbs.some((d) => d.name === LEGACY_DB_NAME)) return;
  const legacy = await openNamed(LEGACY_DB_NAME);
  try {
    const projects = await readAll<SubtitleVideoProject>(legacy, PROJECTS);
    const media = await readAll<Blob>(legacy, MEDIA);
    await new Promise<void>((resolve, reject) => {
      const t = target.transaction([PROJECTS, MEDIA], 'readwrite');
      for (const p of projects.values) t.objectStore(PROJECTS).put(p);
      media.values.forEach((b, i) => t.objectStore(MEDIA).put(b, media.keys[i]));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally {
    legacy.close();
  }
  await new Promise<void>((resolve) => {
    const del = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    del.onsuccess = del.onerror = del.onblocked = () => resolve();
  });
}

/** Ikat penyimpanan ke akun yang login. Wajib dipanggil sebelum fungsi lain di modul ini. */
export async function bindStorageToUser(userId: string): Promise<void> {
  if (boundUser === userId && dbPromise) return;
  if (dbPromise) (await dbPromise.catch(() => null))?.close();
  boundUser = userId;
  dbPromise = null;
  const db = await openDb();
  await adoptLegacyDb(db).catch(() => undefined);
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Operasi IndexedDB gagal'));
  }));
}

export interface ProjectSummary {
  id: string;
  title: string;
  preset: SubtitleVideoProject['preset'];
  cueCount: number;
  updatedAt: number;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await tx<SubtitleVideoProject[]>(PROJECTS, 'readonly', (s) => s.getAll() as IDBRequest<SubtitleVideoProject[]>);
  return all
    .map((p) => ({ id: p.id, title: p.title, preset: p.preset, cueCount: p.cues.length, updatedAt: p.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const loadProject = (id: string) =>
  tx<SubtitleVideoProject | undefined>(PROJECTS, 'readonly', (s) => s.get(id) as IDBRequest<SubtitleVideoProject | undefined>);

export const saveProject = (p: SubtitleVideoProject) => tx(PROJECTS, 'readwrite', (s) => s.put(p));

export async function deleteProject(p: SubtitleVideoProject): Promise<void> {
  for (const id of Object.keys(p.media)) await deleteMedia(id);
  await tx(PROJECTS, 'readwrite', (s) => s.delete(p.id));
}

export const saveMedia = (id: string, blob: Blob) => tx(MEDIA, 'readwrite', (s) => s.put(blob, id));
export const loadMedia = (id: string) => tx<Blob | undefined>(MEDIA, 'readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
export const deleteMedia = (id: string) => tx(MEDIA, 'readwrite', (s) => s.delete(id));

/** Minta browser tidak menghapus data saat ruang disk menipis. */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
