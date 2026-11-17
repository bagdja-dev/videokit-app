'use client';

import { useEffect } from 'react';

/** Menandai React sudah berjalan, agar diagnostik boot tidak menampilkan kotak fallback. */
export default function HydrationMark() {
  useEffect(() => {
    (window as Window & { __vkHydrated?: boolean }).__vkHydrated = true;
  }, []);
  return null;
}
