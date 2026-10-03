'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { Button, Modal } from '@/components/ui';

// ? (outside a text box) lists the keyboard shortcuts.

const useShortcuts = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

export const openShortcuts = () => useShortcuts.getState().set(true);

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Anywhere',
    keys: [
      ['?', 'This list (outside a text box)'],
      ['Esc', 'Close the dialog on top'],
      ['Mod+S', 'Save now'],
      ['Mod+Z', 'Undo a change to the card (outside a text box)'],
      ['Mod+Y  /  Mod+Shift+Z', 'Redo'],
    ],
  },
  {
    title: 'Image',
    keys: [
      ['Mod+Enter', 'Generate, from the image form'],
      ['←  /  →', 'The previous or next picture in the viewer and the library'],
    ],
  },
  {
    title: 'Chat',
    keys: [
      ['Enter', 'Send (empty: ask for a reply); on a touch screen, a new line'],
      ['Shift+Enter', 'A new line'],
      ['←  /  →', "The last reply's previous or next version (a new one past the last); with only the greeting, the greetings"],
      ['Mod+F', 'Search the chat (with focus in it)'],
      ['Enter  /  Shift+Enter', 'In the search: the earlier or later match'],
    ],
  },
];

/** Listens for ? and shows the list. */
export function ShortcutsDialog() {
  const { open, set } = useShortcuts();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      set(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);
  if (!open) return null;
  const mod = isMac() ? '⌘' : 'Ctrl';
  return (
    <Modal open onClose={() => set(false)} title="⌨ Keyboard shortcuts" footer={<Button onClick={() => set(false)}>Close</Button>}>
      <div className="flex flex-col gap-4">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">{g.title}</div>
            <table className="w-full text-sm">
              <tbody>
                {g.keys.map(([k, what]) => (
                  <tr key={k + what} className="border-t border-slate-800 first:border-t-0">
                    <td className="w-48 py-1 pr-3 align-top whitespace-nowrap">
                      {k.split('  /  ').map((combo, i) => (
                        <span key={combo}>
                          {i > 0 && <span className="px-1 text-slate-500">/</span>}
                          {combo
                            .replace(/Mod/g, mod)
                            .split('+')
                            .map((part, j) => (
                              <span key={j}>
                                {j > 0 && <span className="text-slate-500">+</span>}
                                <kbd className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-200">{part}</kbd>
                              </span>
                            ))}
                        </span>
                      ))}
                    </td>
                    <td className="py-1 text-slate-300">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Modal>
  );
}
