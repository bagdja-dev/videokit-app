// Parser SRT dengan peringatan yang bisa ditampilkan ke pengguna (VideoKit overview §3.2).
// Satu baris teks dalam cue = satu slot bahasa.

export interface SrtCue {
  start_ms: number;
  end_ms: number;
  lines: string[];
}

export interface SrtWarning {
  /** Nomor cue (1-based) atau 0 untuk peringatan file. */
  cue: number;
  message: string;
}

export interface SrtParseResult {
  cues: SrtCue[];
  warnings: SrtWarning[];
  encoding: 'utf-8' | 'windows-1252';
}

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function toMs(t: string): number | null {
  const m = TIME.exec(t);
  if (!m) return null;
  return ((+m[1]! * 60 + +m[2]!) * 60 + +m[3]!) * 1000 + +m[4]!.padEnd(3, '0').slice(0, 3);
}

/** Decode byte file SRT: UTF-8 (dengan/tanpa BOM), cadangan Windows-1252 untuk file lama. */
export function decodeSrtBytes(bytes: ArrayBuffer): { text: string; encoding: SrtParseResult['encoding'] } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

export function parseSrt(text: string, encoding: SrtParseResult['encoding'] = 'utf-8'): SrtParseResult {
  const warnings: SrtWarning[] = [];
  const cues: SrtCue[] = [];
  if (encoding === 'windows-1252') warnings.push({ cue: 0, message: 'File bukan UTF-8 — dibaca sebagai Windows-1252. Periksa huruf beraksen.' });
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  let htmlTags = false;
  for (const block of blocks) {
    const rows = block.split('\n');
    const ti = rows.findIndex((r) => r.includes('-->'));
    const n = cues.length + 1;
    if (ti < 0) {
      if (block.trim()) warnings.push({ cue: n, message: 'Blok tanpa baris waktu dilewati' });
      continue;
    }
    const [a, b] = rows[ti]!.split('-->').map((x) => toMs(x.trim()));
    if (a == null || b == null) { warnings.push({ cue: n, message: `Waktu tidak valid: "${rows[ti]}"` }); continue; }
    const raw = rows.slice(ti + 1);
    if (raw.some((l) => /<[^>]+>/.test(l))) htmlTags = true;
    const lines = raw.map((l) => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    if (!lines.length) { warnings.push({ cue: n, message: 'Cue tanpa teks dilewati' }); continue; }
    if (b <= a) { warnings.push({ cue: n, message: 'Waktu selesai tidak lebih besar dari waktu mulai — dilewati' }); continue; }
    cues.push({ start_ms: a, end_ms: b, lines });
  }
  if (htmlTags) warnings.push({ cue: 0, message: 'Tag HTML (<i>, <b>, <font>) dibuang — gaya diatur di panel desain' });
  cues.sort((x, y) => x.start_ms - y.start_ms);
  for (let i = 1; i < cues.length; i++) {
    const prev = cues[i - 1]!, cur = cues[i]!;
    if (cur.start_ms < prev.end_ms) {
      warnings.push({ cue: i + 1, message: `Tumpang tindih dengan cue ${i} — waktu selesai cue ${i} dipotong` });
      prev.end_ms = cur.start_ms;
    }
  }
  return { cues: cues.filter((c) => c.end_ms > c.start_ms), warnings, encoding };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const srtTime = (ms: number) =>
  `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;

/** Ekspor kembali ke SRT (setelah edit ringan di editor). */
export function toSrt(cues: SrtCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start_ms)} --> ${srtTime(c.end_ms)}\n${c.lines.join('\n')}\n`).join('\n');
}
