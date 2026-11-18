import type { Metadata } from 'next';
import RequireAuth from '@/components/RequireAuth';
import SubtitleVideoApp from '@/features/subtitle-video/ui/SubtitleVideoApp';

export const metadata: Metadata = {
  title: 'Video Lyric Editor — VideoKit',
  description: 'Buat video lirik dan subtitle multi-bahasa dari file SRT: klip atau gambar per baris, gaya teks per bahasa, render MP4 di perangkat.',
};

export default function SubtitleVideoPage() {
  return (
    <RequireAuth>
      <SubtitleVideoApp />
    </RequireAuth>
  );
}
