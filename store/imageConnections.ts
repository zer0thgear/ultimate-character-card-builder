'use client';

import { create } from 'zustand';
import { useSettingsStore } from '@/store/settingsStore';
import { useSessionStore } from '@/store/sessionStore';
import type { BackendOptions, ImageBackendKind, ImageConnection } from '@/types/imageBackend';
import { newImageConnection } from '@/lib/imageBackends';
import { setArtBackend } from '@/lib/assist';

// The image connections, kept with the generator's settings (so on the
// server, shared by every device), and what each server offers.

const settings = () => useSettingsStore.getState();

export function addImageConnection(kind: ImageBackendKind): ImageConnection {
  const c = newImageConnection(kind);
  const { imageConnections, imageConnectionId, patch } = settings();
  patch({ imageConnections: [...imageConnections, c], imageConnectionId: imageConnectionId ?? c.id });
  return c;
}

export function updateImageConnection(id: string, change: Partial<ImageConnection>) {
  const { imageConnections, set } = settings();
  set('imageConnections', imageConnections.map((c) => (c.id === id ? { ...c, ...change } : c)));
}

export function removeImageConnection(id: string) {
  const { imageConnections, imageConnectionId, patch } = settings();
  const rest = imageConnections.filter((c) => c.id !== id);
  patch({ imageConnections: rest, imageConnectionId: imageConnectionId === id ? (rest[0]?.id ?? null) : imageConnectionId });
}

export const selectImageConnection = (id: string) => settings().set('imageConnectionId', id);

/** The connection gens go to, or null (the generator is locked). */
export function useActiveImageConnection(): ImageConnection | null {
  return useSettingsStore((s) => s.imageConnections.find((c) => c.id === s.imageConnectionId) ?? s.imageConnections[0] ?? null);
}
export const activeImageConnection = () => {
  const s = settings();
  return s.imageConnections.find((c) => c.id === s.imageConnectionId) ?? s.imageConnections[0] ?? null;
};

/** Before image connections, NovelAI was the only backend, set up by its key:
 *  a key and no connections yet becomes a NovelAI connection, once. */
export function migrateImageConnections() {
  const s = settings();
  if (s.imageConnectionsMigrated) return;
  if (!s.imageConnections.length && useSessionStore.getState().apiKey) {
    const c = newImageConnection('novelai');
    s.patch({ imageConnections: [c], imageConnectionId: c.id, imageConnectionsMigrated: true });
  } else s.set('imageConnectionsMigrated', true);
}

// ─── What each server offers (fetched when needed, kept for the visit) ───────

export const useBackendOptions = create<{ byId: Record<string, BackendOptions | { error: string } | 'loading'> }>(() => ({ byId: {} }));

export async function loadBackendOptions(c: ImageConnection, force = false): Promise<BackendOptions> {
  const cur = useBackendOptions.getState().byId[c.id];
  if (!force && cur && cur !== 'loading' && !('error' in cur)) return cur;
  useBackendOptions.setState((s) => ({ byId: { ...s.byId, [c.id]: 'loading' } }));
  try {
    const res = await fetch('/api/image/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connection: c }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    useBackendOptions.setState((s) => ({ byId: { ...s.byId, [c.id]: body } }));
    return body as BackendOptions;
  } catch (err) {
    const error = (err as Error).message;
    useBackendOptions.setState((s) => ({ byId: { ...s.byId, [c.id]: { error } } }));
    throw err;
  }
}

// The ✨ art writers' tag rules follow where gens are made.
const syncArtBackend = () => setArtBackend((activeImageConnection()?.kind ?? 'novelai') === 'novelai' ? 'novelai' : 'sd');
syncArtBackend();
useSettingsStore.subscribe(syncArtBackend);
