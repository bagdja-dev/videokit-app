import type { Metadata } from 'next';
import RequireAuth from '@/components/RequireAuth';
import AvatarLab from './AvatarLab';

export const metadata: Metadata = { title: 'Avatar Lab', robots: { index: false } };

// PoC Fase A0 tool Avatar Rekam (plan/videokit/avatar-record/execution-plan.md). Halaman internal.
export default function AvatarLabPage() {
  return (
    <RequireAuth>
      <AvatarLab />
    </RequireAuth>
  );
}
