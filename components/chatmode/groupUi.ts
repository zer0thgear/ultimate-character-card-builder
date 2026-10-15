'use client';

import { create } from 'zustand';
import type { ChatSession } from '@/types/project';

// Group chats' bits of UI state shared between the chat and Chat mode: the
// group settings drawer, and the New group dialog (components/chatmode/GroupChat.tsx).

export interface NewGroupRequest {
  /** Making it from a card's chat: that card is in it, and the chat is copied. */
  from?: { projectId: string; chat: ChatSession; name: string };
}

export const useGroupUi = create<{ drawer: boolean; setDrawer: (open: boolean) => void; making: NewGroupRequest | null; setMaking: (r: NewGroupRequest | null) => void }>((set) => ({
  drawer: false,
  setDrawer: (drawer) => set({ drawer }),
  making: null,
  setMaking: (making) => set({ making }),
}));

/** Opens the New group dialog (from a card's chat, to copy it into the group). */
export const openNewGroup = (from?: NewGroupRequest['from']) => useGroupUi.getState().setMaking({ from });