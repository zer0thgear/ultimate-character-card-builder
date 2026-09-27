'use client';

import { clientExtensions, imageActions } from '@/lib/extensions/client';
import type { ExtensionImage } from '@/lib/extensions/types';
import { Button, IconButton } from '@/components/ui';
import { toast } from '@/store/uiStore';

// Where local extensions (lib/extensions/types.ts) appear in the app. With
// none installed, each of these renders nothing.

/** Extensions' actions on a picture: icons in a toolbar, or buttons. */
export function ExtensionImageActions({ image, variant = 'button', onDone }: { image: ExtensionImage; variant?: 'icon' | 'button' | 'chip'; onDone?: () => void }) {
  if (!imageActions.length) return null;
  const run = async (action: (typeof imageActions)[number]) => {
    try {
      await action.run(image);
      onDone?.();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <>
      {imageActions.map((a) =>
        variant === 'icon' ? (
          <IconButton key={`${a.extension}.${a.id}`} title={a.title ?? a.label} onClick={() => void run(a)}>
            {a.icon}
          </IconButton>
        ) : variant === 'chip' ? (
          <button key={`${a.extension}.${a.id}`} type="button" title={a.title} className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700" onClick={() => void run(a)}>
            {a.icon} {a.label}
          </button>
        ) : (
          <Button key={`${a.extension}.${a.id}`} title={a.title} onClick={() => void run(a)}>
            {a.icon} {a.label}
          </Button>
        ),
      )}
    </>
  );
}

/** Extensions' dialogs, mounted once (Shell). */
export function ExtensionHosts() {
  return (
    <>
      {clientExtensions.map((e) => {
        const Host = e.Host;
        return Host ? <Host key={e.id} /> : null;
      })}
    </>
  );
}

export const hasExtensionSettings = clientExtensions.some((e) => e.Settings);

/** Settings → Extensions. */
export function ExtensionSettings() {
  return (
    <div className="flex flex-col gap-5">
      {clientExtensions
        .filter((e) => e.Settings)
        .map((e) => {
          const Settings = e.Settings!;
          return (
            <section key={e.id} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{e.name}</h3>
              <Settings />
            </section>
          );
        })}
    </div>
  );
}
