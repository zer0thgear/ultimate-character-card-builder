'use client';

import { create } from 'zustand';
import { useUiStore } from '@/store/uiStore';

// Requests from the card editor to the dock ("chat with this greeting",
// "illustrate this greeting"), picked up by the panel they're for.

interface BridgeState {
  /** Start a new test chat opened by this greeting (0 = first message). */
  chatGreeting: number | null;
  /** Turn this text into a scene prompt in the image panel. */
  illustrate: string | null;
  /** Use this picture as the image panel's Img2Img base. */
  img2img: Blob | null;
  sendToImg2Img: (image: Blob) => void;
  clearImg2Img: () => void;
  startChat: (greeting: number) => void;
  requestIllustration: (text: string) => void;
  clearChat: () => void;
  clearIllustrate: () => void;
}

export const useBridgeStore = create<BridgeState>((set) => ({
  chatGreeting: null,
  illustrate: null,
  img2img: null,
  sendToImg2Img: (image) => {
    useUiStore.getState().setDockTab('image');
    set({ img2img: image });
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
}));
