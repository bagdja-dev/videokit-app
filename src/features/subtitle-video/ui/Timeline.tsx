'use client';

// Timeline cue horizontal: lebar blok sebanding durasi, tepi bisa digeser (ubah waktu), sisip cue di mana saja,
// klik = pilih + lompat, garis posisi putar. Satu gerakan drag = satu langkah undo.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { sortCues, type SubtitleVideoProject } from '../model';
import { formatTime, usePlayback } from '../playback';
import { projectDuration } from '../spec-builder';
import { useEditor } from '../store';
import ShiftCuesModal from './ShiftCuesModal';
import styles from './editor.module.css';

const SNAP_MS = 50;
const ZOOMS = [10, 20, 40, 80, 160, 320]; // px per detik
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

/** start/end = geser tepi; move = geser badan blok (cue ini + semua sesudahnya, ripple). */
type DragMode = 'start' | 'end' | 'move';
const MOVE_THRESHOLD_PX = 4;

export default function Timeline({ project }: { project: SubtitleVideoProject }) {
  const selected = useEditor((s) => s.selectedCueId);
  const { select, updateCueTiming, commitDrag, insertCue, insertCueRipple, shiftCuesFrom, deleteCue } = useEditor.getState();
  const timeMs = usePlayback((s) => s.timeMs);
  const playing = usePlayback((s) => s.playing);
  const seek = usePlayback((s) => s.seek);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoomIdx, setZoomIdx] = useState<number | null>(null);
  const [width, setWidth] = useState(800);
  const [notice, setNotice] = useState<string | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);

  const cues = useMemo(() => sortCues(project.cues), [project.cues]);
  const duration = Math.max(projectDuration(project), 5000);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Zoom awal: seluruh durasi muat di lebar layar (dibulatkan ke tingkat zoom terdekat ke bawah, min. 10 px/dtk).
  const fitIdx = Math.max(0, ZOOMS.findLastIndex((z) => (duration / 1000) * z <= width - 24));
  const pps = ZOOMS[zoomIdx ?? fitIdx]!;
  const x = (ms: number) => (ms / 1000) * pps;
  const msAt = (clientX: number) => {
    const el = scrollRef.current!;
    return Math.max(0, ((clientX - el.getBoundingClientRect().left + el.scrollLeft - 12) / pps) * 1000);
  };
  const tick = TICK_STEPS.find((s) => s * pps >= 64) ?? 300;

  // Ikuti posisi putar saat main.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const px = x(timeMs) + 12;
    if (px < el.scrollLeft + 40 || px > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = px - el.clientWidth * 0.3;
  });

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 2500); };
  const insertAt = (ms: number) => {
    const id = insertCue(ms);
    if (!id) flash('Tidak ada celah di posisi ini — pakai "Sisipkan & geser" agar cue sesudahnya bergeser.');
    else seek(ms);
  };
  const insertRippleAt = (ms: number) => {
    const id = insertCueRipple(ms);
    const c = useEditor.getState().project?.cues.find((q) => q.id === id);
    if (c) seek(c.start_ms);
  };

  const drag = useRef<{ id: string; mode: DragMode; startX: number; s: number; e: number; before: SubtitleVideoProject; moved: boolean } | null>(null);
  const onHandleDown = (ev: ReactPointerEvent, id: string, mode: DragMode) => {
    ev.stopPropagation();
    const c = cues.find((q) => q.id === id);
    const p = useEditor.getState().project;
    if (!c || !p) return;
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    drag.current = { id, mode, startX: ev.clientX, s: c.start_ms, e: c.end_ms, before: p, moved: mode !== 'move' };
    if (mode !== 'move') select(id);
  };
  const onHandleMove = (ev: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.abs(ev.clientX - d.startX) < MOVE_THRESHOLD_PX) return;
      d.moved = true;
      select(d.id);
    }
    const delta = Math.round(((ev.clientX - d.startX) / pps) * 1000 / SNAP_MS) * SNAP_MS;
    if (d.mode === 'start') updateCueTiming(d.id, d.s + delta, d.e, { transient: true });
    else if (d.mode === 'end') updateCueTiming(d.id, d.s, d.e + delta, { transient: true });
    else shiftCuesFrom(d.id, delta, { base: d.before, transient: true });
  };
  const onHandleUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) commitDrag(d.before); // klik tanpa geser ditangani onClick (juga untuk keyboard/teknologi bantu)
  };

  // Penanda posisi (merah): tekan/geser di penggaris untuk menggeser posisi putar.
  const scrubbing = useRef(false);
  const onRulerDown = (ev: ReactPointerEvent) => {
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    scrubbing.current = true;
    seek(msAt(ev.clientX));
  };
  const onRulerMove = (ev: ReactPointerEvent) => { if (scrubbing.current) seek(Math.min(msAt(ev.clientX), duration)); };
  const onRulerUp = () => { scrubbing.current = false; };

  const selIndex = cues.findIndex((c) => c.id === selected);
  return (
    <section className={`vk-card ${styles.timelineCard}`} aria-label="Timeline cue">
      <div className={styles.timelineBar}>
        <button className="vk-btn vk-btn-ghost" onClick={() => insertAt(timeMs)} data-role="insert-cue" title="Sisipkan cue di celah pada posisi putar (cue lain tidak bergeser)">+ Sisipkan cue</button>
        <button className="vk-btn vk-btn-ghost" onClick={() => insertRippleAt(timeMs)} data-role="insert-ripple" title="Sisipkan cue 2 detik di posisi putar dan geser semua cue sesudahnya">+ Sisipkan &amp; geser</button>
        <button className="vk-btn vk-btn-ghost" disabled={selIndex < 0} onClick={() => { if (selected && confirm('Hapus cue ini?')) deleteCue(selected); }}>Hapus cue</button>
        <button className="vk-btn vk-btn-ghost" onClick={() => setShiftOpen(true)} data-role="open-shift" title="Geser waktu semua cue, atau cue terpilih & sesudahnya">Geser cue…</button>
        <span className={styles.timelineInfo}>
          {cues.length} cue{selIndex >= 0 ? ` · cue #${selIndex + 1} dipilih` : ''} · seret blok = geser cue & sesudahnya · seret tepi = ubah durasi
        </span>
        <span className={styles.zoom}>
          <button className="vk-btn vk-btn-ghost" aria-label="Perkecil" disabled={(zoomIdx ?? fitIdx) === 0} onClick={() => setZoomIdx(Math.max(0, (zoomIdx ?? fitIdx) - 1))}>−</button>
          <button className="vk-btn vk-btn-ghost" aria-label="Perbesar" disabled={(zoomIdx ?? fitIdx) === ZOOMS.length - 1} onClick={() => setZoomIdx(Math.min(ZOOMS.length - 1, (zoomIdx ?? fitIdx) + 1))}>+</button>
        </span>
      </div>
      {notice && <p className={styles.error} role="status">{notice}</p>}
      <div className={styles.timelineScroll} ref={scrollRef}>
        <div className={styles.timelineTrack} style={{ width: x(duration) + 24 }}>
          <div className={styles.ruler} onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={onRulerUp} onPointerCancel={onRulerUp}
            data-role="timeline-ruler" title="Tekan & geser untuk memindah posisi putar">
            <span className={styles.playheadKnob} style={{ left: x(timeMs) + 12 }} aria-hidden />
            {Array.from({ length: Math.floor(duration / 1000 / tick) + 1 }, (_, i) => (
              <span key={i} className={styles.tick} style={{ left: x(i * tick * 1000) + 12 }}>{formatTime(i * tick * 1000).replace(/\.0$/, '')}</span>
            ))}
          </div>
          <div className={styles.lane} onDoubleClick={(e) => { if (e.target === e.currentTarget) insertAt(msAt(e.clientX)); }} data-role="timeline-lane">
            {cues.map((c, i) => {
              const isSel = c.id === selected;
              const live = timeMs >= c.start_ms && timeMs < c.end_ms;
              const text = c.lines.find((l) => l.trim()) ?? '(kosong)';
              return (
                <div key={c.id} data-cue={i + 1} data-selected={isSel || undefined}
                  className={`${styles.block} ${isSel ? styles.blockSelected : ''} ${live ? styles.blockLive : ''} ${c.visual ? '' : styles.blockNoVisual}`}
                  style={{ left: x(c.start_ms) + 12, width: Math.max(6, x(c.end_ms - c.start_ms)) }}
                  title={`#${i + 1} · ${formatTime(c.start_ms)}–${formatTime(c.end_ms)}\n${c.lines.join('\n')}\nSeret untuk menggeser cue ini & semua sesudahnya`}
                  onClick={() => { select(c.id); seek(c.start_ms); }}
                  onPointerDown={(e) => onHandleDown(e, c.id, 'move')} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
                  <span className={styles.handle} data-edge="start" aria-label="Geser awal cue"
                    onPointerDown={(e) => onHandleDown(e, c.id, 'start')} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp} />
                  <span className={styles.blockText}>
                    <b>{i + 1}</b> {c.visual ? '🎞 ' : ''}{c.audio ? '🔊 ' : ''}{text}
                  </span>
                  <span className={styles.handle} data-edge="end" aria-label="Geser akhir cue"
                    onPointerDown={(e) => onHandleDown(e, c.id, 'end')} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp} />
                </div>
              );
            })}
            <div className={styles.playhead} style={{ left: x(timeMs) + 12 }} aria-hidden />
          </div>
        </div>
      </div>
      <ShiftCuesModal project={project} open={shiftOpen} onClose={() => setShiftOpen(false)} />
    </section>
  );
}
