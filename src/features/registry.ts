// Daftar tool VideoKit — satu sumber untuk kartu beranda dan nama app aktif di header.

export interface ToolInfo {
  id: string;
  name: string;
  description: string;
  /** Rute tool (trailing slash, static export). */
  href: string;
  badge: string;
  /** Halaman internal tim (tidak diindeks). */
  internal?: boolean;
  /** Punya popup panduan (tombol ?) di kartu beranda. */
  hasGuide?: boolean;
}

export const TOOLS: readonly ToolInfo[] = [
  {
    id: 'subtitle-video',
    name: 'Video Lyric Editor',
    description: 'Ubah file lirik atau subtitle (SRT) jadi video lirik siap posting: tiap baris dengan klip atau gambar sendiri, teks multi-bahasa, langsung jadi MP4 di perangkatmu.',
    href: '/subtitle-video/',
    badge: 'Buka',
    hasGuide: true,
  },
  {
    id: 'avatar-record',
    name: 'Avatar Rekam',
    description: 'Komentari video dengan avatar 3D yang mengikuti wajah & suaramu — untuk kreator faceless.',
    href: '/avatar-record/',
    badge: 'Baru',
  },
  {
    id: 'render-lab',
    name: 'Render Lab',
    description: 'Uji mesin render di browser memakai video contoh. Halaman internal tim.',
    href: '/dev/render-lab/',
    badge: 'Internal',
    internal: true,
  },
  {
    id: 'avatar-lab',
    name: 'Avatar Lab',
    description: 'PoC avatar VRM yang mengikuti wajah & suara (tool Avatar Rekam). Halaman internal tim.',
    href: '/dev/avatar-lab/',
    badge: 'Internal',
    internal: true,
  },
];

export function toolForPath(pathname: string | null): ToolInfo | undefined {
  if (!pathname) return undefined;
  const p = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return TOOLS.find((t) => p.startsWith(t.href));
}
