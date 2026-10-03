'use client';

import { create } from 'zustand';
import type { ChatImage, ChatMessage, ChatSession, ChatSessionSummary, ChatSummary } from '@/types/project';
import { api } from '@/lib/api';
import { uuid } from '@/lib/uuid';
import { useProjectStore } from '@/store/projectStore';
import { sumTallies, tallyChat } from '@/lib/chatStats';
import { countTextNow, textCounterLoaded } from '@/lib/textTokens';

// The open card's test chats. The greeting isn't stored as a message: the
// chat remembers which greeting opened it and reads it live from the card,
// so editing the greeting and chatting again tests the edit.

const SAVE_DELAY_MS = 600;

// A reply streaming in changes the chat with every word: its other messages'
// tokens are remembered rather than counted again each time.
const tokenMemo = new Map<string, number>();
const countMemo = (text: string) => {
  let n = tokenMemo.get(text);
  if (n === undefined) {
    if (tokenMemo.size > 5000) tokenMemo.clear();
    // The rough count while the tokenizer loads isn't kept.
    const exact = textCounterLoaded();
    n = countTextNow(text);
    if (exact) tokenMemo.set(text, n);
  }
  return n;
};

/**
 * A branch of `chat` at its message `until` (an index): the messages up to
 * and including it, each with every version (and their reasoning,
 * continues and times), the pictures among them (still to be given files of
 * their own), its greeting and pinned persona. A new id and name.
 */
