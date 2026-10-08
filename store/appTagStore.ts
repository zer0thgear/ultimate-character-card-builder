'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';
import { uuid } from '@/lib/uuid';
import { EMPTY_TAG_DATA, addTagsToCard, copyCardTags, findTag, newTag, removeTag, setTagOnCards, type AppTag, type AppTagData } from '@/lib/appTags';

// Your app tags (lib/appTags.ts): SillyTavern's tags, kept by UCCB rather
// than in the cards. Saved on the local server (data/tags.json) a moment
// after each change.

const SAVE_DELAY_MS = 500;
let timer: ReturnType<typeof setTimeout> | null = null;
let loading: Promise<void> | null = null;

interface AppTagState extends AppTagData {
  loaded: boolean;
  load: () => Promise<void>;
  /** Saves now, if a save is waiting. */
  flush: () => Promise<void>;
  /** Makes a tag (or finds the one by that name). */
  create: (name: string) => AppTag | null;
  update: (id: string, patch: Partial<Omit<AppTag, 'id'>>) => void;
  remove: (id: string) => void;
  /** Puts the tags in this order. */
  reorder: (ids: string[]) => void;
  /** Gives the card these tags (by name; new names make new tags). */
  addToCard: (cardId: string, names: string[], onlyExisting?: boolean) => void;
  setCardTags: (cardId: string, ids: string[]) => void;
  /** Puts a tag on all these cards, or takes it off them all. */
  setTagOnCards: (cardIds: string[], tagId: string, on: boolean) => void;
  copyCard: (from: string, to: string) => void;
  setOptions: (patch: Partial<Pick<AppTagData, 'folders' | 'importMode'>>) => void;
  /** Replaces everything (a backup merged in). */
  replace: (data: AppTagData) => void;
}

const dataOf = (s: AppTagData): AppTagData => ({ tags: s.tags, map: s.map, folders: s.folders, importMode: s.importMode });

export const useAppTagStore = create<AppTagState>((set, get) => {
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void api.saveAppTags(dataOf(get())).catch(() => {});
    }, SAVE_DELAY_MS);
  };
  const change = (next: (s: AppTagData) => AppTagData) => {
    set((s) => next(dataOf(s)));
    save();
  };
  return {
    ...EMPTY_TAG_DATA,
    loaded: false,
    load: () => {
      loading ??= api
        .getAppTags()
        .then((d) => set({ ...d, loaded: true }))
        .catch(() => set({ loaded: true }))
        .finally(() => {
          loading = null;
        });
      return loading;
    },
    flush: async () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      await api.saveAppTags(dataOf(get()));
    },
    create: (name) => {
      const n = name.trim();
      if (!n) return null;
      const found = findTag(get().tags, n);
      if (found) return found;
      const tag = newTag(n, get().tags, uuid());
      change((s) => ({ ...s, tags: [...s.tags, tag] }));
      return tag;
    },
    update: (id, patch) => change((s) => ({ ...s, tags: s.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
    remove: (id) => change((s) => removeTag(s, id)),
    reorder: (ids) => change((s) => ({ ...s, tags: s.tags.map((t) => ({ ...t, order: ids.indexOf(t.id) < 0 ? ids.length : ids.indexOf(t.id) })) })),
    addToCard: (cardId, names, onlyExisting) => change((s) => addTagsToCard(s, cardId, names, uuid, onlyExisting)),
    setCardTags: (cardId, ids) =>
      change((s) => {
        const map = { ...s.map };
        if (ids.length) map[cardId] = [...new Set(ids)];
        else delete map[cardId];
        return { ...s, map };
      }),
    setTagOnCards: (cardIds, tagId, on) => change((s) => setTagOnCards(s, cardIds, tagId, on)),
    copyCard: (from, to) => change((s) => copyCardTags(s, from, to)),
    setOptions: (patch) => change((s) => ({ ...s, ...patch })),
    replace: (data) => change(() => dataOf(data)),
  };
});

/** Loads the tags once (a card list showing calls it). */
export function ensureAppTags() {
  if (!useAppTagStore.getState().loaded) void useAppTagStore.getState().load();
}
