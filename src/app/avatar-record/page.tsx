import type { Metadata } from 'next';
import RequireAuth from '@/components/RequireAuth';
import AvatarRecordApp from '@/features/avatar-record/ui/AvatarRecordApp';

export const metadata: Metadata = {
  title: 'Avatar Rekam — VideoKit',
  description: 'Rekam komentar video dengan avatar 3D yang mengikuti wajah dan suaramu — untuk kreator faceless.',
};

export default function AvatarRecordPage() {
  return (
    <RequireAuth>
      <AvatarRecordApp />
    </RequireAuth>
  );
}
