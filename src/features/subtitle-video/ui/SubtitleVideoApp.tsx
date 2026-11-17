'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/core/auth/session';
import { bindStorageToUser } from '../storage';
import Editor from './Editor';
import ProjectList from './ProjectList';

/** Pengatur tampilan: daftar project atau editor (?id=…). Static export → navigasi lewat query string. */
export default function SubtitleVideoApp() {
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined);
  const userId = useSession((s) => s.user?.userId);
  const [boundTo, setBoundTo] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void bindStorageToUser(userId).finally(() => { if (alive) setBoundTo(userId); });
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    const read = () => setProjectId(new URLSearchParams(location.search).get('id'));
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  const open = useCallback((id: string | null) => {
    const url = id ? `?id=${encodeURIComponent(id)}` : location.pathname;
    history.pushState(null, '', url);
    setProjectId(id);
  }, []);

  if (projectId === undefined || !userId || boundTo !== userId) return null;
  return projectId ? <Editor projectId={projectId} onBack={() => open(null)} /> : <ProjectList onOpen={open} />;
}
