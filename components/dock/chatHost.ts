'use client';

import { createContext, useContext, useMemo } from 'react';
import type { CardData } from '@/types/card';
import type { ChatMessage, GroupProject } from '@/types/project';
import { api, type ChatOwner } from '@/lib/api';
import { newCard } from '@/lib/cardSpec';
import { uuid } from '@/lib/uuid';
import { groupGreetings, groupMembers, groupTurn, nextSpeaker, type GroupTurn, type Member, type TurnExtras } from '@/lib/groupChat';
import { useProjectStore } from '@/store/projectStore';
import { useGroupStore } from '@/store/groupStore';

// What the chat (components/dock/ChatPanel.tsx) is a chat with: a card, or
// a group of them. The chat reads everything that depends on that from
// here: whose chats to open, the card its prompts are built from (a
// group's, built for each reply's speaker; lib/groupChat.ts), and the
// pictures beside the characters' messages.

/** A group chat's side of the host. */
export interface GroupHost {
  group: GroupProject;
  /** Its members with their cards (a member whose card is gone is left out). */
  members: Member[];
  memberOf: (id: string | undefined) => Member | undefined;
  /** The card and note for `speakerId`'s reply after `history` (with the chat's presence marks and memories). */
  turn: (speakerId: string, history: ChatMessage[], extras?: TurnExtras) => GroupTurn;
  /** Who replies next by the group's order (null: you pick). */
  next: (history: ChatMessage[]) => string | null;
  /** A new chat's opening messages: the members' greetings. */
  greetings: () => ChatMessage[];
}

export interface ChatHost {
  /** Whose chats these are. */
  owner: ChatOwner;
  /** The card replies are written from: the card itself, for a card's
   *  chat; for a group's, a stand-in named after the group (each reply is
   *  written from the card group.turn builds). */
  card: CardData;
  /** The card's project, for a card's chat: its lorebook links, chat
   *  pictures and greetings opened from the editor come with it. */
  projectId?: string;
  /** The picture beside a message of a character's (none: no picture). */
  avatarUrl: (m?: Pick<ChatMessage, 'role' | 'speaker'>) => string | null;
  group?: GroupHost;
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

/** The open group, as a chat host (null: no group is open). */
export function useGroupChatHost(): ChatHost | null {
  const group = useGroupStore((s) => s.group);
  const projects = useGroupStore((s) => s.members);
  return useMemo(() => {
    if (!group) return null;
    const members = groupMembers(group, new Map(Object.entries(projects).map(([id, p]) => [id, p.card.data])));
    const byId = new Map(members.map((m) => [m.id, m]));
    const card: CardData = { ...newCard().data, name: group.name };
    const g: GroupHost = {
      group,
      members,
      memberOf: (id) => (id ? byId.get(id) : undefined),
      turn: (speakerId, history, extras) => groupTurn(group, members, speakerId, history, extras),
      next: (history) => nextSpeaker(members, history, group.settings),
      greetings: () => groupGreetings(members, group.settings, (m, text) => ({ id: uuid(), role: 'assistant', speaker: m.id, swipes: [text], swipe: 0, createdAt: Date.now() })),
    };
    return {
      owner: { kind: 'group', id: group.id },
      card,
      avatarUrl: (m) => {
        const p = m?.speaker ? projects[m.speaker] : undefined;
        return p ? api.avatarUrl(p.id, p.avatar) : null;
      },
      group: g,
    };
  }, [group, projects]);
}

export const ChatHostContext = createContext<ChatHost | null>(null);
export const useChatHost = () => useContext(ChatHostContext);
