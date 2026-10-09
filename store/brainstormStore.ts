'use client';

import { create } from 'zustand';
import type { BrainstormSession, BrainstormSummary, BrainstormThought } from '@/types/project';
import { api } from '@/lib/api';
import { uuid } from '@/lib/uuid';

// The open card's Brainstorm sessions, saved a moment after each change, as
// chats are: they're kept with the card, to come back to.

const SAVE_DELAY_MS = 600;

interface BrainstormState {
  projectId: string | null;
  list: BrainstormSummary[];
  session: BrainstormSession | null;
  loadFor: (projectId: string) => Promise<void>;
  open: (id: string) => Promise<void>;
  /** A new, empty session, opened (the one before stays saved). */
  start: () => void;
  rename: (name: string) => void;
  remove: (id: string) => Promise<void>;
  /** Changes the open session's messages, starting one if none is open. */
  setMessages: (messages: BrainstormThought[]) => void;
  flush: () => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

/** A session's name to start with: its first message, shortened. */
export function sessionName(messages: BrainstormThought[], at: number): string {
  const first = messages.find((m) => m.role === 'user')?.content.replace(/\s+/g, ' ').trim();
  if (first) return first.length > 48 ? `${first.slice(0, 47).trimEnd()}…` : first;
  return `Brainstorm ${new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`;
}

export const useBrainstormStore = create<BrainstormState>((set, get) => {
  const schedule = () => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
  };
  const summary = (s: BrainstormSession): BrainstormSummary => ({ id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messages.length });
  const put = (next: BrainstormSession) => {
    set((st) => ({ session: next, list: [summary(next), ...st.list.filter((x) => x.id !== next.id)] }));
    schedule();
  };

  return {
    projectId: null,
    list: [],
    session: null,

    loadFor: async (projectId) => {
      if (get().projectId === projectId) return;
      await get().flush();
      set({ projectId, list: [], session: null });
      const list = await api.listBrainstorms(projectId).catch(() => []);
      if (get().projectId !== projectId) return;
      set({ list });
      if (list[0]) await get().open(list[0].id);
    },

    open: async (id) => {
      const { projectId } = get();
      if (!projectId) return;
      await get().flush();
      const session = await api.getBrainstorm(projectId, id);
      if (get().projectId === projectId) set({ session });
    },

    start: () => {
      void get().flush();
      set({ session: null });
    },

    rename: (name) => {
      const s = get().session;
      if (s) put({ ...s, name: name.trim() || s.name, updatedAt: Date.now() });
    },

    remove: async (id) => {
      const { projectId } = get();
      if (!projectId) return;
      if (get().session?.id === id) {
        if (timer) clearTimeout(timer);
        dirty = false;
        set({ session: null });
      }
      await api.deleteBrainstorm(projectId, id);
      set((s) => ({ list: s.list.filter((x) => x.id !== id) }));
    },

    setMessages: (messages) => {
      const now = Date.now();
      const s = get().session;
      // The first message starts a session, named after it.
      put(s ? { ...s, messages, updatedAt: now } : { id: uuid(), name: sessionName(messages, now), messages, createdAt: now, updatedAt: now });
    },

    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const { projectId, session } = get();
      if (!dirty || !projectId || !session) return;
      dirty = false;
      await api.saveBrainstorm(projectId, session).catch((err) => {
        dirty = true;
        console.error('Brainstorm save failed', err);
      });
    },
  };
});
