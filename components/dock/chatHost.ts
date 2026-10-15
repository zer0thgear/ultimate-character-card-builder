'use client';

import { createContext, useContext, useMemo } from 'react';
import type { CardData } from '@/types/card';
import type { ChatMessage } from '@/types/project';
import type { ChatOwner } from '@/lib/api';
import { useProjectStore } from '@/store/projectStore';

// What the chat (components/dock/ChatPanel.tsx) is a chat with: a card, or
// (later) a group of them. The chat reads everything that depends on that
// from here: whose chats to open, the card its prompts are built from, and
// the picture beside the character's messages.

export interface ChatHost {
  /** Whose chats these are. */
  owner: ChatOwner;
  /** The card replies are written from: the card itself, for a card's chat. */
  card: CardData;
  /** The card's project, for a card's chat: its lorebook links, chat
   *  pictures and greetings opened from the editor come with it. */
  projectId?: string;
  /** The picture beside a message of the character's (none: no picture). */
  avatarUrl: (m?: Pick<ChatMessage, 'role'>) => string | null;
}

/** The open card, as a chat host (null: no card is open). */
export function useCardChatHost(): ChatHost | null {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => {
    if (!project) return null;
    const avatar = project.avatar ? `/api/projects/${project.id}/avatar?v=${project.avatar.version}` : null;
    return { owner: { kind: 'card', id: project.id }, card: project.card.data, projectId: project.id, avatarUrl: () => avatar };
  }, [project]);
}

export const ChatHostContext = createContext<ChatHost | null>(null);
export const useChatHost = () => useContext(ChatHostContext);
