// Penulisan hasil render bertahap ke OPFS (temuan PoC: 10 menit di RAM = ±450 MB heap).
import { OPFS_DIR } from './protocol';

export async function rendersDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

type SyncAccessHandle = {
  write(data: BufferSource, opts?: { at?: number }): number;
  flush(): void;
  close(): void;
};

/**
 * WritableStream yang menerima chunk mediabunny `{type:'write', data, position}`.
 * Chrome/Firefox: createWritable() langsung menerima bentuk chunk itu. Safari (worker): sync access handle.
 */
export async function opfsWritable(name: string): Promise<WritableStream<{ type: 'write'; data: Uint8Array; position: number }>> {
  const dir = await rendersDir();
  const handle = await dir.getFileHandle(name, { create: true });
  const h = handle as FileSystemFileHandle & { createWritable?: () => Promise<FileSystemWritableFileStream>; createSyncAccessHandle?: () => Promise<SyncAccessHandle> };
  if (typeof h.createWritable === 'function') {
    return (await h.createWritable()) as unknown as WritableStream<{ type: 'write'; data: Uint8Array; position: number }>;
  }
  if (typeof h.createSyncAccessHandle === 'function') {
    const sync = await h.createSyncAccessHandle();
    return new WritableStream({
      write(chunk) { sync.write(chunk.data as BufferSource, { at: chunk.position }); },
      close() { sync.flush(); sync.close(); },
      abort() { sync.close(); },
    });
  }
  throw new Error('OPFS tidak mendukung penulisan di browser ini');
}

export async function readRender(name: string): Promise<File> {
  const dir = await rendersDir();
  return (await dir.getFileHandle(name)).getFile();
}

export async function deleteRender(name: string): Promise<void> {
  const dir = await rendersDir();
  await dir.removeEntry(name).catch(() => undefined);
}

/** Bersihkan sisa render lama (mis. tab ditutup di tengah render). */
export async function pruneRenders(maxAgeMs = 24 * 3600_000): Promise<void> {
  const dir = await rendersDir();
  const now = Date.now();
  for await (const [name, entry] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (entry.kind !== 'file') continue;
    const file = await (entry as FileSystemFileHandle).getFile();
    if (now - file.lastModified > maxAgeMs) await dir.removeEntry(name).catch(() => undefined);
  }
}
