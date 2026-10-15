'use client';

import { create } from 'zustand';
import type { AuthorsNote, ChatImage, ChatMessage, ChatSession, ChatSessionSummary, ChatSummary } from '@/types/project';
import { chatApi, ownerKey, type ChatOwner } from '@/lib/api';
import { uuid } from '@/lib/uuid';
import { useProjectStore } from '@/store/projectStore';
import { sumTallies, tallyChat } from '@/lib/chatStats';
import { countTextNow, textCounterLoaded } from '@/lib/textTokens';

// The open card's (or group's) chats. The greeting isn't stored as a message: the
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
 * their own), its greeting, pinned persona and author's note. A new id
 * and name.
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
    ...(chat.authorsNote ? { authorsNote: { ...chat.authorsNote } } : {}),
    ...(images.length ? { images } : {}),
    // The summary, if it covers no more than the branch does.
    ...(chat.summary && (chat.summary.through === null || ids.has(chat.summary.through)) ? { summary: { ...chat.summary } } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

interface ChatState {
  /** Whose chats these are: a card's, or a group's. */
  owner: ChatOwner | null;
  /** The card's project, when the owner is a card (the card lists' chat counts follow it). */
  projectId: string | null;
  list: ChatSummary[];
  chat: ChatSession | null;
  /** A card's chats (by its project id), or owner's. */
  loadFor: (owner: ChatOwner | string) => Promise<void>;
  openChat: (id: string) => Promise<void>;
  /** A new chat opened by greeting greeting (-1: none), starting with messages (a group's greetings). */
  newChat: (greeting: number, messages?: ChatMessage[]) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  rename: (name: string) => void;
  setGreeting: (greeting: number) => void;
  /** This chat's own wording of greeting `index` (undefined: the card's again). */
  setGreetingEdit: (index: number, text: string | undefined) => void;
  /** Lock a persona to this chat (undefined unlocks it). */
  setPersonaLock: (personaId: string | undefined) => void;
  /** This chat's own lorebook from the bank (undefined: none). */
  setChatLorebook: (lorebookId: string | undefined) => void;
  /** This chat's author's note (undefined removes it). */
  setAuthorsNote: (note: AuthorsNote | undefined) => void;
  setMessages: (change: (m: ChatMessage[]) => ChatMessage[]) => void;
  /** The chat's summary (undefined clears it). */
  setSummary: (summary: ChatSessionSummary | undefined) => void;
  /** The chat's variables (empty clears them). */
  setVars: (vars: Record<string, unknown>) => void;
  /** A group member marked in or out of the scene (undefined: by what they do). */
  setPresence: (memberId: string, value: 'in' | 'out' | undefined) => void;
  /** Adds a picture to the chat, or replaces one with the same id. */
  putImage: (image: ChatImage) => void;
  removeImage: (id: string) => void;
  /** A new chat from the open one, up to and including this message (with
   *  every version, its pictures and its pinned persona), opened. */
  branchFrom: (messageId: string) => Promise<void>;
  /** Saves a chat brought in from a file (lib/chatImport.ts) and opens it. */
  importChat: (chat: ChatSession) => Promise<void>;
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

  /** The open owner's chats on the server. */
  const store = () => {
    const { owner } = get();
    return owner ? chatApi(owner) : null;
  };

  return {
    owner: null,
    projectId: null,
    list: [],
    chat: null,

    loadFor: async (who) => {
      const owner: ChatOwner = typeof who === 'string' ? { kind: 'card', id: who } : who;
      const key = ownerKey(owner);
      const current = get().owner;
      if (current && ownerKey(current) === key) return;
      await get().flush();
      set({ owner, projectId: owner.kind === 'card' ? owner.id : null, list: [], chat: null });
      const list = await chatApi(owner).list();
      const now = get().owner;
      if (!now || ownerKey(now) !== key) return;
      set({ list });
      if (list[0]) await get().openChat(list[0].id);
    },

    openChat: async (id) => {
      const { owner } = get();
      const s = store();
      if (!s) return;
      await get().flush();
      const chat = await s.get(id);
      if (get().owner === owner) set({ chat });
    },

    newChat: async (greeting, messages = []) => {
      const s = store();
      if (!s) return;
      await get().flush();
      const now = Date.now();
      const chat: ChatSession = { id: uuid(), name: `Chat ${new Date(now).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`, greeting, messages, createdAt: now, updatedAt: now };
      const saved = await s.save(chat);
      set((st) => ({ chat: saved, list: [{ id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, messageCount: saved.messages.length, ...tallyChat(saved.messages, countMemo) }, ...st.list] }));
    },

    deleteChat: async (id) => {
      const s = store();
      if (!s) return;
      if (get().chat?.id === id) {
        if (timer) clearTimeout(timer);
        dirty = false;
        set({ chat: null });
      }
      await s.remove(id);
      set((st) => ({ list: st.list.filter((c) => c.id !== id) }));
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
    setChatLorebook: (lorebookId) =>
      updateChat((c) => {
        const chat: ChatSession = { ...c, lorebookId };
        if (!lorebookId) delete chat.lorebookId;
        return chat;
      }),
    setAuthorsNote: (note) =>
      updateChat((c) => {
        const chat: ChatSession = { ...c, authorsNote: note };
        if (!note) delete chat.authorsNote;
        return chat;
      }),
    setPresence: (memberId, value) =>
      updateChat((c) => {
        const presence = { ...c.presence };
        if (value) presence[memberId] = value;
        else delete presence[memberId];
        const chat: ChatSession = { ...c, presence };
        if (!Object.keys(presence).length) delete chat.presence;
        return chat;
      }),
    setVars: (vars) =>
      updateChat((c) => {
        const chat: ChatSession = { ...c, vars };
        if (!Object.keys(vars).length) delete chat.vars;
        return chat;
      }),
    setMessages: (change) =>
      updateChat((c) => {
        const messages = change(c.messages);
        // A picture goes with the message it follows.
        const ids = new Set(messages.map((m) => m.id));
        const gone = (c.images ?? []).filter((i) => i.after !== null && !ids.has(i.after));
        const s = store();
        if (s) for (const i of gone) void s.deleteImage(i.file).catch(() => {});
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
      const { chat } = get();
      const s = store();
      if (!s || !chat) return;
      await get().flush();
      const until = chat.messages.findIndex((m) => m.id === messageId);
      if (until < 0) return;
      const branch = branchOf(chat, until, uuid(), Date.now());
      // Pictures are filed under their chat's id (they go when it's deleted),
      // so the branch gets copies of its own.
      const images: ChatImage[] = [];
      for (const img of branch.images ?? []) {
        try {
          const blob = await (await fetch(s.imageUrl(img.file))).blob();
          const file = `${branch.id}-${uuid()}.png`;
          await s.putImage(file, blob);
          images.push({ ...img, file });
        } catch {
          /* a picture that can't be copied is left out */
        }
      }
      const saved = await s.save({ ...branch, images });
      set((st) => ({ chat: saved, list: [{ id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, messageCount: saved.messages.length, ...tallyChat(saved.messages, countMemo) }, ...st.list] }));
    },
    importChat: async (chat) => {
      const s = store();
      if (!s) return;
      await get().flush();
      const saved = await s.save(chat);
      set((st) => ({ chat: saved, list: [{ id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, messageCount: saved.messages.length, ...tallyChat(saved.messages, countMemo) }, ...st.list] }));
    },
    removeImage: (id) =>
      updateChat((c) => {
        const image = c.images?.find((i) => i.id === id);
        if (image) void store()?.deleteImage(image.file).catch(() => {});
        return { ...c, images: (c.images ?? []).filter((i) => i.id !== id) };
      }),

    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const { chat } = get();
      const s = store();
      if (!dirty || !s || !chat) return;
      dirty = false;
      await s.save(chat).catch((err) => {
        dirty = true;
        console.error('Chat save failed', err);
      });
    },
  };
});

/** The card's chat counts from its chats' summaries; it was last used at
 *  its newest message (none: not yet). */
function statsOf(list: ChatSummary[]) {
  const { last, ...tally } = sumTallies(list);
  return { chats: list.length, messages: list.reduce((n, c) => n + c.messageCount, 0), lastChat: last || undefined, ...tally };
}

// The card lists' chat counts follow the open card's chats.
useChatStore.subscribe((s, prev) => {
  if (s.list === prev.list || !s.projectId || s.projectId !== prev.projectId) return;
  const list = s.list;
  useProjectStore.getState().setChatStats(
    s.projectId,
    list.length ? statsOf(list) : {},
  );
});
