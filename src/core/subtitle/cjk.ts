// Dukungan huruf Korea/Jepang/Mandarin di ASS (overview §4.4).
// 1. Font cadangan: bila font slot adalah font Latin, bagian teks CJK dibungkus {\fn<Noto Sans xx>}.
// 2. Pemotongan baris: libass hanya memotong baris pada spasi, sehingga teks Jepang/Mandarin (tanpa spasi)
//    meluber keluar layar. Di antara huruf Han/Kana disisipkan spasi berskala nol `{\fscx0} {\fscx100}` sebagai
//    titik potong — tak terlihat, dan dibaca sama oleh libass di browser (JASSUB) maupun ffmpeg (server).
//    Aturan kinsoku: tanda tutup/kana kecil tidak boleh di awal baris, tanda buka tidak boleh di akhir baris.
//    Hangul TIDAK disisipi: bahasa Korea dipotong per kata (spasi), seperti libass biasa.
import { CJK_FALLBACK, findFamily, type CjkLang } from '@/core/render/fonts';

const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯ힰ-퟿]/u;
const HIRAGANA_KATAKANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/u;
const HAN = /[⺀-⿟々〇〡-〩㐀-䶿一-鿿豈-﫿\u{20000}-\u{3134F}]/u;
/** Tanda baca/simbol CJK & bentuk lebar penuh. */
const CJK_PUNCT = /[　-〿・＀-･￠-￮]/u;

/** Tidak boleh di awal baris. */
const NO_LINE_START = new Set([...'、。，．・：；？！ー－〜～）」』】〕〉》〙〗｝］〟’”…‥ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々〻゛゜ゝゞヽヾ!),.:;?]}%']);
/** Tidak boleh di akhir baris. */
const NO_LINE_END = new Set([...'（「『【〔〈《〘〖｛［〝‘“([{']);

/** Jumlah huruf Han minimum agar baris tanpa kana/hangul dianggap Mandarin. */
const HAN_ONLY_ZH_MIN = 6;

export const BREAK = '{\\fscx0} {\\fscx100}';

export const isHangul = (ch: string) => HANGUL.test(ch);
/** Huruf yang butuh font CJK (Hangul, Kana, Han, tanda baca CJK). */
export const isCjk = (ch: string) => HANGUL.test(ch) || HIRAGANA_KATAKANA.test(ch) || HAN.test(ch) || CJK_PUNCT.test(ch);
/** Huruf yang boleh dipotong per karakter (Han, Kana, tanda baca CJK). */
const isBreakable = (ch: string) => HIRAGANA_KATAKANA.test(ch) || HAN.test(ch) || CJK_PUNCT.test(ch);

export const hasCjk = (text: string) => [...text].some(isCjk);

/** Tebak bahasa CJK sebuah teks: Kana → Jepang, Hangul → Korea, Han saja → null (ambigu). */
export function detectCjkLang(text: string): CjkLang | null {
  let kana = 0, hangul = 0;
  for (const ch of text) {
    if (HIRAGANA_KATAKANA.test(ch)) kana++;
    else if (HANGUL.test(ch)) hangul++;
  }
  if (kana && kana >= hangul) return 'ja';
  if (hangul) return 'ko';
  return null;
}

const escapeAss = (t: string) => t.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');

/**
 * Ubah satu baris teks menjadi teks ASS: escape, font cadangan CJK, titik potong baris.
 * @param slotFont font style slot ini
 * @param lang bahasa untuk huruf Han tanpa Kana/Hangul (cadangan per slot)
 */
export function assLineText(line: string, slotFont: string, lang: CjkLang): string {
  const chars = [...line];
  if (!chars.some(isCjk)) return escapeAss(line);
  const slotLang = findFamily(slotFont)?.cjk;
  // Han tanpa kana/hangul: kalimat Jepang hampir selalu memuat kana → baris Han panjang dianggap Mandarin.
  const hanCount = chars.filter((c) => HAN.test(c)).length;
  const lineLang = detectCjkLang(line) ?? (hanCount >= HAN_ONLY_ZH_MIN ? 'zh-hans' : lang);
  // Font CJK slot dipakai langsung bila bahasanya cocok (subset JP tidak memuat Hangul, dst.).
  const slotIsCjk = !!slotLang && (slotLang === lineLang || !detectCjkLang(line));
  const fallback = CJK_FALLBACK[lineLang];
  let out = '';
  let inCjkFont = false;
  chars.forEach((ch, i) => {
    const cjk = isCjk(ch);
    // Spasi di tengah teks CJK tetap memakai font CJK agar tidak memecah run.
    const wantCjkFont = !slotIsCjk && (cjk || (ch === ' ' && inCjkFont && isCjk(chars[i + 1] ?? '')));
    if (wantCjkFont !== inCjkFont) {
      out += wantCjkFont ? `{\\fn${fallback}}` : `{\\fn${slotFont}}`;
      inCjkFont = wantCjkFont;
    }
    const prev = chars[i - 1];
    if (prev && isBreakable(prev) && isBreakable(ch) && !NO_LINE_START.has(ch) && !NO_LINE_END.has(prev)) out += BREAK;
    out += escapeAss(ch);
  });
  if (inCjkFont) out += `{\\fn${slotFont}}`;
  return out;
}

/** Bahasa CJK cadangan per slot: dari Kana/Hangul yang muncul di slot itu pada cue mana pun; default Mandarin. */
export function slotCjkLangs(cues: { lines: string[] }[], slotCount: number, slotFonts: string[]): CjkLang[] {
  return Array.from({ length: slotCount }, (_, i) => {
    const own = findFamily(slotFonts[i] ?? '')?.cjk;
    if (own) return own;
    const lastSlot = i === slotCount - 1;
    const text = cues.map((c) => (lastSlot ? c.lines.slice(i).join(' ') : c.lines[i] ?? '')).join(' ');
    return detectCjkLang(text) ?? 'zh-hans';
  });
}
