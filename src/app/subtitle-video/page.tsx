import type { Metadata } from 'next';
import SubtitleVideoApp from '@/features/subtitle-video/ui/SubtitleVideoApp';

export const metadata: Metadata = {
  title: 'Video dari Subtitle — VideoKit',
  description: 'Unggah SRT, isi tiap baris dengan klip atau gambar, atur gaya teks per bahasa, render di perangkat.',
};

export default function SubtitleVideoPage() {
  return <SubtitleVideoApp />;
}
