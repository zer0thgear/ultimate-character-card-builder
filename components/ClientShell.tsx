'use client';

import dynamic from 'next/dynamic';

// The app renders in the browser only. Nearly everything it shows comes
// from localStorage (keys, layout, gen settings, connections) or the local
// API, none of which the server can see, so a server render would always
// disagree with the first client render (a hydration error) and gain
// nothing. layout.tsx still applies the saved theme before first paint.
export const ClientShell = dynamic(() => import('@/components/Shell').then((m) => m.Shell), {
  ssr: false,
  loading: () => <div className="h-screen" />,
});
