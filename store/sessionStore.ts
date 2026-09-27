'use client';

import { create } from 'zustand';
import type { GeneratedImage } from '@/types/novelai';
import { writeSection } from '@/lib/serverSettings';

// This session's gens, kept in memory as NovelFrontEnd keeps them: they go
// when the page closes unless they're kept with a card or saved to the
// output folder. Also holds the NovelAI key (saved on the server, shared by
// every device; see lib/serverSettings.ts).


export interface SessionImage extends GeneratedImage {
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
  selectedId: string | null;
  select: (id: string | null) => void;
  generating: number;
  setGenerating: (delta: number) => void;
  streamPreview: string | null;
  setStreamPreview: (url: string | null) => void;
  retryNotice: string | null;
  setRetryNotice: (notice: string | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  apiKey: '',
  setApiKey: (key) => {
    writeSection('naiKey', key);
    set({ apiKey: key });
  },
  loadApiKey: (key) => set({ apiKey: key }),

  images: [],
  addImages: (images) => set((s) => ({ images: [...images, ...s.images], selectedId: images[0]?.id ?? s.selectedId })),
  updateImages: (ids, patch) => set((s) => ({ images: s.images.map((i) => (ids.includes(i.id) ? { ...i, ...patch } : i)) })),
  removeImages: (ids) =>
    set((s) => {
      for (const i of s.images) if (ids.includes(i.id)) URL.revokeObjectURL(i.url);
      return { images: s.images.filter((i) => !ids.includes(i.id)), selectedId: s.selectedId && ids.includes(s.selectedId) ? null : s.selectedId };
    }),
  clearSession: () =>
    set((s) => {
      for (const i of s.images) if (!i.pinned) URL.revokeObjectURL(i.url);
      const images = s.images.filter((i) => i.pinned);
      return { images, selectedId: images.some((i) => i.id === s.selectedId) ? s.selectedId : null };
    }),

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

// Like NovelAI's site, session gens live in memory: warn before the page
// closes with some that were never kept or saved.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (useSessionStore.getState().images.some((i) => !i.keptFile && !i.savedPath)) e.preventDefault();
  });
}
