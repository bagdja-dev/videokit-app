import { describe, expect, it } from 'vitest';
import { decodeSrtBytes, parseSrt, toSrt } from '../srt';
import { buildAss, assColor } from '../ass';

const SRT = `1
00:00:00,500 --> 00:00:03,000
Belanja jadi <i>lebih</i> mudah
Shopping made easier

2
00:00:02,800 --> 00:00:06,000
Pilih produk

3
00:00:07,000 --> 00:00:06,500
Waktu salah
`;

describe('parseSrt', () => {
  const r = parseSrt(SRT);

  it('membaca cue multi-baris dan membuang tag HTML', () => {
    expect(r.cues[0]).toEqual({ start_ms: 500, end_ms: 2800, lines: ['Belanja jadi lebih mudah', 'Shopping made easier'] });
    expect(r.warnings.some((w) => w.message.includes('Tag HTML'))).toBe(true);
  });

  it('memotong tumpang tindih dan melewati waktu terbalik', () => {
    expect(r.cues).toHaveLength(2);
    expect(r.cues[0]!.end_ms).toBe(2800);
    expect(r.warnings.some((w) => w.message.startsWith('Tumpang tindih'))).toBe(true);
    expect(r.warnings.some((w) => w.message.includes('dilewati') && w.cue === 3)).toBe(true);
  });

  it('ekspor kembali ke SRT', () => {
    expect(toSrt(r.cues)).toContain('00:00:00,500 --> 00:00:02,800\nBelanja jadi lebih mudah\nShopping made easier');
  });

  it('decode Windows-1252 bila bukan UTF-8 valid', () => {
    const bytes = new Uint8Array([0x43, 0x61, 0x66, 0xe9]).buffer; // "Café" dalam cp1252
    expect(decodeSrtBytes(bytes)).toEqual({ text: 'Café', encoding: 'windows-1252' });
  });
});

describe('buildAss', () => {
  it('satu cue satu event, slot berikutnya lewat \\N{\\rSlotN}', () => {
    const slot = { label: 'A', font: 'Poppins', bold: true, italic: false, size: 72, color: '#FFFFFF', outlineColor: '#000000', outline: 4, shadow: 2, box: false, boxColor: '#000000', boxOpacity: 60 };
    const ass = buildAss([{ start_ms: 500, end_ms: 3000, lines: ['Halo {dunia}', 'Hello'] }], { anchor: 'bottom', marginV: 260, marginH: 80, slots: [slot, { ...slot, size: 48 }] }, { width: 1080, height: 1920 });
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('Dialogue: 0,0:00:00.50,0:00:03.00,Slot1,,0,0,0,,Halo \\{dunia\\}\\N{\\rSlot2}Hello');
    expect(ass).toContain('Style: Slot2,Poppins,48');
  });

  it('warna ASS urutan BGR dengan alpha', () => {
    expect(assColor('#FFE066')).toBe('&H0066E0FF');
    expect(assColor('#000000', 0x80)).toBe('&H80000000');
  });
});
