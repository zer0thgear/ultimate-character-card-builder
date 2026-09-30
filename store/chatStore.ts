'use client';

import { create } from 'zustand';
import type { ChatImage, ChatMessage, ChatSession, ChatSummary } from '@/types/project';
import { api } from '@/lib/api';
import { uuid } from '@/lib/uuid';

// The open card's test chats. The greeting isn't stored as a message: the
// chat remembers which greeting opened it and reads it live from the card,
// so editing the greeting and chatting again tests the edit.

const SAVE_DELAY_MS = 600;

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
  /** Lock a persona to this chat (undefined unlocks it). */
  setPersonaLock: (personaId: string | undefined) => void;
  setMessages: (change: (m: ChatMessage[]) => ChatMessage[]) => void;
  /** Adds a picture to the chat, or replaces one with the same id. */
  putImage: (image: ChatImage) => void;
  removeImage: (id: string) => void;
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
    set((s) => ({ chat: next, list: s.list.map((x) => (x.id === next.id ? { ...x, name: next.name, updatedAt: next.updatedAt, messageCount: next.messages.length } : x)) }));
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
      set((s) => ({ chat: saved, list: [{ id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, messageCount: 0 }, ...s.list] }));
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
    putImage: (image) => updateChat((c) => ({ ...c, images: (c.images ?? []).some((i) => i.id === image.id) ? c.images!.map((i) => (i.id === image.id ? image : i)) : [...(c.images ?? []), image] })),
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
