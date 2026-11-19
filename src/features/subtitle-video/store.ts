// Store editor (Zustand) dengan undo/redo berbasis snapshot dokumen + simpan otomatis ke IndexedDB.
import { create } from 'zustand';
import type { LineStyleOverride, SlotStyle, SubtitleDesign } from '@/core/subtitle/ass';
import type { SrtCue } from '@/core/subtitle/srt';
import {
  clampCueTiming, defaultSlot, fitCueToDuration, insertCueAt, insertCueRipple, MIN_STYLE_SLOTS, newId, shiftAllCues, shiftCuesFrom, type BackgroundMusic, type BackgroundVideo, type Cue, type CueAudio,
  type CueVisual, type MediaRef, type OutputPreset, type SubtitleVideoProject, type VoiceSettings,
} from './model';
import { saveProject } from './storage';

const HISTORY_LIMIT = 100;
const AUTOSAVE_MS = 600;

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

interface EditorState {
  project: SubtitleVideoProject | null;
  past: SubtitleVideoProject[];
  future: SubtitleVideoProject[];
  saveState: SaveState;
  selectedCueId: string | null;

  load(p: SubtitleVideoProject): void;
  undo(): void;
  redo(): void;
  select(cueId: string | null): void;

  setTitle(title: string): void;
  setPreset(preset: OutputPreset): void;
  importCues(cues: SrtCue[]): void;
  updateCueLines(cueId: string, lines: string[]): void;
  /** Ubah satu baris tanpa menggeser posisi baris lain (baris kosong tetap dipertahankan). */
  updateCueLine(cueId: string, line: number, text: string): void;
  addCueLine(cueId: string): void;
  removeCueLine(cueId: string, line: number): void;
  /** Ubah waktu cue (dibatasi tetangga). `transient` = selama drag: tanpa riwayat; panggil commitDrag di akhir. */
  updateCueTiming(cueId: string, start_ms: number, end_ms: number, opts?: { transient?: boolean }): void;
  /** Akhiri drag: satu entri undo untuk seluruh gerakan, dengan keadaan sebelum drag. */
  commitDrag(before: SubtitleVideoProject): void;
  insertCue(atMs: number): string | null;
  /** Geser semua cue (ms); satu langkah undo. Mengembalikan delta yang dipakai (dibatasi agar tidak < 0). */
  shiftCues(deltaMs: number): number;
  /** Sisipkan cue + geser cue sesudahnya (selalu berhasil). */
  insertCueRipple(atMs: number): string;
  /**
   * Geser cue `cueId` beserta semua sesudahnya. `base` = keadaan acuan (mis. saat drag dimulai) agar gerakan tidak
   * menumpuk; `transient` = tanpa riwayat (akhiri dengan commitDrag). Mengembalikan delta yang dipakai.
   */
  shiftCuesFrom(cueId: string, deltaMs: number, opts?: { base?: SubtitleVideoProject; transient?: boolean }): number;
  deleteCue(cueId: string): void;
  setCueLineStyle(cueId: string, line: number, patch: LineStyleOverride): void;
  resetCueLineStyle(cueId: string, line: number): void;
  setBackgroundColor(color: string): void;
  setCueVisual(cueId: string, visual: CueVisual | undefined): void;
  extendVisualToNext(cueId: string): void;
  setCueAudio(cueId: string, audio: CueAudio | undefined): void;
  /** Panjangkan cue sepanjang `durationMs` (cue sesudahnya bergeser bila perlu); satu langkah undo. */
  fitCueToDuration(cueId: string, durationMs: number): void;
  updateDesign(patch: Partial<Omit<SubtitleDesign, 'slots'>>): void;
  updateSlot(index: number, patch: Partial<SlotStyle>): void;
  /** Tambah gaya default baris berikutnya (salinan gaya baris terakhir). */
  addSlot(): void;
  /** Hapus gaya baris (hanya yang ditambahkan; minimal MIN_STYLE_SLOTS). */
  removeSlot(index: number): void;
  setMusic(music: BackgroundMusic | undefined): void;
  setBackgroundVideo(bg: BackgroundVideo | undefined): void;
  setDuckingLevel(level: number): void;
  /** Efek suara narasi (preset + nilai efek); undefined = asli. */
  setVoice(voice: VoiceSettings | undefined): void;
  addMedia(ref: MediaRef): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditor = create<EditorState>((set, get) => {
  /** Terapkan perubahan dokumen: catat riwayat undo, tandai kotor, jadwalkan simpan otomatis. */
  const commit = (mutate: (p: SubtitleVideoProject) => SubtitleVideoProject, opts: { history?: boolean } = {}) => {
    const cur = get().project;
    if (!cur) return;
    const next = { ...mutate(cur), updatedAt: Date.now() };
    set((s) => ({
      project: next,
      past: opts.history === false ? s.past : [...s.past.slice(-HISTORY_LIMIT + 1), cur],
      future: opts.history === false ? s.future : [],
      saveState: 'dirty',
    }));
    scheduleSave();
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const p = get().project;
      if (!p) return;
      set({ saveState: 'saving' });
      try { await saveProject(p); if (get().project === p) set({ saveState: 'saved' }); else scheduleSave(); }
      catch { set({ saveState: 'error' }); }
    }, AUTOSAVE_MS);
  };
  const mapCue = (cueId: string, f: (c: Cue) => Cue) => (p: SubtitleVideoProject) => ({ ...p, cues: p.cues.map((c) => (c.id === cueId ? f(c) : c)) });
  return {
    project: null, past: [], future: [], saveState: 'saved', selectedCueId: null,

    load: (p) => set({ project: p, past: [], future: [], saveState: 'saved', selectedCueId: p.cues[0]?.id ?? null }),
    undo: () => {
      const { past, project, future } = get();
      const prev = past.at(-1);
      if (!prev || !project) return;
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future], saveState: 'dirty' });
      scheduleSave();
    },
    redo: () => {
      const { past, project, future } = get();
      const next = future[0];
      if (!next || !project) return;
      set({ project: next, past: [...past, project], future: future.slice(1), saveState: 'dirty' });
      scheduleSave();
    },
    select: (cueId) => set({ selectedCueId: cueId }),

    setTitle: (title) => commit((p) => ({ ...p, title })),
    setPreset: (preset) => commit((p) => ({ ...p, preset })),
    importCues: (cues) => {
      commit((p) => ({ ...p, cues: cues.map((c) => ({ id: newId(), start_ms: c.start_ms, end_ms: c.end_ms, lines: c.lines })) }));
      set({ selectedCueId: get().project?.cues[0]?.id ?? null });
    },
    updateCueLines: (cueId, lines) => commit(mapCue(cueId, (c) => ({ ...c, lines }))),
    updateCueLine: (cueId, line, text) => commit(mapCue(cueId, (c) => {
      const lines = [...c.lines];
      while (lines.length <= line) lines.push('');
      lines[line] = text;
      return { ...c, lines };
    })),
    addCueLine: (cueId) => commit(mapCue(cueId, (c) => ({ ...c, lines: [...c.lines, ''] }))),
    removeCueLine: (cueId, line) => commit(mapCue(cueId, (c) => (c.lines.length <= 1 ? c : {
      ...c,
      lines: c.lines.filter((_, i) => i !== line),
      lineStyles: c.lineStyles?.filter((_, i) => i !== line),
    }))),
    updateCueTiming: (cueId, start_ms, end_ms, opts = {}) => commit((p) => {
      const t = clampCueTiming(p.cues, cueId, start_ms, end_ms);
      return mapCue(cueId, (c) => ({ ...c, ...t }))(p);
    }, { history: !opts.transient }),
    commitDrag: (before) => {
      const cur = get().project;
      if (!cur || cur === before) return;
      set((s) => ({ past: [...s.past.slice(-HISTORY_LIMIT + 1), before], future: [] }));
    },
    insertCue: (atMs) => {
      const p = get().project;
      if (!p) return null;
      const r = insertCueAt(p.cues, atMs, Math.max(1, p.design.slots.length));
      if (!r) return null;
      commit((cur) => ({ ...cur, cues: r.cues }));
      set({ selectedCueId: r.id });
      return r.id;
    },
    shiftCues: (deltaMs) => {
      const p = get().project;
      if (!p) return 0;
      const r = shiftAllCues(p.cues, deltaMs);
      if (r.applied !== 0) commit((cur) => ({ ...cur, cues: r.cues }));
      return r.applied;
    },
    insertCueRipple: (atMs) => {
      const p = get().project!;
      const r = insertCueRipple(p.cues, atMs, Math.max(1, p.design.slots.length));
      commit((cur) => ({ ...cur, cues: r.cues }));
      set({ selectedCueId: r.id });
      return r.id;
    },
    shiftCuesFrom: (cueId, deltaMs, opts = {}) => {
      const base = opts.base ?? get().project;
      if (!base) return 0;
      const r = shiftCuesFrom(base.cues, cueId, deltaMs);
      commit((cur) => ({ ...cur, cues: r.cues }), { history: !opts.transient });
      return r.applied;
    },
    deleteCue: (cueId) => {
      commit((p) => ({ ...p, cues: p.cues.filter((c) => c.id !== cueId) }));
      if (get().selectedCueId === cueId) set({ selectedCueId: null });
    },
    setCueLineStyle: (cueId, line, patch) => commit(mapCue(cueId, (c) => {
      const list = [...(c.lineStyles ?? [])];
      while (list.length <= line) list.push(null);
      list[line] = { ...(list[line] ?? {}), ...patch };
      return { ...c, lineStyles: list };
    })),
    resetCueLineStyle: (cueId, line) => commit(mapCue(cueId, (c) => {
      if (!c.lineStyles?.[line]) return c;
      const list = c.lineStyles.map((o, i) => (i === line ? null : o));
      return { ...c, lineStyles: list.some(Boolean) ? list : undefined };
    })),
    setBackgroundColor: (color) => commit((p) => ({ ...p, backgroundColor: color })),
    setCueVisual: (cueId, visual) => commit(mapCue(cueId, (c) => ({ ...c, visual }))),
    extendVisualToNext: (cueId) => commit((p) => {
      const sorted = [...p.cues].sort((a, b) => a.start_ms - b.start_ms);
      const i = sorted.findIndex((c) => c.id === cueId);
      const src = sorted[i];
      const nxt = sorted[i + 1];
      if (!src?.visual || !nxt) return p;
      // klip berlanjut: titik mulai cue berikutnya = titik mulai + lama cue ini
      const visual: CueVisual = { ...src.visual, sourceInMs: src.visual.sourceInMs + (nxt.start_ms - src.start_ms) };
      return mapCue(nxt.id, (c) => ({ ...c, visual }))(p);
    }),
    setCueAudio: (cueId, audio) => commit(mapCue(cueId, (c) => ({ ...c, audio }))),
    fitCueToDuration: (cueId, durationMs) => {
      const p = get().project;
      if (!p) return;
      const r = fitCueToDuration(p.cues, cueId, durationMs);
      if (r.changed) commit((cur) => ({ ...cur, cues: r.cues }));
    },
    updateDesign: (patch) => commit((p) => ({ ...p, design: { ...p.design, ...patch } })),
    updateSlot: (index, patch) => commit((p) => ({
      ...p, design: { ...p.design, slots: p.design.slots.map((s, i) => (i === index ? { ...s, ...patch } : s)) },
    })),
    addSlot: () => commit((p) => {
      const last = p.design.slots[p.design.slots.length - 1] ?? defaultSlot(0);
      return { ...p, design: { ...p.design, slots: [...p.design.slots, { ...last, label: `Bahasa ${p.design.slots.length + 1}` }] } };
    }),
    removeSlot: (index) => commit((p) => (p.design.slots.length <= MIN_STYLE_SLOTS || index < MIN_STYLE_SLOTS ? p : {
      ...p, design: { ...p.design, slots: p.design.slots.filter((_, i) => i !== index) },
    })),
    setMusic: (music) => commit((p) => ({ ...p, music })),
    setBackgroundVideo: (bg) => commit((p) => ({ ...p, backgroundVideo: bg })),
    setDuckingLevel: (level) => commit((p) => ({ ...p, duckingLevel: level })),
    setVoice: (voice) => commit((p) => ({ ...p, voice })),
    addMedia: (ref) => commit((p) => ({ ...p, media: { ...p.media, [ref.id]: ref } }), { history: false }),
  };
});
