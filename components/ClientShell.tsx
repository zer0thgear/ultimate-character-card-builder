'use client';

import dynamic from 'next/dynamic';

// The app renders in the browser only. What it shows comes from the local
// API and from settings it loads as it starts (lib/hydrate.ts), plus layout
// kept in this browser, so a server render would always disagree with the
// first client render (a hydration error) and gain nothing. It waits for
// those settings, so the first render already has your key, models and
// presets. layout.tsx still applies the saved theme before first paint.
export const ClientShell = dynamic(
  async () => {
    const [{ Shell }, { hydrateSettings }] = await Promise.all([import('@/components/Shell'), import('@/lib/hydrate')]);
    await hydrateSettings();
    return Shell;
  },
  {
    ssr: false,
    loading: () => <div className="h-screen" />,
  },
);
