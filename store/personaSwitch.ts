'use client';

import { ownerKey } from '@/lib/api';
import { useChatStore } from '@/store/chatStore';
import { useLlmStore } from '@/store/llmStore';
import { personaFor, usePersonaStore } from '@/store/personaStore';
import { toast } from '@/store/uiStore';

// Personas that switch by themselves, as SillyTavern's do: opening a card's
// (or a group's) chats, or another of its chats, makes the persona linked to
// that card the active one, else the default persona (store/personaStore.ts).
// A chat with a persona pinned (📌) keeps that one, whatever the active one is.

let installed = false;

/** Starts switching (once, from the Shell). */
export function installPersonaSwitch() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  let last = '';
  useChatStore.subscribe((s) => {
    const owner = s.owner;
    const key = owner ? `${ownerKey(owner)}/${s.chat?.id ?? ''}` : '';
    if (key === last) return;
    last = key;
    if (!owner || !usePersonaStore.getState().loaded) return;
    const { personas } = usePersonaStore.getState();
    if (s.chat?.personaId && personas.some((p) => p.id === s.chat!.personaId)) return;
    const { chatSettings, setChatSettings } = useLlmStore.getState();
    const target = personaFor(personas, ownerKey(owner), chatSettings.defaultPersonaId);
    if (!target || target.id === chatSettings.personaId) return;
    setChatSettings({ personaId: target.id });
    toast(`Persona: ${target.name || 'Unnamed'} (${target.links?.includes(ownerKey(owner)) ? 'linked to this character' : 'the default'})`);
  });
}
