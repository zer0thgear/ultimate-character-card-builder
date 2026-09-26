'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { LlmConnection, ProviderKind } from '@/types/llm';
import { DEFAULT_PARAMS } from '@/types/llm';
import { DEFAULT_CHAT_SETTINGS, type ChatPromptSettings } from '@/lib/chatPrompt';
import type { ChatPreset } from '@/lib/stPreset';
import { useSessionStore } from '@/store/sessionStore';

// LLM connections (keys included, in localStorage like the NovelAI key),
// which one the test chat and the writing assistant each use, and the
// chat's prompt settings.

export function newConnection(kind: ProviderKind): LlmConnection {
  const names: Record<ProviderKind, string> = { novelai: 'NovelAI', openai: 'OpenAI-compatible', anthropic: 'Claude' };
  return {
    id: crypto.randomUUID(),
    name: names[kind],
    kind,
    baseUrl: kind === 'openai' ? 'https://openrouter.ai/api/v1' : '',
    apiKey: '',
    model: kind === 'anthropic' ? 'claude-opus-5' : '',
    params: { ...DEFAULT_PARAMS[kind] },
  };
}

interface LlmState {
  connections: LlmConnection[];
  chatConnectionId: string | null;
  assistConnectionId: string | null;
  chatSettings: ChatPromptSettings;
  /** Imported SillyTavern chat-completion presets. */
  presets: ChatPreset[];
  addPreset: (p: ChatPreset) => void;
  updatePreset: (id: string, patch: Partial<ChatPreset>) => void;
  removePreset: (id: string) => void;
  addConnection: (kind: ProviderKind) => LlmConnection;
  updateConnection: (id: string, patch: Partial<LlmConnection>) => void;
  removeConnection: (id: string) => void;
  setChatConnection: (id: string | null) => void;
  setAssistConnection: (id: string | null) => void;
  setChatSettings: (patch: Partial<ChatPromptSettings>) => void;
}

export const useLlmStore = create<LlmState>()(
  persist(
    (set) => ({
      connections: [],
      chatConnectionId: null,
      assistConnectionId: null,
      chatSettings: DEFAULT_CHAT_SETTINGS,
      presets: [],
      addPreset: (preset) => set((s) => ({ presets: [...s.presets, preset], chatSettings: { ...s.chatSettings, presetId: preset.id } })),
      updatePreset: (id, patch) => set((s) => ({ presets: s.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removePreset: (id) =>
        set((s) => ({ presets: s.presets.filter((p) => p.id !== id), chatSettings: s.chatSettings.presetId === id ? { ...s.chatSettings, presetId: null } : s.chatSettings })),
      addConnection: (kind) => {
        const c = newConnection(kind);
        set((s) => ({
          connections: [...s.connections, c],
          chatConnectionId: s.chatConnectionId ?? c.id,
          assistConnectionId: s.assistConnectionId ?? c.id,
        }));
        return c;
      },
      updateConnection: (id, patch) =>
        set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, ...patch, params: { ...c.params, ...patch.params } } : c)) })),
      removeConnection: (id) =>
        set((s) => {
          const connections = s.connections.filter((c) => c.id !== id);
          const fallback = connections[0]?.id ?? null;
          return {
            connections,
            chatConnectionId: s.chatConnectionId === id ? fallback : s.chatConnectionId,
            assistConnectionId: s.assistConnectionId === id ? fallback : s.assistConnectionId,
          };
        }),
      setChatConnection: (id) => set({ chatConnectionId: id }),
      setAssistConnection: (id) => set({ assistConnectionId: id }),
      setChatSettings: (patch) => set((s) => ({ chatSettings: { ...s.chatSettings, ...patch } })),
    }),
    {
      name: 'uccb-llm',
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LlmState>;
        return { ...current, ...p, chatSettings: { ...DEFAULT_CHAT_SETTINGS, ...(p.chatSettings ?? {}) } };
      },
    },
  ),
);

/** The connection as sent to the proxy: a NovelAI one with no key of its
 *  own borrows the NovelAI key from Settings. */
export function requestConnection(c: LlmConnection) {
  const apiKey = c.kind === 'novelai' && !c.apiKey ? useSessionStore.getState().apiKey : c.apiKey;
  return { kind: c.kind, baseUrl: c.baseUrl, apiKey, model: c.model, params: c.params };
}

export const connectionById = (id: string | null) => useLlmStore.getState().connections.find((c) => c.id === id) ?? null;
