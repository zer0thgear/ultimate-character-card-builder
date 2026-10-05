'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { newSession, type WizardSession } from '@/lib/loreWizard';

// The lorebook wizard's sessions, one per card, and the connections its
// Planner and Writer use; kept in this browser until you save the entries
// to the card or start over.

interface LoreWizardState {
  sessions: Record<string, WizardSession>;
  /** Replaces a card's session (or changes it, given a function). */
  setSession: (cardId: string, next: WizardSession | ((s: WizardSession) => WizardSession)) => void;
  clear: (cardId: string) => void;
  /** Their own connections, or null for the writing assistant's. */
  plannerConnectionId: string | null;
  writerConnectionId: string | null;
  setConnection: (role: 'planner' | 'writer', id: string | null) => void;
  /** Whether the Writer writes what your message changed right away. */
  autoWrite: boolean;
  setAutoWrite: (on: boolean) => void;
}

export const useLoreWizardStore = create<LoreWizardState>()(
  persist(
    (set) => ({
      sessions: {},
      setSession: (cardId, next) =>
        set((s) => ({ sessions: { ...s.sessions, [cardId]: typeof next === 'function' ? next(s.sessions[cardId] ?? newSession()) : next } })),
      clear: (cardId) =>
        set((s) => {
          const sessions = { ...s.sessions };
          delete sessions[cardId];
          return { sessions };
        }),
      plannerConnectionId: null,
      writerConnectionId: null,
      setConnection: (role, id) => set(role === 'planner' ? { plannerConnectionId: id } : { writerConnectionId: id }),
      autoWrite: true,
      setAutoWrite: (autoWrite) => set({ autoWrite }),
    }),
    { name: 'uccb-lore-wizard', storage: createJSONStorage(() => localStorage) },
  ),
);
