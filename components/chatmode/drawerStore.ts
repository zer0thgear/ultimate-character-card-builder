import { create } from 'zustand';

// The drawers that open under the top bar, over the chat (components/chatmode/
// StLayout.tsx): every icon of the SillyTavern layout's bar, and the chat
// preset and the connections in UCCB's own.

export type DrawerId = 'preset' | 'api' | 'chat' | 'look' | 'ext' | 'personas' | 'chars';

/** Which drawer is open, and whether UCCB's own bar shows under the SillyTavern layout's icons. */
export const useStLayout = create<{ drawer: DrawerId | null; uccbBar: boolean; open: (d: DrawerId | null) => void; toggle: (d: DrawerId) => void; setUccbBar: (on: boolean) => void }>((set) => ({
  drawer: null,
  uccbBar: false,
  open: (drawer) => set({ drawer }),
  toggle: (d) => set((s) => ({ drawer: s.drawer === d ? null : d })),
  setUccbBar: (uccbBar) => set({ uccbBar }),
}));
