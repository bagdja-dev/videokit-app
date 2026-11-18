import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import { BOOT_DIAG } from '@/components/boot-diagnostics';
import AppHeader from '@/components/AppHeader';
import HydrationMark from '@/components/HydrationMark';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bagdja VideoKit',
  description: 'Kumpulan tool pembuat video untuk konten marketing.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#006666' },
    { media: '(prefers-color-scheme: dark)', color: '#101417' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: sebagian browser (mis. browser Huawei) menyisipkan atribut sendiri ke
    // <html>/<body> sebelum React jalan. Hanya mengabaikan atribut elemen ini, bukan isi halaman.
    <html lang="id" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Script id="vk-boot-diag" strategy="beforeInteractive">{BOOT_DIAG}</Script>
        <HydrationMark />
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
