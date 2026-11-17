// Pembuat ASS sederhana KHUSUS sampel dev/e2e. Generator ASS produksi milik videokit-api (Fase 1,
// overview §4.3); aturan yang sama: satu cue = satu event, pindah slot dengan \N{\rSlotN}.

export function parseSrt(text) {
  const cues = [];
  for (const block of text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/)) {
    const rows = block.split('\n');
    const ti = rows.findIndex((r) => r.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = rows[ti].split('-->').map((s) => toMs(s.trim()));
    const lines = rows.slice(ti + 1).map((l) => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    if (lines.length && b > a) cues.push({ start_ms: a, end_ms: b, lines });
  }
  return cues;
}

function toMs(t) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
  if (!m) throw new Error(`Waktu SRT tidak valid: ${t}`);
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, '0').slice(0, 3);
}

const assColor = (hex, alpha = 0) => {
  const h = hex.replace('#', '');
  return `&H${alpha.toString(16).padStart(2, '0')}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};
const assTime = (ms) => {
  const cs = Math.round(ms / 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${Math.floor(cs / 360000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
};
const esc = (t) => t.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');

export function buildAss(cues, design, output) {
  const align = { bottom: 2, middle: 5, top: 8 }[design.anchor] ?? 2;
  const styles = design.slots.map((s, i) => [
    `Style: Slot${i + 1}`, s.font, s.size, assColor(s.color), assColor(s.color), assColor(s.outline_color ?? '#000000'),
    assColor('#000000', 0x80), s.bold ? -1 : 0, s.italic ? -1 : 0, 0, 0, 100, 100, 0, 0, 1, s.outline ?? 0, s.shadow ?? 0,
    align, design.margin_h, design.margin_h, design.margin_v, 1,
  ].join(','));
  const events = cues.map((c) => {
    const text = c.lines.map((l, i) => (i ? `\\N{\\rSlot${Math.min(i, design.slots.length - 1) + 1}}` : '') + esc(l)).join('');
    return `Dialogue: 0,${assTime(c.start_ms)},${assTime(c.end_ms)},Slot1,,0,0,0,,${text}`;
  });
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${output.width}`, `PlayResY: ${output.height}`, 'WrapStyle: 0',
    'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles, '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...events, '',
  ].join('\n');
}
