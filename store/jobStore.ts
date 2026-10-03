'use client';

import { create } from 'zustand';

// How many LLM requests are streaming right now, anywhere in the page (the
// chat, the assistant, Brainstorm…), for the page title's ⏳. Image gens are
// counted in the session store's `generating`.

export const useJobStore = create<{ llm: number; bump: (delta: number) => void }>((set) => ({
  llm: 0,
  bump: (delta) => set((s) => ({ llm: Math.max(0, s.llm + delta) })),
}));
