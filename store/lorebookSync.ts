'use client';

import type { Lorebook } from '@/types/card';
import { api } from '@/lib/api';
import { cardBookForBank, copyFromCard, sameLore, syncsLorebook } from '@/lib/lorebookBank';
import { useProjectStore } from '@/store/projectStore';
import { useLorebookStore } from '@/store/lorebookStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';

// Keeps a card's lorebook and its copy in the Lorebooks bank (the one made
// from it, BankLorebook.fromCard) in step, both ways, where syncing is on:
// the chat settings' syncCardLorebooks, or the card's own lorebookSync.
// Every change to either side goes through its store (projectStore's
// updateCard, lorebookStore's setBook), so the wizard, the editors and
// undo are all covered. A card that isn't open is changed on the server.

const SYNC_DELAY_MS = 600;
/** Set while one side is being written from the other, so it doesn't echo. */
let applying = false;
const closedTimers = new Map<string, ReturnType<typeof setTimeout>>();

const syncByDefault = () => useLlmStore.getState().chatSettings.syncCardLorebooks === true;

/** The card → bank direction: the open card's lorebook changed. */
function cardChanged(projectId: string, book: Lorebook | undefined) {
  if (!book) return; // Removing the card's lorebook leaves the copy be.
  const bank = useLorebookStore.getState();
  const copy = copyFromCard(bank.books, projectId);
  if (!copy) return;
  applying = true;
  try {
    bank.setBook(copy.id, cardBookForBank(book, copy.book));
  } finally {
    applying = false;
  }
}

/** The bank → card direction: a copy of a card's lorebook changed. */
function copyChanged(projectId: string, book: Lorebook) {
  const store = useProjectStore.getState();
  if (store.project?.id === projectId) {
    if (!syncsLorebook(store.project, syncByDefault())) return;
    // The bank's name stays the bank's; the card keeps its own.
    const own = store.project.card.data.character_book;
    if (own && sameLore(own, book)) return;
    applying = true;
    try {
      store.updateCard((d) => ({ ...d, character_book: { ...structuredClone(book), name: own?.name ?? book.name } }), 'lorebook-sync');
    } finally {
      applying = false;
    }
    return;
  }
  // Not open: the server sets it, if the card's own choice allows.
  const t = closedTimers.get(projectId);
  if (t) clearTimeout(t);
  closedTimers.set(
    projectId,
    setTimeout(() => {
      closedTimers.delete(projectId);
      void api.syncCardLorebook(projectId, book, syncByDefault()).catch((err: Error) => toast(`Couldn't update the card's lorebook: ${err.message}`, 'error'));
    }, SYNC_DELAY_MS),
  );
}

let installed = false;

/** Starts syncing (once, from the app shell). */
export function installLorebookSync() {
  if (installed) return;
  installed = true;
  useProjectStore.subscribe((s, prev) => {
    if (applying || !s.project || s.project.id !== prev.project?.id) return;
    const book = s.project.card.data.character_book;
    if (book === prev.project.card.data.character_book) return;
    if (syncsLorebook(s.project, syncByDefault())) cardChanged(s.project.id, book);
  });
  useLorebookStore.subscribe((s, prev) => {
    if (applying) return;
    for (const b of s.books) {
      if (!b.fromCard) continue;
      const before = prev.books.find((x) => x.id === b.id);
      // Only edits: a book just added or loaded isn't a change to pass on.
      if (!before || before.book === b.book) continue;
      copyChanged(b.fromCard.projectId, b.book);
    }
  });
}
