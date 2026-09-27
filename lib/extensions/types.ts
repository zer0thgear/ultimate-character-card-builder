import type { ComponentType } from 'react';

// Local extensions: optional features kept in a `local/` folder that isn't
// part of the repo (for things you don't want to publish). With no such
// folder, none of this does anything.
//
//   local/client.tsx   default export: ClientExtension[]
//   local/server.ts    default export: ServerExtension[]
//
// next.config.ts, tsconfig.json and vitest.config.mts point `@local/client`
// and `@local/server` at those files when they exist, and at the empty
// ones in fallback/ when they don't.

/** A picture an extension's image action is run on. */
export interface ExtensionImage {
  /** A file name for it (e.g. for an upload). */
  name: string;
  /** Where it's shown: a gen in the Image tab, a kept gen, a library
   *  image, or the card's avatar. */
  source: 'gen' | 'kept' | 'library' | 'avatar';
  /** The PNG (fetched when it isn't in memory). */
  blob: () => Promise<Blob>;
  /** The card open at the time, if any. */
  projectId?: string;
}

/** A button beside the other actions on a picture. */
export interface ImageAction {
  id: string;
  /** Short text for a button ("Upload"). */
  label: string;
  /** An icon for toolbars with no room for the label. */
  icon: string;
  title?: string;
  run: (image: ExtensionImage) => void | Promise<void>;
}

export interface ClientExtension {
  /** Letters, digits, - and _: its settings, storage and API routes use it. */
  id: string;
  name: string;
  imageActions?: ImageAction[];
  /** Shown in Settings → Extensions. */
  Settings?: ComponentType;
  /** Mounted once with the app, for the extension's own dialogs. */
  Host?: ComponentType;
}

export interface ServerExtension {
  id: string;
  /** Answers /api/ext/<id>/<path…>. Its data can live in
   *  extensionDataDir(id) (lib/server/storage.ts), which is never committed. */
  handle: (req: Request, path: string[]) => Promise<Response>;
}
