'use client';

import { create } from 'zustand';
import type { BankLorebook } from '@/types/project';
import type { CardData, Lorebook } from '@/types/card';
import { api } from '@/lib/api';
import { cardLoreName, copyFromCard, newBankLorebook } from '@/lib/lorebookBank';
import { useLlmStore } from '@/store/llmStore';
import { usePersonaStore } from '@/store/personaStore';

// The Lorebooks bank (lib/lorebookBank.ts), kept on the local server
// (data/lorebooks/, one file per book). Every book is loaded whole: chats
// read them to build the prompt.

const SAVE_DELAY_MS = 500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

interface LorebookState {
  books: BankLorebook[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Adds a book to the bank and saves it now. */
  add: (book: Lorebook, init?: Partial<Omit<BankLorebook, 'book'>>) => Promise<BankLorebook>;
  /** Changes a book's lorebook (saved shortly after). */
  setBook: (id: string, book: Lorebook) => void;
  /** Saves any change still waiting. */
  flush: (id?: string) => Promise<void>;
  /** Deletes a book, and takes it off global lorebooks and personas. */
  remove: (id: string) => Promise<void>;
  /**
   * Puts a card's lorebook in the bank: over the copy made from this card
   * before, if there is one, else as a new book. SillyTavern does the same
   * (it overwrites the world of that name).
   */
  importFromCard: (projectId: string, card: CardData) => Promise<BankLorebook | null>;
}

export const useLorebookStore = create<LorebookState>((set, get) => {
  const saveNow = async (id: string) => {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    const b = get().books.find((x) => x.id === id);
    if (b) await api.saveLorebook(b);
  };
  return {
    books: [],
    loaded: false,
    load: async () => set({ books: await api.listLorebooks(), loaded: true }),
    add: async (book, init = {}) => {
      const saved = await api.createLorebook(newBankLorebook(book, init));
      set((s) => ({ books: [...s.books, saved] }));
      return saved;
    },
    setBook: (id, book) => {
      set((s) => ({ books: s.books.map((b) => (b.id === id ? { ...b, book, updatedAt: Date.now() } : b)) }));
      const t = timers.get(id);
      if (t) clearTimeout(t);
      timers.set(id, setTimeout(() => void saveNow(id), SAVE_DELAY_MS));
    },
    flush: async (id) => {
      await Promise.all((id ? [id] : [...timers.keys()]).filter((k) => timers.has(k)).map(saveNow));
    },
    remove: async (id) => {
      const t = timers.get(id);
      if (t) clearTimeout(t);
      timers.delete(id);
      await api.deleteLorebook(id);
      set((s) => ({ books: s.books.filter((b) => b.id !== id) }));
      const llm = useLlmStore.getState();
      const global = llm.chatSettings.globalLorebooks ?? [];
      if (global.includes(id)) llm.setChatSettings({ globalLorebooks: global.filter((g) => g !== id) });
      const personas = usePersonaStore.getState();
      for (const p of personas.personas) if (p.lorebookId === id) personas.update(p.id, { lorebookId: undefined });
    },
    importFromCard: async (projectId, card) => {
      const book = card.character_book;
      if (!book) return null;
      const copy = structuredClone({ ...book, name: cardLoreName(card) });
      const fromCard = { projectId, name: card.name || 'Unnamed' };
      const existing = copyFromCard(get().books, projectId);
      if (!existing) return get().add(copy, { fromCard });
      const next = { ...existing, book: copy, fromCard, updatedAt: Date.now() };
      set((s) => ({ books: s.books.map((b) => (b.id === existing.id ? next : b)) }));
      await saveNow(existing.id);
      return next;
    },
  };
});

/** The bank, loaded once on first use. */
export function ensureLorebooks() {
  const s = useLorebookStore.getState();
  if (!s.loaded) void s.load().catch(() => {});
}
