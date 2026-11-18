import type { Metadata } from 'next';
import RequireAuth from '@/components/RequireAuth';
import RenderLab from './RenderLab';

export const metadata: Metadata = { title: 'Render Lab', robots: { index: false } };

// Halaman uji internal executor browser (Fase 2). Bukan untuk pengguna akhir.
export default function RenderLabPage() {
  return (
    <RequireAuth>
      <RenderLab />
    </RequireAuth>
  );
}
