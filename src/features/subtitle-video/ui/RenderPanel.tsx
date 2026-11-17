'use client';

import { useEffect, useRef, useState } from 'react';
import { detectRenderCapabilities, RenderError, type RenderCapabilities, type RenderProgress, type RenderResult } from '@/core/render';
import { OUTPUT_PRESETS, type SubtitleVideoProject } from '../model';
import { runProjectRender } from '../run-render';
import { projectDuration, SpecBuildError } from '../spec-builder';
import { useEditor } from '../store';
import styles from './editor.module.css';

const PREVIEW_MAX_MS = 8000;
const STAGE: Record<RenderProgress['stage'], string> = {
  preparing: 'Menyiapkan', subtitles: 'Merender subtitle', audio: 'Mencampur audio', video: 'Merender video', finalizing: 'Menyelesaikan file', done: 'Selesai',
};

const errorLines = (e: unknown): string[] => {
  if (e instanceof DOMException && e.name === 'AbortError') return ['Dibatalkan'];
  if (e instanceof RenderError) return [e.message, ...(e.details ?? [])];
  if (e instanceof SpecBuildError) return [e.message];
  return [e instanceof Error ? e.message : String(e)];
};

export default function RenderPanel({ project }: { project: SubtitleVideoProject }) {
  const selectedCueId = useEditor((s) => s.selectedCueId);
  const [caps, setCaps] = useState<RenderCapabilities | null>(null);
  const [mode, setMode] = useState<'preview' | 'full' | null>(null);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [result, setResult] = useState<{ url: string; kind: 'preview' | 'full'; stats: RenderResult['stats'] } | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const preset = OUTPUT_PRESETS[project.preset];

  useEffect(() => { detectRenderCapabilities(preset).then(setCaps).catch(() => setCaps(null)); }, [preset]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const duration = projectDuration(project);
  const tooLong = caps ? duration > caps.maxDurationMs : false;

  const run = async (kind: 'preview' | 'full') => {
    const ac = new AbortController();
    abortRef.current = ac;
    setMode(kind); setError(null); setProgress(null); setResult(null);
    try {
      let range: { from_ms: number; to_ms: number } | undefined;
      if (kind === 'preview') {
        const sorted = [...project.cues].sort((a, b) => a.start_ms - b.start_ms);
        const i = Math.max(0, sorted.findIndex((c) => c.id === selectedCueId));
        const from = i === 0 ? 0 : sorted[i]!.start_ms;
        range = { from_ms: from, to_ms: Math.min(duration, from + PREVIEW_MAX_MS, (sorted[i + 1]?.end_ms ?? duration)) };
      }
      const r = await runProjectRender(project, {
        range, scale: kind === 'preview' ? 0.5 : 1, onProgress: setProgress, signal: ac.signal,
        fileName: kind === 'full' ? `${project.title.replace(/[^\w-]+/g, '_')}.mp4` : undefined,
      });
      setResult({ url: URL.createObjectURL(r.file), kind, stats: r.stats });
    } catch (e) {
      setError(errorLines(e));
    } finally {
      abortRef.current = null;
      setMode(null);
    }
  };

  const busy = mode !== null;
  const canRun = !!caps?.canRender && project.cues.length > 0 && !busy;
  return (
    <section className="vk-card">
      <h2 className={styles.h2}>Pratinjau &amp; render</h2>
      <p className={styles.muted}>{preset.label} · {preset.width}×{preset.height} · durasi {(duration / 1000).toFixed(1)} detik</p>
      {caps && !caps.canRender && (
        <div className={styles.warning}>
          Perangkat ini tidak bisa me-render video: {caps.reasons.join('; ')}. Coba Chrome/Edge terbaru di laptop.
        </div>
      )}
      {tooLong && <div className={styles.warning}>Video lebih panjang dari batas perangkat ini ({caps!.maxDurationMs / 60_000} menit).</div>}
      <div className={styles.row} style={{ margin: '10px 0' }}>
        <button className="vk-btn vk-btn-ghost" disabled={!canRun} onClick={() => void run('preview')}>Pratinjau cue terpilih</button>
        <button className="vk-btn" disabled={!canRun || tooLong} onClick={() => void run('full')}>Render video</button>
        {busy && <button className="vk-btn vk-btn-ghost" onClick={() => abortRef.current?.abort()}>Batalkan</button>}
      </div>
      {busy && progress && (
        <div className={styles.progress}>
          <div className="vk-progress"><span style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div>
          <p className={styles.muted}>{mode === 'preview' ? 'Pratinjau' : 'Render'}: {STAGE[progress.stage]}{progress.totalFrames ? ` · ${progress.frame}/${progress.totalFrames}` : ''}</p>
        </div>
      )}
      {error && <div className={styles.error} data-role="render-error">{error.map((l) => <p key={l}>{l}</p>)}</div>}
      {result && (
        <div style={{ display: 'grid', gap: 8 }}>
          <video className={styles.video} src={result.url} controls playsInline autoPlay={result.kind === 'preview'} />
          <p className={styles.muted}>
            {result.kind === 'preview' ? 'Pratinjau (resolusi ½)' : 'Hasil akhir'} · {(result.stats.totalMs / 1000).toFixed(1)} dtk proses · {(result.stats.bytes / 1e6).toFixed(1)} MB
          </p>
          {result.kind === 'full' && <a className="vk-btn" href={result.url} download={`${project.title.replace(/[^\w-]+/g, '_') || 'videokit'}.mp4`}>Unduh MP4</a>}
        </div>
      )}
    </section>
  );
}
