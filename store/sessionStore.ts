'use client';

import { create } from 'zustand';
import type { GeneratedImage } from '@/types/novelai';
import { writeSection } from '@/lib/serverSettings';
import { api } from '@/lib/api';
import { recentPatch, toRecentMeta } from '@/lib/recentGens';

// Recent gens. Each is sent to UCCB's server as it arrives (data/recent-gens,
// cleaned up after Settings → Folders' number of days), so a closed,
// reloaded or frozen tab doesn't lose it and every device sees the same
// ones. Gens made in this page keep their image in memory; ones loaded
// from the server fetch it when something needs it (imageBlob). Also holds
// the NovelAI key (saved on the server; see lib/serverSettings.ts).

export interface SessionImage extends Omit<GeneratedImage, 'blob'> {
  /** The PNG, when it's in memory: gens made in this page, or ones fetched
   *  since. Use imageBlob() to get it either way. */
  blob?: Blob;
  /** On the server (so it survives the page). */
  stored?: boolean;
  /** The card that was open when it was made. */
  projectId?: string;
  /** Where "Save to folder" put it, once saved. */
  savedPath?: string;
  /** Set once kept with a card. */
  keptFile?: string;
}

interface SessionState {
  apiKey: string;
  setApiKey: (key: string) => void;
  /** Sets the key as loaded from the server, without saving it back. */
  loadApiKey: (key: string) => void;
  images: SessionImage[];
  addImages: (images: SessionImage[]) => void;
  updateImages: (ids: string[], patch: Partial<SessionImage>) => void;
  removeImages: (ids: string[]) => void;
  /** Clears everything except pinned images. */
  clearSession: () => void;
  /** Brings in the server's recent gens: new ones from other devices or
   *  earlier visits, and drops ones cleared or expired there. */
  syncStored: () => Promise<void>;
  selectedId: string | null;
  select: (id: string | null) => void;
  generating: number;
  setGenerating: (delta: number) => void;
  streamPreview: string | null;
  setStreamPreview: (url: string | null) => void;
  retryNotice: string | null;
  setRetryNotice: (notice: string | null) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  apiKey: '',
  setApiKey: (key) => {
    writeSection('naiKey', key);
    set({ apiKey: key });
  },
  loadApiKey: (key) => set({ apiKey: key }),

  images: [],
  addImages: (images) => {
    set((s) => ({ images: [...images, ...s.images], selectedId: images[0]?.id ?? s.selectedId }));
    for (const img of images) void store(img);
  },
  updateImages: (ids, patch) => {
    set((s) => ({ images: s.images.map((i) => (ids.includes(i.id) ? { ...i, ...patch } : i)) }));
    const server = recentPatch(patch);
    if (server) for (const id of ids) if (get().images.find((i) => i.id === id)?.stored) void api.patchRecentGen(id, server).catch(() => {});
  },
  removeImages: (ids) => {
    set((s) => {
      for (const i of s.images) if (ids.includes(i.id)) revoke(i);
      return { images: s.images.filter((i) => !ids.includes(i.id)), selectedId: s.selectedId && ids.includes(s.selectedId) ? null : s.selectedId };
    });
    void api.deleteRecentGens(ids).catch(() => {});
  },
  clearSession: () => {
    const gone = get().images.filter((i) => !i.pinned);
    set((s) => {
      for (const i of gone) revoke(i);
      const images = s.images.filter((i) => i.pinned);
      return { images, selectedId: images.some((i) => i.id === s.selectedId) ? s.selectedId : null };
    });
    if (gone.length) void api.deleteRecentGens(gone.map((i) => i.id)).catch(() => {});
  },
  syncStored: async () => {
    let list: Record<string, unknown>[];
    try {
      list = await api.recentGens();
    } catch {
      return; // offline: what's here stays
    }
    const onServer = new Set(list.map((m) => m.id as string));
    set((s) => {
      const have = new Set(s.images.map((i) => i.id));
      const fresh: SessionImage[] = list.filter((m) => !have.has(m.id as string)).map((m) => ({ ...(m as unknown as SessionImage), url: api.recentGenUrl(m.id as string), blob: undefined, stored: true }));
      // Stored ones the server no longer has were cleared or expired
      // elsewhere; ones still uploading stay.
      const kept = s.images.filter((i) => !i.stored || onServer.has(i.id));
      for (const i of s.images) if (!kept.includes(i)) revoke(i);
      const images = [...kept, ...fresh].sort((a, b) => b.timestamp - a.timestamp);
      return { images, selectedId: s.selectedId && images.some((i) => i.id === s.selectedId) ? s.selectedId : null };
    });
  },

  selectedId: null,
  select: (id) => set({ selectedId: id }),
  generating: 0,
  setGenerating: (delta) => set((s) => ({ generating: Math.max(0, s.generating + delta) })),
  streamPreview: null,
  setStreamPreview: (url) =>
    set((s) => {
      if (s.streamPreview && s.streamPreview !== url) URL.revokeObjectURL(s.streamPreview);
      return { streamPreview: url };
    }),
  retryNotice: null,
  setRetryNotice: (notice) => set({ retryNotice: notice }),
}));

/** Frees a gen's object URLs (server URLs need nothing). */
function revoke(img: SessionImage) {
  if (img.url.startsWith('blob:')) URL.revokeObjectURL(img.url);
}

/** Sends a new gen to the server, then anything that changed meanwhile
 *  (saved or kept while it was uploading). */
async function store(img: SessionImage) {
  if (!img.blob || img.stored) return;
  const sent = toRecentMeta(img);
  try {
    await api.addRecentGen(img.blob, sent);
  } catch {
    return; // stays in memory only, and the page warns before closing
  }
  const now = useSessionStore.getState().images.find((i) => i.id === img.id);
  if (!now) return void api.deleteRecentGens([img.id]).catch(() => {}); // removed while uploading
  useSessionStore.setState((s) => ({ images: s.images.map((i) => (i.id === img.id ? { ...i, stored: true } : i)) }));
  const changed = recentPatch(Object.fromEntries(Object.entries(toRecentMeta(now)).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(sent[k]))));
  if (changed) void api.patchRecentGen(img.id, changed).catch(() => {});
}

const fetching = new Map<string, Promise<Blob>>();

/** A gen's PNG: from memory, or fetched from the server once and kept. */
export async function imageBlob(img: SessionImage): Promise<Blob> {
  if (img.blob) return img.blob;
  const current = useSessionStore.getState().images.find((i) => i.id === img.id);
  if (current?.blob) return current.blob;
  let p = fetching.get(img.id);
  if (!p) {
    p = fetch(img.url).then((r) => {
      if (!r.ok) throw new Error("This gen is gone from the server (cleared, or past its days).");
      return r.blob();
    });
    fetching.set(img.id, p);
    p.catch(() => {}).finally(() => fetching.delete(img.id));
  }
  const blob = await p;
  useSessionStore.setState((s) => ({ images: s.images.map((i) => (i.id === img.id ? { ...i, blob } : i)) }));
  return blob;
}

// Gens are on the server once they've uploaded: only warn before the page
// closes about ones that haven't (yet), and that weren't kept or saved.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (useSessionStore.getState().images.some((i) => !i.stored && !i.keptFile && !i.savedPath)) e.preventDefault();
  });
}