export function branchOf(chat: ChatSession, until: number, id: string, now: number): ChatSession {
  const messages = structuredClone(chat.messages.slice(0, until + 1));
  const ids = new Set(messages.map((m) => m.id));
  const images = (chat.images ?? []).filter((i) => i.after === null || ids.has(i.after)).map((i) => ({ ...i }));
  // A branch of a branch is named after the chat they came from.
  const base = chat.name.replace(/ \(branch at #\d+\)$/, '');
  return {
    id,
    name: `${base} (branch at #${until + 1})`,
    greeting: chat.greeting,
    ...(chat.greetingEdits ? { greetingEdits: { ...chat.greetingEdits } } : {}),
    messages,
    ...(chat.personaId ? { personaId: chat.personaId } : {}),
    ...(images.length ? { images } : {}),
    // The summary, if it covers no more than the branch does.
    ...(chat.summary && (chat.summary.through === null || ids.has(chat.summary.through)) ? { summary: { ...chat.summary } } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

interface ChatState {
  projectId: string | null;
  list: ChatSummary[];
  chat: ChatSession | null;
  loadFor: (projectId: string) => Promise<void>;
  openChat: (id: string) => Promise<void>;
  newChat: (greeting: number) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  rename: (name: string) => void;
  setGreeting: (greeting: number) => void;
  /** This chat's own wording of greeting `index` (undefined: the card's again). */
  setGreetingEdit: (index: number, text: string | undefined) => void;
  /** Lock a persona to this chat (undefined unlocks it). */
  setPersonaLock: (personaId: string | undefined) => void;
  setMessages: (change: (m: ChatMessage[]) => ChatMessage[]) => void;
  /** The chat's summary (undefined clears it). */
  setSummary: (summary: ChatSessionSummary | undefined) => void;
  /** Adds a picture to the chat, or replaces one with the same id. */
  putImage: (image: ChatImage) => void;
  removeImage: (id: string) => void;
  /** A new chat from the open one, up to and including this message (with
   *  every version, its pictures and its pinned persona), opened. */
  branchFrom: (messageId: string) => Promise<void>;
  flush: () => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

export const useChatStore = create<ChatState>((set, get) => {
  const schedule = () => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
  };
  const updateChat = (change: (c: ChatSession) => ChatSession) => {
    const c = get().chat;
    if (!c) return;
    const next = { ...change(c), updatedAt: Date.now() };
    set((s) => ({ chat: next, list: s.list.map((x) => (x.id === next.id ? { ...x, name: next.name, updatedAt: next.updatedAt, messageCount: next.messages.length, ...tallyChat(next.messages, countMemo) } : x)) }));
    schedule();
  };

  return {
    projectId: null,
    list: [],
    chat: null,

    loadFor: async (projectId) => {
      if (get().projectId === projectId) return;
      await get().flush();
      set({ projectId, list: [], chat: null });
      const list = await api.listChats(projectId);
      if (get().projectId !== projectId) return;
      set({ list });
      if (list[0]) await get().openChat(list[0].id);
    },

    openChat: async (id) => {
      const { projectId } = get();
      if (!projectId) return;
      await get().flush();
      const chat = await api.getChat(projectId, id);
      if (get().projectId === projectId) set({ chat });
    },

    newChat: async (greeting) => {
      const { projectId } = get();
      if (!projectId) return;
      await get().flush();
      const now = Date.now();
      const chat: ChatSession = { id: uuid(), name: `Chat ${new Date(now).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`, greeting, messages: [], createdAt: now, updatedAt: now };
      const saved = await api.saveChat(projectId, chat);
      set((s) => ({ chat: saved, list: [{ id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, messageCount: 0, sent: 0, received: 0, tokens: 0 }, ...s.list] }));
    },

    deleteChat: async (id) => {
      const { projectId } = get();
      if (!projectId) return;
      if (get().chat?.id === id) {
        if (timer) clearTimeout(timer);
        dirty = false;
        set({ chat: null });
      }
      await api.deleteChat(projectId, id);
      set((s) => ({ list: s.list.filter((c) => c.id !== id) }));
    },

    rename: (name) => updateChat((c) => ({ ...c, name })),
    setGreeting: (greeting) => updateChat((c) => ({ ...c, greeting })),
    setGreetingEdit: (index, text) =>
      updateChat((c) => {
        const edits = { ...c.greetingEdits };
        if (text === undefined) delete edits[index];
        else edits[index] = text;
        const chat: ChatSession = { ...c, greetingEdits: edits };
        if (!Object.keys(edits).length) delete chat.greetingEdits;
        return chat;
      }),
    setPersonaLock: (personaId) => updateChat((c) => ({ ...c, personaId })),
    setMessages: (change) =>
      updateChat((c) => {
        const messages = change(c.messages);
        // A picture goes with the message it follows.
        const ids = new Set(messages.map((m) => m.id));
        const gone = (c.images ?? []).filter((i) => i.after !== null && !ids.has(i.after));
        const { projectId } = get();
        if (projectId) for (const i of gone) void api.deleteChatImage(projectId, i.file).catch(() => {});
        return { ...c, messages, ...(gone.length ? { images: c.images!.filter((i) => !gone.includes(i)) } : {}) };
      }),
    setSummary: (summary) =>
      updateChat((c) => {
        const chat: ChatSession = { ...c, summary };
        if (!summary) delete chat.summary;
        return chat;
      }),
    putImage: (image) => updateChat((c) => ({ ...c, images: (c.images ?? []).some((i) => i.id === image.id) ? c.images!.map((i) => (i.id === image.id ? image : i)) : [...(c.images ?? []), image] })),
    branchFrom: async (messageId) => {
      const { projectId, chat } = get();
      if (!projectId || !chat) return;
      await get().flush();
      const until = chat.messages.findIndex((m) => m.id === messageId);
      if (until < 0) return;
      const branch = branchOf(chat, until, uuid(), Date.now());
      // Pictures are filed under their chat's id (they go when it's deleted),
      // so the branch gets copies of its own.
      const images: ChatImage[] = [];
      for (const img of branch.images ?? []) {
        try {
          const blob = await (await fetch(api.chatImageUrl(projectId, img.file))).blob();
          const file = `${branch.id}-${uuid()}.png`;
          await api.putChatImage(projectId, file, blob);
          images.push({ ...img, file });
        } catch {
          /* a picture that can't be copied is left out */
        }
      }
      const saved = await api.saveChat(projectId, { ...branch, images });
      set((s) => ({ chat: saved, list: [{ id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, messageCount: saved.messages.length, ...tallyChat(saved.messages, countMemo) }, ...s.list] }));
    },
    removeImage: (id) =>
      updateChat((c) => {
        const image = c.images?.find((i) => i.id === id);
        const { projectId } = get();
        if (image && projectId) void api.deleteChatImage(projectId, image.file).catch(() => {});
        return { ...c, images: (c.images ?? []).filter((i) => i.id !== id) };
      }),

    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const { projectId, chat } = get();
      if (!dirty || !projectId || !chat) return;
      dirty = false;
      await api.saveChat(projectId, chat).catch((err) => {
        dirty = true;
        console.error('Chat save failed', err);
      });
    },
  };
});

// The card lists' chat counts follow the open card's chats.
useChatStore.subscribe((s, prev) => {
  if (s.list === prev.list || !s.projectId || s.projectId !== prev.projectId) return;
  const list = s.list;
  useProjectStore.getState().setChatStats(
    s.projectId,
    list.length ? { chats: list.length, messages: list.reduce((n, c) => n + c.messageCount, 0), lastChat: Math.max(...list.map((c) => c.updatedAt)), ...sumTallies(list) } : {},
  );
});
