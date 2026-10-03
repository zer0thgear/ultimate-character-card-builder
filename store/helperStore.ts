'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { LlmMessage } from '@/types/llm';

// The home screen's helper (components/HelpDesk.tsx): its voice, its
// connection and the conversation, kept in this browser.

/** The most messages kept between visits. */
const KEEP = 60;

interface HelperState {
  personality: string;
  setPersonality: (id: string) => void;
  /** The "Your own" personality's description. */
  custom: string;
  setCustom: (text: string) => void;
  /** Its own LLM connection, or null for the writing assistant's. */
  connectionId: string | null;
  setConnectionId: (id: string | null) => void;
  messages: LlmMessage[];
  setMessages: (m: LlmMessage[]) => void;
}

export const useHelperStore = create<HelperState>()(
  persist(
    (set) => ({
      personality: 'plain',
      setPersonality: (personality) => set({ personality }),
      custom: '',
      setCustom: (custom) => set({ custom }),
      connectionId: null,
      setConnectionId: (connectionId) => set({ connectionId }),
      messages: [],
      setMessages: (messages) => set({ messages: messages.slice(-KEEP) }),
    }),
    { name: 'uccb-helper', storage: createJSONStorage(() => localStorage) },
  ),
);
