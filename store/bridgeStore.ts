'use client';

import { create } from 'zustand';
import { useUiStore } from '@/store/uiStore';
import type { EditorMode } from '@/lib/editorResult';

// Requests from the card editor to the dock ("chat with this greeting",
// "illustrate this greeting"), picked up by the panel they're for.

interface BridgeState {
  /** Start a new test chat opened by this greeting (0 = first message). */
  chatGreeting: number | null;
  /** Turn this text into a scene prompt in the image panel. */
  illustrate: string | null;
  /** Write a character prompt in the image panel from this lorebook entry. */
  entryPrompt: { name: string; content: string } | null;
  /** Use this picture as the image panel's Img2Img base. */
  img2img: { image: Blob; open?: EditorMode } | null;
  /** `open`: go straight into Edit Image ('paint') or Inpaint ('mask'). */
  sendToImg2Img: (image: Blob, open?: EditorMode) => void;
  clearImg2Img: () => void;
  startChat: (greeting: number) => void;
  requestIllustration: (text: string) => void;
  clearChat: () => void;
  clearIllustrate: () => void;
  requestEntryPrompt: (entry: { name: string; content: string }) => void;
  clearEntryPrompt: () => void;
}

export const useBridgeStore = create<BridgeState>((set) => ({
  chatGreeting: null,
  illustrate: null,
  entryPrompt: null,
  img2img: null,
  sendToImg2Img: (image, open) => {
    useUiStore.getState().setDockTab('image');
    set({ img2img: { image, open } });
  },
  clearImg2Img: () => set({ img2img: null }),
  startChat: (greeting) => {
    useUiStore.getState().setDockTab('chat');
    set({ chatGreeting: greeting });
  },
  requestIllustration: (text) => {
    useUiStore.getState().setDockTab('image');
    set({ illustrate: text });
  },
  clearChat: () => set({ chatGreeting: null }),
  clearIllustrate: () => set({ illustrate: null }),
  requestEntryPrompt: (entry) => {
    useUiStore.getState().setDockTab('image');
    set({ entryPrompt: entry });
  },
  clearEntryPrompt: () => set({ entryPrompt: null }),
}));
