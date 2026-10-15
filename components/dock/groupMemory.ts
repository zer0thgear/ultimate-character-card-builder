'use client';

import { create } from 'zustand';
import { useLlmStream } from '@/hooks/useLlmStream';
import { memberName, memoriesDue, memoryMessages, readMemory } from '@/lib/groupChat';
import { useChatStore } from '@/store/chatStore';
import { toast } from '@/store/uiStore';
import type { GroupHost } from '@/components/dock/chatHost';

// 🧠 A group chat's characters' memories (lib/groupChat.ts), brought up to
// date by the writing assistant: on their own every so many messages
// (ChatPanel), or with Update now (the group's drawer). One update at a
// time, whichever started it.

interface MemoryStatus {
  /** Whose memory is being written (null: none). */
  updating: string | null;
  stop: (() => void) | null;
}

export const useMemoryStatus = create<MemoryStatus>(() => ({ updating: null, stop: null }));

export function useGroupMemory() {
  const { runAssist, stop } = useLlmStream();

  /** Brings these members' memories of the open chat up to its last message, one after another. */
  const update = async (g: GroupHost, ids: string[], userName: string) => {
    if (useMemoryStatus.getState().updating || !ids.length) return;
    let stopped = false;
    useMemoryStatus.setState({
      stop: () => {
        stopped = true;
        stop();
      },
    });
    try {
      for (const id of ids) {
        const chat = useChatStore.getState().chat;
        const member = g.memberOf(id);
        const last = chat?.messages[chat.messages.length - 1];
        if (stopped || !chat || !last) break;
        if (!member) continue;
        const name = memberName(member.card);
        useMemoryStatus.setState({ updating: id });
        const r = await runAssist(memoryMessages(member, g.members, chat.messages, chat.memories?.[id], g.group.settings, userName), undefined, `🧠 ${name}'s memories`);
        if (stopped) break;
        if (r.error) {
          toast(`Couldn't update ${name}'s memories (${r.error}).`, 'error');
          break;
        }
        const text = readMemory(r.text);
        // A chat switched meanwhile keeps its own.
        if (text && useChatStore.getState().chat?.id === chat.id) useChatStore.getState().setMemory(id, { text, through: last.id, updatedAt: Date.now() });
      }
    } finally {
      useMemoryStatus.setState({ updating: null, stop: null });
    }
  };

  /** Updates the memories that are due, if the group keeps memories. */
  const updateIfDue = async (g: GroupHost, userName: string) => {
    const chat = useChatStore.getState().chat;
    if (!chat || !g.group.settings.memory) return;
    await update(g, memoriesDue(g.members, chat.messages, chat.memories, g.group.settings), userName);
  };

  return { update, updateIfDue };
}
