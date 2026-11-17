// Penyimpanan lokal MVP (tanpa server): dokumen project & file media di IndexedDB.
// File media disimpan sebagai Blob (Chrome menyimpannya di disk, bukan RAM). Saat videokit-api tersedia,
// lapisan ini diganti/ditambah sinkronisasi ke server tanpa mengubah model dokumen.
import type { SubtitleVideoProject } from './model';

const DB_NAME = 'videokit';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const MEDIA = 'media';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB tidak bisa dibuka'));
    });
  }
  return dbPromise;
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
