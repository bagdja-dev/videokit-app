// Registri font subtitle (overview §4.4). Font dimuat SESUAI KEBUTUHAN ASS: paket CJK (±4,5–8,5 MB per file)
// hanya diunduh bila ada style/override yang memakainya. Executor server memakai berkas yang sama (fontsdir).

export type FontSet = 'latin-v1' | 'cjk-v1';
export type CjkLang = 'ja' | 'ko' | 'zh-hans';

export interface FontFamilyInfo {
  family: string;
  set: FontSet;
  /** Label di UI. */
  label: string;
  files: { regular: string; bold?: string; italic?: string };
  /** Bahasa CJK yang dicakup; font CJK juga memuat huruf Latin. */
  cjk?: CjkLang;
  /** Perkiraan unduhan (MB) untuk regular + bold. */
  approxMb: number;
}

export const FONT_FAMILIES: readonly FontFamilyInfo[] = [
  { family: 'Poppins', set: 'latin-v1', label: 'Poppins', files: { regular: 'Poppins-Regular.ttf', bold: 'Poppins-Bold.ttf', italic: 'Poppins-Italic.ttf' }, approxMb: 0.3 },
  { family: 'Bebas Neue', set: 'latin-v1', label: 'Bebas Neue', files: { regular: 'BebasNeue-Regular.ttf' }, approxMb: 0.1 },
  { family: 'Noto Sans KR', set: 'cjk-v1', label: 'Noto Sans KR (한국어)', files: { regular: 'NotoSansKR-Regular.otf', bold: 'NotoSansKR-Bold.otf' }, cjk: 'ko', approxMb: 9.5 },
  { family: 'Noto Sans JP', set: 'cjk-v1', label: 'Noto Sans JP (日本語)', files: { regular: 'NotoSansJP-Regular.otf', bold: 'NotoSansJP-Bold.otf' }, cjk: 'ja', approxMb: 9.2 },
  { family: 'Noto Sans SC', set: 'cjk-v1', label: 'Noto Sans SC (简体中文)', files: { regular: 'NotoSansSC-Regular.otf', bold: 'NotoSansSC-Bold.otf' }, cjk: 'zh-hans', approxMb: 16.9 },
];

/** Font CJK cadangan untuk tiap bahasa saat font slot adalah font Latin. */
export const CJK_FALLBACK: Record<CjkLang, string> = { ja: 'Noto Sans JP', ko: 'Noto Sans KR', 'zh-hans': 'Noto Sans SC' };

export const findFamily = (family: string): FontFamilyInfo | undefined =>
  FONT_FAMILIES.find((f) => f.family.toLowerCase() === family.trim().toLowerCase());

export const fontPath = (set: FontSet, file: string) => `/fonts/${set}/${file}`;

interface Need { regular: boolean; bold: boolean; italic: boolean }

/**
 * Daftar path font yang dibutuhkan sebuah dokumen ASS: keluarga dari baris Style dan override \fn.
 * Bobot tebal/miring untuk keluarga override mengikuti gabungan style (lebih baik sedikit berlebih daripada kurang).
 */
export function fontsForAss(ass: string): string[] {
  const needs = new Map<string, Need>();
  let anyBold = false, anyItalic = false;
  const add = (family: string, n: Partial<Need>) => {
    const f = findFamily(family);
    if (!f) return;
    const cur = needs.get(f.family) ?? { regular: true, bold: false, italic: false };
    needs.set(f.family, { regular: true, bold: cur.bold || !!n.bold, italic: cur.italic || !!n.italic });
  };
  for (const line of ass.split('\n')) {
    if (line.startsWith('Style:')) {
      // Format standar V4+: Name, Fontname, Fontsize, Primary, Secondary, Outline, Back, Bold, Italic, ...
      const p = line.slice(6).split(',');
      const bold = (p[7] ?? '').trim() === '-1', italic = (p[8] ?? '').trim() === '-1';
      anyBold ||= bold; anyItalic ||= italic;
      add(p[1] ?? '', { bold, italic });
    }
  }
  for (const m of ass.matchAll(/\\fn([^\\}]+)/g)) add(m[1] ?? '', { bold: anyBold, italic: anyItalic });

  const out: string[] = [];
  for (const [family, n] of needs) {
    const f = findFamily(family)!;
    out.push(fontPath(f.set, f.files.regular));
    if (n.bold && f.files.bold) out.push(fontPath(f.set, f.files.bold));
    if (n.italic && f.files.italic) out.push(fontPath(f.set, f.files.italic));
  }
  return out;
}

/** Nama paket font untuk Render Spec (executor server memilih fontsdir dari sini). */
export function fontSetOf(ass: string): 'latin-v1' | 'latin-cjk-v1' {
  return fontsForAss(ass).some((p) => p.startsWith('/fonts/cjk-v1/')) ? 'latin-cjk-v1' : 'latin-v1';
}
