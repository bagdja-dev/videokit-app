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

export type SrtEncoding = 'utf-8' | 'shift_jis' | 'euc-kr' | 'gb18030' | 'big5' | 'windows-1252';

export interface SrtParseResult {
  cues: SrtCue[];
  warnings: SrtWarning[];
  encoding: SrtEncoding;
}

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function toMs(t: string): number | null {
  const m = TIME.exec(t);
  if (!m) return null;
  return ((+m[1]! * 60 + +m[2]!) * 60 + +m[3]!) * 1000 + +m[4]!.padEnd(3, '0').slice(0, 3);
}

const tryDecode = (enc: string, bytes: ArrayBuffer): string | null => {
  try { return new TextDecoder(enc, { fatal: true }).decode(bytes); } catch { return null; }
};
/** Porsi huruf non-ASCII yang cocok dengan pola. */
const ratio = (text: string, re: RegExp): number => {
  let all = 0, hit = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 0x80) continue;
    all++;
    if (re.test(ch)) hit++;
  }
  return all ? hit / all : 0;
};

const HIRAGANA = /[\u3040-\u309F]/u;
const HANGUL_SYL = /[\uAC00-\uD7AF]/u;
const HAN_OR_PUNCT = /[\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/u;
// Huruf paling sering muncul; teks hasil salah-decode jarang mengenainya.
const COMMON_KO = new Set([...'이다는에하가의고지요을를서한도로리기사나그니어들수아오세해있습것게면내만보요까데안시주우']);
const COMMON_ZH = new Set([...'的一是不了人我在有他这中大来上个们到说和你好为就也要会可以时出么么那里对生能都没子后自过']);
const frequent = (text: string, set: Set<string>) => {
  let all = 0, hit = 0;
  for (const ch of text) { if (ch.charCodeAt(0) < 0x80) continue; all++; if (set.has(ch)) hit++; }
  return all ? hit / all : 0;
};

/**
 * Decode byte file SRT: UTF-8 (dengan/tanpa BOM); untuk file lama dicoba Shift_JIS (Jepang), EUC-KR (Korea),
 * GB18030 & Big5 (Mandarin) dengan pemeriksaan isi, lalu cadangan Windows-1252.
 * Urutan penting: byte Shift_JIS bisa "valid" sebagai EUC-KR/GB18030, tetapi hanya Shift_JIS yang menghasilkan hiragana.
 */
export function decodeSrtBytes(bytes: ArrayBuffer): { text: string; encoding: SrtEncoding } {
  const utf8 = tryDecode('utf-8', bytes);
  if (utf8 != null) return { text: utf8, encoding: 'utf-8' };
  const sjis = tryDecode('shift_jis', bytes);
  if (sjis != null && ratio(sjis, HIRAGANA) >= 0.15) return { text: sjis, encoding: 'shift_jis' };
  // Byte GBK juga "valid" sebagai EUC-KR (jadi Hangul acak) dan sebaliknya → bandingkan frekuensi huruf umum.
  const kr = tryDecode('euc-kr', bytes);
  const zh = tryDecode('gb18030', bytes);
  const krOk = kr != null && ratio(kr, HANGUL_SYL) >= 0.5;
  const zhOk = zh != null && ratio(zh, HAN_OR_PUNCT) >= 0.6;
  if (krOk && zhOk) {
    return frequent(kr!, COMMON_KO) >= frequent(zh!, COMMON_ZH) ? { text: kr!, encoding: 'euc-kr' } : { text: zh!, encoding: 'gb18030' };
  }
  if (krOk) return { text: kr!, encoding: 'euc-kr' };
  if (zhOk) return { text: zh!, encoding: 'gb18030' };
  const big5 = tryDecode('big5', bytes);
  if (big5 != null && ratio(big5, HAN_OR_PUNCT) >= 0.6) return { text: big5, encoding: 'big5' };
  return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
}

const ENCODING_WARNING: Partial<Record<SrtEncoding, string>> = {
  'windows-1252': 'File bukan UTF-8 — dibaca sebagai Windows-1252. Periksa huruf beraksen.',
  shift_jis: 'File dibaca sebagai Shift_JIS (Jepang). Periksa teks; simpan ulang sebagai UTF-8 bila ada yang rusak.',
  'euc-kr': 'File dibaca sebagai EUC-KR (Korea). Periksa teks; simpan ulang sebagai UTF-8 bila ada yang rusak.',
  gb18030: 'File dibaca sebagai GB18030 (Mandarin sederhana). Bila teks Mandarin tradisional rusak, simpan ulang sebagai UTF-8.',
  big5: 'File dibaca sebagai Big5 (Mandarin tradisional). Periksa teks; simpan ulang sebagai UTF-8 bila ada yang rusak.',
};

export function parseSrt(text: string, encoding: SrtParseResult['encoding'] = 'utf-8'): SrtParseResult {
  const warnings: SrtWarning[] = [];
  const cues: SrtCue[] = [];
  const encWarning = ENCODING_WARNING[encoding];
  if (encWarning) warnings.push({ cue: 0, message: encWarning });
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
