import { describe, expect, it } from 'vitest';
import { fontSetOf, fontsForAss } from '@/core/render/fonts';
import { buildAss } from '../ass';
import { assLineText, BREAK, detectCjkLang, slotCjkLangs } from '../cjk';
import { decodeSrtBytes, parseSrt } from '../srt';

const slot = { label: 'x', font: 'Poppins', bold: true, italic: false, size: 60, color: '#FFFFFF', outlineColor: '#000000', outline: 3, shadow: 1, box: false, boxColor: '#000000', boxOpacity: 60 };

describe('detectCjkLang', () => {
  it('kana → ja, hangul → ko, Han saja → null', () => {
    expect(detectCjkLang('今日はいい天気')).toBe('ja');
    expect(detectCjkLang('안녕하세요')).toBe('ko');
    expect(detectCjkLang('你好世界')).toBeNull();
    expect(detectCjkLang('Hello')).toBeNull();
  });
});

describe('assLineText', () => {
  it('teks Latin tidak berubah selain escape', () => {
    expect(assLineText('Halo {dunia}', 'Poppins', 'zh-hans')).toBe('Halo \\{dunia\\}');
  });

  it('bagian CJK pada font Latin memakai font cadangan, lalu kembali ke font slot', () => {
    expect(assLineText('Hi 안녕 친구 ok', 'Poppins', 'zh-hans')).toBe('Hi {\\fnNoto Sans KR}안녕 친구{\\fnPoppins} ok');
  });

  it('Hangul tidak disisipi titik potong (dipotong per kata)', () => {
    expect(assLineText('안녕하세요', 'Noto Sans KR', 'ko')).toBe('안녕하세요');
  });

  it('Han/Kana disisipi titik potong; tidak sebelum 。 dan tidak sesudah 「', () => {
    const out = assLineText('「東京」です。', 'Noto Sans JP', 'ja');
    expect(out).toBe(`「東${BREAK}京」${BREAK}で${BREAK}す。`);
  });

  it('Han tanpa kana memakai bahasa cadangan slot', () => {
    expect(assLineText('東京', 'Poppins', 'ja')).toContain('{\\fnNoto Sans JP}');
    expect(assLineText('东京', 'Poppins', 'zh-hans')).toContain('{\\fnNoto Sans SC}');
  });

  it('baris Han panjang tanpa kana → Mandarin walau slot condong Jepang', () => {
    expect(assLineText('安全支付，支持分期付款', 'Poppins', 'ja')).toContain('{\\fnNoto Sans SC}');
  });

  it('slot berfont JP dengan teks Hangul tetap memakai font KR', () => {
    expect(assLineText('안녕', 'Noto Sans JP', 'ja')).toBe('{\\fnNoto Sans KR}안녕{\\fnNoto Sans JP}');
  });
});

describe('slotCjkLangs', () => {
  it('menebak bahasa slot dari kana/hangul di cue mana pun', () => {
    const cues = [{ lines: ['Halo', '東京'] }, { lines: ['Hai', 'です'] }, { lines: ['Yo', '서울'] }];
    expect(slotCjkLangs(cues.slice(0, 2), 2, ['Poppins', 'Poppins'])).toEqual(['zh-hans', 'ja']);
    expect(slotCjkLangs([cues[2]!], 2, ['Poppins', 'Poppins'])[1]).toBe('ko');
  });
});

describe('fontsForAss', () => {
  const design = { anchor: 'bottom' as const, marginV: 80, marginH: 40, slots: [slot, { ...slot, bold: false, italic: true }] };

  it('teks Latin saja → hanya Poppins, tanpa font CJK', () => {
    const ass = buildAss([{ start_ms: 0, end_ms: 1000, lines: ['Halo', 'Hello'] }], design, { width: 1080, height: 1920 });
    const fonts = fontsForAss(ass);
    expect(fonts).toEqual(['/fonts/latin-v1/Poppins-Regular.ttf', '/fonts/latin-v1/Poppins-Bold.ttf', '/fonts/latin-v1/Poppins-Italic.ttf']);
    expect(fontSetOf(ass)).toBe('latin-v1');
  });

  it('baris Korea → Noto Sans KR ikut dimuat (regular + bold)', () => {
    const ass = buildAss([{ start_ms: 0, end_ms: 1000, lines: ['Halo', '안녕하세요'] }], design, { width: 1080, height: 1920 });
    const fonts = fontsForAss(ass);
    expect(fonts).toContain('/fonts/cjk-v1/NotoSansKR-Regular.otf');
    expect(fonts).toContain('/fonts/cjk-v1/NotoSansKR-Bold.otf');
    expect(fonts.some((f) => f.includes('JP') || f.includes('SC'))).toBe(false);
    expect(fontSetOf(ass)).toBe('latin-cjk-v1');
  });
});

describe('decodeSrtBytes (encoding lama CJK)', () => {
  const srt = (body: number[]) => new Uint8Array([...new TextEncoder().encode('1\n00:00:00,000 --> 00:00:01,000\n'), ...body, 0x0a]).buffer;

  it('Shift_JIS', () => {
    const r = decodeSrtBytes(srt([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd])); // こんにちは
    expect(r.encoding).toBe('shift_jis');
    expect(parseSrt(r.text, r.encoding).cues[0]!.lines[0]).toBe('こんにちは');
  });

  it('EUC-KR', () => {
    const r = decodeSrtBytes(srt([0xbe, 0xc8, 0xb3, 0xe7])); // 안녕
    expect(r).toMatchObject({ encoding: 'euc-kr' });
    expect(r.text).toContain('안녕');
  });

  it('GB18030', () => {
    const r = decodeSrtBytes(srt([0xc4, 0xe3, 0xba, 0xc3])); // 你好
    expect(r.encoding).toBe('gb18030');
    expect(r.text).toContain('你好');
    expect(parseSrt(r.text, r.encoding).warnings[0]?.message).toContain('GB18030');
  });
});
