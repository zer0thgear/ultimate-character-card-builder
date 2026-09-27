'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppConfig } from '@/types/project';
import { DEFAULT_CONFIG } from '@/types/project';
import { api } from '@/lib/api';

// Layout and preferences (persisted), the server's config, and toasts.

export type EditorTab = 'basics' | 'greetings' | 'lorebook' | 'prompts' | 'creator' | 'notes' | 'tools';
export type DockTab = 'image' | 'gallery' | 'library' | 'chat' | 'assist';

interface UiState {
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  editorTab: EditorTab;
  setEditorTab: (t: EditorTab) => void;
  dockTab: DockTab;
  /** Opens a dock tab; on a phone, that also brings the dock on screen. */
  setDockTab: (t: DockTab) => void;
  /** On a phone, which one screen shows: the card editor or the dock. */
  phoneView: 'card' | 'dock';
  setPhoneView: (v: 'card' | 'dock') => void;
  /** The home screen (no card open): the card list, or the gen library. */
  homeTab: 'cards' | 'library';
  setHomeTab: (t: 'cards' | 'library') => void;
  /** The dock's share of the workspace width, 0.25–0.75. */
  dockWidth: number;
  setDockWidth: (w: number) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  showAvatar: boolean;
  setShowAvatar: (show: boolean) => void;
  /** Keep NovelAI's generation metadata in exported card PNGs. */
  exportKeepsMetadata: boolean;
  setExportKeepsMetadata: (v: boolean) => void;
  /** Card export: the picture's longest edge at most this (0 = as is). */
  exportMaxSize: number;
  /** Card export: recompress the picture. */
  exportCompression: 'off' | 'lossless' | 'palette';
  setExportImage: (patch: { exportMaxSize?: number; exportCompression?: 'off' | 'lossless' | 'palette' }) => void;
  personaSort: PersonaSort;
  setPersonaSort: (s: PersonaSort) => void;
}

export type PersonaSort = 'name' | 'name-desc' | 'newest' | 'oldest';

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => {
        document.documentElement.dataset.theme = theme;
        set({ theme });
      },
      editorTab: 'basics',
      setEditorTab: (editorTab) => set({ editorTab }),
      dockTab: 'image',
      setDockTab: (dockTab) => set({ dockTab, phoneView: 'dock' }),
      phoneView: 'card',
      setPhoneView: (phoneView) => set({ phoneView }),
      homeTab: 'cards',
      setHomeTab: (homeTab) => set({ homeTab }),
      dockWidth: 0.45,
      setDockWidth: (w) => set({ dockWidth: Math.min(0.75, Math.max(0.25, w)) }),
      sidebarOpen: true,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      showAvatar: true,
      setShowAvatar: (showAvatar) => set({ showAvatar }),
      exportKeepsMetadata: false,
      setExportKeepsMetadata: (exportKeepsMetadata) => set({ exportKeepsMetadata }),
      exportMaxSize: 0,
      exportCompression: 'off',
      setExportImage: (patch) => set(patch),
      personaSort: 'name',
      setPersonaSort: (personaSort) => set({ personaSort }),
    }),
    { name: 'uccb-ui', storage: createJSONStorage(() => localStorage) },
  ),
);

// ─── Server config ───────────────────────────────────────────────────────────

interface ConfigState {
  config: AppConfig;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<AppConfig>) => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: DEFAULT_CONFIG,
  loaded: false,
  load: async () => set({ config: await api.getConfig(), loaded: true }),
  update: async (patch) => {
    set((s) => ({ config: { ...s.config, ...patch } }));
    set({ config: await api.setConfig(patch) });
  },
}));

// ─── Toasts ──────────────────────────────────────────────────────────────────

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (text, tone = 'info', action) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, tone, action }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 8000 : 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (text: string, tone?: Toast['tone'], action?: Toast['action']) => useToastStore.getState().push(text, tone, action);
