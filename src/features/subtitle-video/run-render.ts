// Jalankan render dari dokumen project: bangun spec, ambil Blob media dari IndexedDB, render di browser.
import { renderVideo, type RenderProgress, type RenderResult, type RenderSources } from '@/core/render';
import type { SubtitleVideoProject } from './model';
import { buildRenderJob, type BuildOptions } from './spec-builder';
import { loadMedia } from './storage';

export async function runProjectRender(
  project: SubtitleVideoProject,
  opts: BuildOptions & { onProgress?: (p: RenderProgress) => void; signal?: AbortSignal; fileName?: string } = {},
): Promise<RenderResult> {
  const job = buildRenderJob(project, opts);
  const sources: RenderSources = {};
  for (const id of job.mediaIds) {
    const blob = await loadMedia(id);
    if (!blob) throw new Error(`File "${project.media[id]?.name ?? id}" tidak ditemukan di perangkat ini — unggah ulang`);
    sources[id] = blob;
  }
  sources[job.subtitleKey] = new Blob([job.ass], { type: 'text/plain' });
  return renderVideo(job.spec, sources, { onProgress: opts.onProgress, signal: opts.signal, fileName: opts.fileName });
}
