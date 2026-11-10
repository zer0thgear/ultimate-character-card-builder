'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AVATAR_STYLES, BUILT_IN_THEMES, CHAT_DISPLAYS, DEFAULT_LOOK, cleanLook, lookBase, lookOf, parseTheme, themeFile, type Look, type Theme } from '@/lib/appearance';
import type { AvatarShape } from '@/lib/chatPrompt';
import { serverStorage } from '@/lib/serverSettings';
import { useLlmStore } from '@/store/llmStore';
import { useUiStore } from '@/store/uiStore';

// How the app looks (lib/appearance.ts): the look in use and the themes
// you've saved, kept on the server with the other settings, so every device
// shares them. components/Appearance.tsx applies the look.

interface LookState {
  look: Look;
  /** Themes you've saved or imported (UCCB's own aren't kept here). */
  themes: Theme[];
  setLook: (patch: Partial<Look>) => void;
  /** Takes a theme's look, with the chat display it carries. */
  applyTheme: (theme: Theme) => void;
  /** Saves the look as a theme by this name (over one of yours by the same name). */
  saveTheme: (name: string) => Theme;
  /** Adds a theme read from a file, and applies it. */
  addTheme: (theme: Theme) => void;
  deleteTheme: (name: string) => void;
}

const AVATAR_OF: Record<number, AvatarShape> = { [AVATAR_STYLES.round]: 'circle', [AVATAR_STYLES.rectangular]: 'rectangle', [AVATAR_STYLES.square]: 'square', [AVATAR_STYLES.rounded]: 'square' };
const STYLE_OF: Record<AvatarShape, number | undefined> = { circle: AVATAR_STYLES.round, rectangle: AVATAR_STYLES.rectangular, square: AVATAR_STYLES.square, none: undefined };

/** The chat display settings a theme carries, as they are now. */
export function chatDisplayNow(): Pick<Theme, 'base' | 'avatar_style' | 'chat_display' | 'chat_width' | 'timestamps_enabled' | 'mesIDDisplay_enabled'> {
  const s = useLlmStore.getState().chatSettings;
  const avatar = STYLE_OF[s.avatarShape ?? 'circle'];
  return {
    base: useUiStore.getState().theme,
    ...(avatar !== undefined ? { avatar_style: avatar } : {}),
    chat_display: s.chatStyle === 'flat' ? CHAT_DISPLAYS.flat : CHAT_DISPLAYS.bubbles,
    chat_width: Math.round(useUiStore.getState().chatFullWidth * 100),
    timestamps_enabled: s.showTimestamps ?? true,
    mesIDDisplay_enabled: s.showMessageIds,
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const allThemes = (mine: Theme[]) => [...BUILT_IN_THEMES, ...mine.filter((t) => !BUILT_IN_THEMES.some((b) => sameName(b.name, t.name)))];

export const useLookStore = create<LookState>()(
  persist(
    (set, get) => ({
      look: DEFAULT_LOOK,
      themes: [],
      setLook: (patch) => set((s) => ({ look: { ...s.look, ...patch } })),
      applyTheme: (theme) => {
        const { base, avatar_style, chat_display, chat_width, timestamps_enabled, mesIDDisplay_enabled } = theme;
        set((s) => ({ look: { ...lookOf(theme), background: s.look.background } }));
        const ui = useUiStore.getState();
        const wanted = base ?? lookBase(theme, ui.theme);
        if (wanted !== ui.theme) ui.setTheme(wanted);
        // The chat's own width slider (per device) takes the theme's.
        if (chat_width !== undefined) ui.setChatFullWidth(chat_width / 100);
        const chat = {
          ...(avatar_style !== undefined && AVATAR_OF[avatar_style] ? { avatarShape: AVATAR_OF[avatar_style] } : {}),
          // Document style is flat, without the bubbles.
          ...(chat_display !== undefined ? { chatStyle: chat_display === CHAT_DISPLAYS.bubbles ? ('bubbles' as const) : ('flat' as const) } : {}),
          ...(timestamps_enabled !== undefined ? { showTimestamps: timestamps_enabled } : {}),
          ...(mesIDDisplay_enabled !== undefined ? { showMessageIds: mesIDDisplay_enabled } : {}),
        };
        if (Object.keys(chat).length) useLlmStore.getState().setChatSettings(chat);
      },
      saveTheme: (name) => {
        const theme: Theme = { ...themeFile({ ...get().look, name: name.trim() }, chatDisplayNow()) };
        set((s) => ({ look: { ...s.look, name: theme.name }, themes: [...s.themes.filter((t) => !sameName(t.name, theme.name)), theme] }));
        return theme;
      },
      addTheme: (theme) => {
        set((s) => ({ themes: [...s.themes.filter((t) => !sameName(t.name, theme.name)), theme] }));
        get().applyTheme(theme);
      },
      deleteTheme: (name) => set((s) => ({ themes: s.themes.filter((t) => !sameName(t.name, name)) })),
    }),
    {
      name: 'look',
      storage: createJSONStorage(() => serverStorage),
      skipHydration: true,
      partialize: (s) => ({ look: s.look, themes: s.themes }),
      merge: (saved, current) => {
        const o = (saved && typeof saved === 'object' ? saved : {}) as { look?: unknown; themes?: unknown };
        const themes = (Array.isArray(o.themes) ? o.themes : []).map((t) => parseTheme(t)).filter((t): t is Theme => !!t);
        return { ...current, look: cleanLook(o.look), themes };
      },
    },
  ),
);
