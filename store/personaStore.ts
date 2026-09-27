'use client';

import { create } from 'zustand';
import type { ChatSession, Persona } from '@/types/project';
import { api } from '@/lib/api';
import { useLlmStore } from '@/store/llmStore';
import { uuid } from '@/lib/uuid';

// Personas: who you are in test chats. Kept on the local server
// (data/personas/), avatars included; which one is active is a chat
// setting, and a chat can lock one of its own.

const SAVE_DELAY_MS = 500;
let timer: ReturnType<typeof setTimeout> | null = null;

interface PersonaState {
  personas: Persona[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (init?: Partial<Persona>) => Persona;
  update: (id: string, patch: Partial<Persona>) => void;
  remove: (id: string) => Promise<void>;
  setAvatar: (id: string, image: Blob) => Promise<void>;
  clearAvatar: (id: string) => Promise<void>;
}

export const usePersonaStore = create<PersonaState>((set, get) => {
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void api.savePersonas(get().personas), SAVE_DELAY_MS);
  };
  return {
    personas: [],
    loaded: false,
    load: async () => set({ personas: await api.listPersonas(), loaded: true }),
    add: (init = {}) => {
      const p: Persona = { id: uuid(), name: 'New persona', description: '', ...init };
      set((s) => ({ personas: [...s.personas, p] }));
      save();
      return p;
    },
    update: (id, patch) => {
      set((s) => ({ personas: s.personas.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
      save();
    },
    remove: async (id) => {
      if (get().personas.find((p) => p.id === id)?.avatar) await api.clearPersonaAvatar(id).catch(() => {});
      set((s) => ({ personas: s.personas.filter((p) => p.id !== id) }));
      if (useLlmStore.getState().chatSettings.personaId === id) useLlmStore.getState().setChatSettings({ personaId: null });
      if (timer) clearTimeout(timer);
      await api.savePersonas(get().personas);
    },
    setAvatar: async (id, image) => {
      // The persona has to exist on the server before it can have a picture.
      if (timer) clearTimeout(timer);
      await api.savePersonas(get().personas);
      const avatar = await api.setPersonaAvatar(id, image);
      set((s) => ({ personas: s.personas.map((p) => (p.id === id ? { ...p, avatar } : p)) }));
    },
    clearAvatar: async (id) => {
      await api.clearPersonaAvatar(id);
      set((s) => ({ personas: s.personas.map((p) => (p.id === id ? { ...p, avatar: undefined } : p)) }));
    },
  };
});

export interface ActivePersona {
  /** The persona in use, or null when the plain name/description apply. */
  persona: Persona | null;
  name: string;
  description: string;
  avatarUrl: string | null;
  /** Whether it comes from the chat's lock rather than the global choice. */
  locked: boolean;
}

/** Who {{user}} is: the chat's locked persona, else the active one, else
 *  the plain name and description from the chat settings. */
export function resolvePersona(personas: Persona[], settings: { personaId: string | null; userName: string; persona: string }, chat?: Pick<ChatSession, 'personaId'> | null): ActivePersona {
  const lockedTo = chat?.personaId ? personas.find((p) => p.id === chat.personaId) : undefined;
  const p = lockedTo ?? (settings.personaId ? personas.find((x) => x.id === settings.personaId) : undefined);
  if (!p) return { persona: null, name: settings.userName || 'User', description: settings.persona, avatarUrl: null, locked: false };
  return { persona: p, name: p.name || 'User', description: p.description, avatarUrl: api.personaAvatarUrl(p), locked: !!lockedTo };
}

/** Personas in the chosen order. They're kept in the order they were
 *  added, which is what "newest" and "oldest" go by. */
export function sortPersonas(list: Persona[], sort: 'name' | 'name-desc' | 'newest' | 'oldest'): Persona[] {
  const byName = (a: Persona, b: Persona) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  switch (sort) {
    case 'name':
      return [...list].sort(byName);
    case 'name-desc':
      return [...list].sort((a, b) => byName(b, a));
    case 'newest':
      return [...list].reverse();
    default:
      return list;
  }
}
