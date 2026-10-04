'use client';

import { create } from 'zustand';
import type { AdventureSession, AdventureSummary } from '@/types/adventure';
import { api } from '@/lib/api';
import { uuid } from '@/lib/uuid';

// The open card's adventures (Adventure mode, in Chat mode), saved a moment
// after each change like the chats are.

const SAVE_DELAY_MS = 600;
const VIEW_KEY = 'uccb-chat-view';

export type ChatView = 'chat' | 'adventure';

const summaryOf = (a: AdventureSession): AdventureSummary => ({ id: a.id, name: a.name, createdAt: a.createdAt, updatedAt: a.updatedAt, turns: a.entries.reduce((n, e) => Math.max(n, e.turn), 0) });

interface AdventureState {
  /** Chat mode shows the chat, or the card's adventures. */
  view: ChatView;
  setView: (v: ChatView) => void;
  projectId: string | null;
  list: AdventureSummary[];
  adventure: AdventureSession | null;
  loadFor: (projectId: string) => Promise<void>;
  open: (id: string) => Promise<void>;
  /** A new adventure, opened. */
  create: (init: Pick<AdventureSession, 'opening' | 'entries' | 'dice'> & Partial<AdventureSession>) => Promise<AdventureSession>;
  remove: (id: string) => Promise<void>;
  update: (change: (a: AdventureSession) => AdventureSession) => void;
  flush: () => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function initialView(): ChatView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'adventure' ? 'adventure' : 'chat';
  } catch {
    return 'chat';
  }
}

export const useAdventureStore = create<AdventureState>((set, get) => {
  const schedule = () => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
  };
  return {
    view: typeof window === 'undefined' ? 'chat' : initialView(),
    setView: (view) => {
      try {
        localStorage.setItem(VIEW_KEY, view);
      } catch {
        /* private mode */
      }
      set({ view });
    },
    projectId: null,
    list: [],
    adventure: null,

    loadFor: async (projectId) => {
      if (get().projectId === projectId) return;
      await get().flush();
      set({ projectId, list: [], adventure: null });
      const list = await api.listAdventures(projectId).catch(() => [] as AdventureSummary[]);
      if (get().projectId !== projectId) return;
      set({ list });
      if (list[0]) await get().open(list[0].id);
    },

    open: async (id) => {
      const { projectId } = get();
      if (!projectId) return;
      await get().flush();
      const adventure = await api.getAdventure(projectId, id);
      if (get().projectId === projectId) set({ adventure });
    },

    create: async (init) => {
      const { projectId } = get();
      if (!projectId) throw new Error('No card open.');
      await get().flush();
      const now = Date.now();
      const a: AdventureSession = { id: uuid(), name: `Adventure ${new Date(now).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`, createdAt: now, updatedAt: now, ...init };
      const saved = await api.saveAdventure(projectId, a);
      set((s) => ({ adventure: saved, list: [summaryOf(saved), ...s.list] }));
      return saved;
    },

    remove: async (id) => {
      const { projectId } = get();
      if (!projectId) return;
      if (get().adventure?.id === id) {
        if (timer) clearTimeout(timer);
        dirty = false;
        set({ adventure: null });
      }
      await api.deleteAdventure(projectId, id);
      set((s) => ({ list: s.list.filter((a) => a.id !== id) }));
    },

    update: (change) => {
      const a = get().adventure;
      if (!a) return;
      const next = { ...change(a), updatedAt: Date.now() };
      set((s) => ({ adventure: next, list: s.list.map((x) => (x.id === next.id ? summaryOf(next) : x)) }));
      schedule();
    },

    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const { projectId, adventure } = get();
      if (!dirty || !projectId || !adventure) return;
      dirty = false;
      await api.saveAdventure(projectId, adventure).catch((err) => {
        dirty = true;
        console.error('Adventure save failed', err);
      });
    },
  };
});
