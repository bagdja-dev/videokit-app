// Generator ASS dari cue + desain slot (VideoKit overview §4.3). Satu cue = SATU event; pindah slot dengan
// \N{\rSlotN} sehingga baris yang ter-wrap otomatis mendorong slot berikutnya ke bawah.
// Huruf CJK: font cadangan + titik potong baris, lihat cjk.ts.
// Fase MVP lokal: dijalankan di browser. Saat videokit-api ada, versi server menjadi otoritatif.

import { assLineText, slotCjkLangs } from './cjk';

export type Anchor = 'top' | 'middle' | 'bottom';

export interface SlotStyle {
  /** Nama tampilan slot, mis. "Indonesia". */
  label: string;
  font: string;
  bold: boolean;
  italic: boolean;
  /** Ukuran font dalam piksel output. */
  size: number;
  color: string;
  outlineColor: string;
  outline: number;
  shadow: number;
  /** Kotak latar di belakang teks. */
  box: boolean;
  boxColor: string;
  /** 0–100 */
  boxOpacity: number;
}

export interface SubtitleDesign {
  anchor: Anchor;
  marginV: number;
  marginH: number;
  slots: SlotStyle[];
}

/** Override gaya untuk satu baris pada satu cue (menimpa gaya slot; `label` tidak relevan). */
export type LineStyleOverride = Partial<Omit<SlotStyle, 'label'>>;

export interface AssCue {
  start_ms: number;
  end_ms: number;
  lines: string[];
  /** Override gaya per baris (indeks = baris). Kosong/null = gaya slot apa adanya. */
  lineStyles?: Array<LineStyleOverride | null | undefined>;
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
/** #RRGGBB + transparansi (0 = opak, 255 = transparan) → &HAABBGGRR */
export function assColor(hex: string, alpha = 0): string {
  const h = hex.replace('#', '');
  return `&H${hex2(alpha)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

const assTime = (ms: number) => {
  const cs = Math.round(ms / 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(cs / 360000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
};
const ALIGN: Record<Anchor, number> = { bottom: 2, middle: 5, top: 8 };

const hasOverride = (o: LineStyleOverride | null | undefined): o is LineStyleOverride =>
  !!o && Object.values(o).some((v) => v !== undefined);

export function buildAss(cues: AssCue[], design: SubtitleDesign, output: { width: number; height: number }): string {
  const align = ALIGN[design.anchor];
  const styleLine = (name: string, s: SlotStyle) => {
    // BorderStyle 3 = kotak opak; warna kotak memakai OutlineColour, transparansi dari boxOpacity.
    const boxAlpha = 255 - (s.boxOpacity / 100) * 255;
    const outlineColour = s.box ? assColor(s.boxColor, boxAlpha) : assColor(s.outlineColor);
    return [
      `Style: ${name}`, s.font, s.size, assColor(s.color), assColor(s.color), outlineColour,
      assColor('#000000', 0x80), s.bold ? -1 : 0, s.italic ? -1 : 0, 0, 0, 100, 100, 0, 0,
      s.box ? 3 : 1, s.box ? Math.max(4, s.outline) : s.outline, s.box ? 0 : s.shadow,
      align, design.marginH, design.marginH, design.marginV, 1,
    ].join(',');
  };
  const styles = design.slots.map((s, i) => styleLine(`Slot${i + 1}`, s));
  // Override per cue → style turunan unik per (slot, override), mis. "Slot1o1". Lewat style (bukan tag inline)
  // agar kotak latar (BorderStyle) juga bisa di-override; renderer browser & ffmpeg membaca hal yang sama.
  const derived = new Map<string, { name: string; style: SlotStyle }>();
  const styleFor = (slot: number, o: LineStyleOverride | null | undefined): { name: string; style: SlotStyle } => {
    const base = design.slots[slot] ?? design.slots[0]!;
    if (!hasOverride(o)) return { name: `Slot${slot + 1}`, style: base };
    const clean = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
    const key = `${slot}:${JSON.stringify(clean)}`;
    let d = derived.get(key);
    if (!d) {
      d = { name: `Slot${slot + 1}o${derived.size + 1}`, style: { ...base, ...clean } };
      derived.set(key, d);
    }
    return d;
  };
  const lastSlot = Math.max(0, design.slots.length - 1);
  const langs = slotCjkLangs(cues, design.slots.length, design.slots.map((s) => s.font));
  const events = cues.map((c) => {
    let first = 'Slot1';
    const text = c.lines
      .map((line, i) => {
        const slot = Math.min(i, lastSlot);
        const st = styleFor(slot, c.lineStyles?.[i]);
        if (i === 0) first = st.name;
        return (i === 0 ? '' : `\\N{\\r${st.name}}`) + assLineText(line, st.style.font, langs[slot] ?? 'zh-hans');
      })
      .join('');
    return `Dialogue: 0,${assTime(c.start_ms)},${assTime(c.end_ms)},${first},,0,0,0,,${text}`;
  });
  for (const d of derived.values()) styles.push(styleLine(d.name, d.style));
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${output.width}`, `PlayResY: ${output.height}`,
    'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events, '',
  ].join('\n');
}

