'use client';

import { create } from 'zustand';
import type { CardProject, ChatSession, GroupProject, GroupSummary } from '@/types/project';
import { api, chatApi } from '@/lib/api';
import { uuid } from '@/lib/uuid';
import { chatGreeting } from '@/lib/chatPrompt';
import { DEFAULT_GROUP_SETTINGS } from '@/lib/groupChat';
import { useProjectStore } from '@/store/projectStore';

// Group chats' groups (lib/groupChat.ts): the list, and the one open in
// Chat mode with its members' cards. A group and a card are never open at
// once.

const SAVE_DELAY_MS = 500;

interface GroupState {
  summaries: GroupSummary[];
  listed: boolean;
  group: GroupProject | null;
  /** The open group's members' cards, by project id. */
  members: Record<string, CardProject>;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
  close: () => Promise<void>;
  /** A new group of these cards, opened. */
  create: (name: string, memberIds: string[]) => Promise<GroupProject>;
  /** A group made from a card's chat: the card and `others`, with a copy of
   *  the chat as its first (the card's chat stays as it was), opened. */
  createFromChat: (projectId: string, chat: ChatSession, others: string[], name: string) => Promise<GroupProject>;
  update: (change: (g: GroupProject) => GroupProject) => void;
  remove: (id: string) => Promise<void>;
  /** The open group's members' cards, read again (after a card changes). */
  reloadMembers: () => Promise<void>;
  flush: () => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

const summaryOf = (g: GroupProject, chats = 0, lastChat?: number): GroupSummary => ({ id: g.id, name: g.name, members: g.members, createdAt: g.createdAt, updatedAt: g.updatedAt, chats, ...(lastChat ? { lastChat } : {}) });

async function loadMembers(g: GroupProject): Promise<Record<string, CardProject>> {
  const found = await Promise.all(g.members.map((m) => api.getProject(m.projectId).catch(() => null)));
  return Object.fromEntries(found.filter((p): p is CardProject => !!p).map((p) => [p.id, p]));
}

export const useGroupStore = create<GroupState>((set, get) => ({
  summaries: [],
  listed: false,
  group: null,
  members: {},

  refresh: async () => set({ summaries: await api.listGroups(), listed: true }),

  open: async (id) => {
    await get().flush();
    await useProjectStore.getState().close();
    const group = await api.getGroup(id);
    const members = await loadMembers(group);
    set({ group, members });
  },

  close: async () => {
    await get().flush();
    set({ group: null, members: {} });
  },

  create: async (name, memberIds) => {
    const now = Date.now();
    const saved = await api.saveGroup({ id: uuid(), name: name.trim() || 'Group', members: memberIds.map((projectId) => ({ projectId })), settings: { ...DEFAULT_GROUP_SETTINGS }, createdAt: now, updatedAt: now });
    set((s) => ({ summaries: [summaryOf(saved), ...s.summaries.filter((x) => x.id !== saved.id)] }));
    await get().open(saved.id);
    return saved;
  },

  createFromChat: async (projectId, chat, others, name) => {
    const project = await api.getProject(projectId);
    const now = Date.now();
    const group = await api.saveGroup({ id: uuid(), name: name.trim() || 'Group', members: [projectId, ...others.filter((o) => o !== projectId)].map((p) => ({ projectId: p })), settings: { ...DEFAULT_GROUP_SETTINGS }, createdAt: now, updatedAt: now });
    // The card's greeting becomes the group chat's first message, and the
    // character's messages are the card's. Pictures stay with the card.
    const greeting = chatGreeting(project.card.data, chat);
    const copy: ChatSession = {
      ...structuredClone(chat),
      id: uuid(),
      name: `${chat.name} (group)`,
      greeting: -1,
      messages: [
        ...(greeting.trim() ? [{ id: uuid(), role: 'assistant' as const, speaker: projectId, swipes: [greeting], swipe: 0, createdAt: chat.createdAt }] : []),
        ...chat.messages.map((m) => (m.role === 'assistant' ? { ...structuredClone(m), speaker: projectId } : structuredClone(m))),
      ],
      createdAt: now,
      updatedAt: now,
    };
    delete copy.greetingEdits;
    delete copy.images;
    await chatApi({ kind: 'group', id: group.id }).save(copy);
    set((s) => ({ summaries: [summaryOf(group, 1, now), ...s.summaries] }));
    await get().open(group.id);
    return group;
  },

  update: (change) => {
    const g = get().group;
    if (!g) return;
    const next = { ...change(g), updatedAt: Date.now() };
    set((s) => ({ group: next, summaries: s.summaries.map((x) => (x.id === next.id ? { ...x, name: next.name, members: next.members, updatedAt: next.updatedAt } : x)) }));
    // New members' cards come along.
    const missing = next.members.filter((m) => !get().members[m.projectId]);
    if (missing.length) void Promise.all(missing.map((m) => api.getProject(m.projectId).catch(() => null))).then((found) => set((s) => ({ members: { ...s.members, ...Object.fromEntries(found.filter((p): p is CardProject => !!p).map((p) => [p.id, p])) } })));
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
  },

  remove: async (id) => {
    if (get().group?.id === id) {
      if (timer) clearTimeout(timer);
      dirty = false;
      set({ group: null, members: {} });
    }
    await api.deleteGroup(id);
    set((s) => ({ summaries: s.summaries.filter((g) => g.id !== id) }));
  },

  reloadMembers: async () => {
    const g = get().group;
    if (g) set({ members: await loadMembers(g) });
  },

  flush: async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const g = get().group;
    if (!dirty || !g) return;
    dirty = false;
    await api.saveGroup(g).catch((err) => {
      dirty = true;
      console.error('Group save failed', err);
    });
  },
}));

// Opening a card closes the group.
useProjectStore.subscribe((s, prev) => {
  if (s.project && s.project !== prev.project && !prev.project && useGroupStore.getState().group) void useGroupStore.getState().close();
});
