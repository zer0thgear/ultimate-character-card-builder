'use client';

import { create } from 'zustand';
import type { StorySession, StorySummary } from '@/types/project';
import { api } from '@/lib/api';
import { uuid } from '@/lib/uuid';
import { defaultPersonae, normalizeStory, storyWordCount } from '@/lib/storyPrompt';

// The open card's stories (Writing mode). Saved a moment after each change,
// as chats are. Undo and redo step through the story's text as it was
// before and after each generation (and each edit made between them).

const SAVE_DELAY_MS = 600;
const UNDO_LIMIT = 100;

interface StoryState {
  projectId: string | null;
  list: StorySummary[];
  story: StorySession | null;
  /** Earlier and later texts of the open story, for ↶ and ↷. */
  past: string[];
  future: string[];
  loadFor: (projectId: string) => Promise<void>;
  openStory: (id: string) => Promise<void>;
  newStory: (init: { text: string; memory: string; name?: string }) => Promise<void>;
  deleteStory: (id: string) => Promise<void>;
  update: (patch: Partial<StorySession>) => void;
  /** Changes the text as one step ↶ can take back (a generation, a retry). */
  commitText: (text: string, patch?: Partial<StorySession>) => void;
  undo: () => void;
  redo: () => void;
  flush: () => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

export const useStoryStore = create<StoryState>((set, get) => {
  const schedule = () => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
  };
  const apply = (patch: Partial<StorySession>, extra: Partial<StoryState> = {}) => {
    const s = get().story;
    if (!s) return;
    const next = { ...s, ...patch, updatedAt: Date.now() };
    set((st) => ({ story: next, list: st.list.map((x) => (x.id === next.id ? { ...x, name: next.name, updatedAt: next.updatedAt, words: storyWordCount(next.text) } : x)), ...extra }));
    schedule();
  };
  const summary = (s: StorySession): StorySummary => ({ id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt, words: storyWordCount(s.text) });

  return {
    projectId: null,
    list: [],
    story: null,
    past: [],
    future: [],

    loadFor: async (projectId) => {
      if (get().projectId === projectId) return;
      await get().flush();
      set({ projectId, list: [], story: null, past: [], future: [] });
      const list = await api.listStories(projectId);
      if (get().projectId !== projectId) return;
      set({ list });
      if (list[0]) await get().openStory(list[0].id);
    },

    openStory: async (id) => {
      const { projectId } = get();
      if (!projectId) return;
      await get().flush();
      const story = normalizeStory(await api.getStory(projectId, id));
      if (get().projectId === projectId) set({ story, past: [], future: [] });
    },

    newStory: async ({ text, memory, name }) => {
      const { projectId } = get();
      if (!projectId) return;
      await get().flush();
      const now = Date.now();
      const story = normalizeStory({
        id: uuid(),
        name: name ?? `Story ${new Date(now).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`,
        text,
        memory,
        personae: defaultPersonae(uuid),
        createdAt: now,
        updatedAt: now,
      });
      const saved = await api.saveStory(projectId, story);
      set((s) => ({ story: saved, past: [], future: [], list: [summary(saved), ...s.list] }));
    },

    deleteStory: async (id) => {
      const { projectId } = get();
      if (!projectId) return;
      if (get().story?.id === id) {
        if (timer) clearTimeout(timer);
        dirty = false;
        set({ story: null, past: [], future: [] });
      }
      await api.deleteStory(projectId, id);
      set((s) => ({ list: s.list.filter((x) => x.id !== id) }));
      // The next one opens in its place.
      const next = get().list[0];
      if (!get().story && next) await get().openStory(next.id);
    },

    update: (patch) => apply(patch),

    commitText: (text, patch = {}) => {
      const s = get().story;
      if (!s) return;
      apply({ ...patch, text }, s.text === text ? {} : { past: [...get().past, s.text].slice(-UNDO_LIMIT), future: [] });
    },

    undo: () => {
      const { story, past, future } = get();
      if (!story || !past.length) return;
      apply({ text: past[past.length - 1] }, { past: past.slice(0, -1), future: [story.text, ...future] });
    },

    redo: () => {
      const { story, past, future } = get();
      if (!story || !future.length) return;
      apply({ text: future[0] }, { past: [...past, story.text], future: future.slice(1) });
    },

    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const { projectId, story } = get();
      if (!dirty || !projectId || !story) return;
      dirty = false;
      await api.saveStory(projectId, story).catch((err) => {
        dirty = true;
        console.error('Story save failed', err);
      });
    },
  };
});
