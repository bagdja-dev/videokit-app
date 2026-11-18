// Store editor (Zustand) dengan undo/redo berbasis snapshot dokumen + simpan otomatis ke IndexedDB.
import { create } from 'zustand';
import type { SlotStyle, SubtitleDesign } from '@/core/subtitle/ass';
import type { SrtCue } from '@/core/subtitle/srt';
import {
  defaultSlot, newId, slotsNeeded, type BackgroundMusic, type BackgroundVideo, type Cue, type CueAudio,
  type CueVisual, type MediaRef, type OutputPreset, type SubtitleVideoProject,
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
  updateCueTiming(cueId: string, start_ms: number, end_ms: number): void;
  setCueVisual(cueId: string, visual: CueVisual | undefined): void;
  extendVisualToNext(cueId: string): void;
  setCueAudio(cueId: string, audio: CueAudio | undefined): void;
  updateDesign(patch: Partial<Omit<SubtitleDesign, 'slots'>>): void;
  updateSlot(index: number, patch: Partial<SlotStyle>): void;
  setMusic(music: BackgroundMusic | undefined): void;
  setBackgroundVideo(bg: BackgroundVideo | undefined): void;
  setDuckingLevel(level: number): void;
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
  /** Pastikan jumlah slot desain cukup untuk baris terbanyak. */
  const ensureSlots = (p: SubtitleVideoProject): SubtitleVideoProject => {
    const need = slotsNeeded(p.cues);
    if (p.design.slots.length >= need) return p;
    const slots = [...p.design.slots];
    while (slots.length < need) slots.push(defaultSlot(slots.length));
    return { ...p, design: { ...p.design, slots } };
  };

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
      commit((p) => ensureSlots({ ...p, cues: cues.map((c) => ({ id: newId(), start_ms: c.start_ms, end_ms: c.end_ms, lines: c.lines })) }));
      set({ selectedCueId: get().project?.cues[0]?.id ?? null });
    },
    updateCueLines: (cueId, lines) => commit((p) => ensureSlots(mapCue(cueId, (c) => ({ ...c, lines }))(p))),
    updateCueTiming: (cueId, start_ms, end_ms) => commit(mapCue(cueId, (c) => ({ ...c, start_ms, end_ms }))),
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
    updateDesign: (patch) => commit((p) => ({ ...p, design: { ...p.design, ...patch } })),
    updateSlot: (index, patch) => commit((p) => ({
      ...p, design: { ...p.design, slots: p.design.slots.map((s, i) => (i === index ? { ...s, ...patch } : s)) },
    })),
    setMusic: (music) => commit((p) => ({ ...p, music })),
    setBackgroundVideo: (bg) => commit((p) => ({ ...p, backgroundVideo: bg })),
    setDuckingLevel: (level) => commit((p) => ({ ...p, duckingLevel: level })),
    addMedia: (ref) => commit((p) => ({ ...p, media: { ...p.media, [ref.id]: ref } }), { history: false }),
  };
});
