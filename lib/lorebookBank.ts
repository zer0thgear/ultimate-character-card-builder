import type { CardData, Lorebook, LorebookEntry } from '@/types/card';
import type { BankLorebook } from '@/types/project';
import { uuid } from '@/lib/uuid';

// The Lorebooks bank, as SillyTavern's World Info list: lorebooks kept on
// their own (data/lorebooks/), which a chat (one), a persona (one) or every
// chat (global, any number) can bring in beside the card's own lorebook.
// SillyTavern puts the chat's entries first, then the persona's, then the
// character's and the global ones (character first, its default); a book
// that's already in from one place isn't read twice. The scan then treats
// them as one lorebook (lib/lorebookScan.ts).

/** Where an attached lorebook comes in from. */
export type LoreSource = 'chat' | 'persona' | 'global';

export interface AttachedLorebook {
  id: string;
  name: string;
  source: LoreSource;
  book: Lorebook;
}

/** A bank lorebook's name, or a stand-in for an unnamed one. */
export const bankName = (b: Pick<BankLorebook, 'book'>) => b.book.name?.trim() || 'Unnamed lorebook';

/** A new bank entry around `book`. */
export function newBankLorebook(book: Lorebook, init: Partial<Omit<BankLorebook, 'book'>> = {}, now = Date.now()): BankLorebook {
  return { id: uuid(), createdAt: now, updatedAt: now, ...init, book };
}

/** The name a card's lorebook goes into the bank under, as SillyTavern
 *  names it on import: its own name, else "<card>'s Lorebook". */
export const cardLoreName = (card: Pick<CardData, 'name' | 'character_book'>) => card.character_book?.name?.trim() || `${card.name?.trim() || 'Unnamed'}'s Lorebook`;

/** Whether a card has a lorebook worth offering to the bank. */
export const hasCardLore = (card: Pick<CardData, 'character_book'>) => !!card.character_book?.entries.length;

/** The bank copy already made from this card, if any. */
export const copyFromCard = (bank: BankLorebook[], projectId: string) => bank.find((b) => b.fromCard?.projectId === projectId);

export interface LoreLinks {
  /** The card the chat is with: bank copies of its own lorebook are skipped. */
  projectId?: string;
  chatLorebookId?: string;
  personaLorebookId?: string;
  globalIds?: string[];
}

/** The bank lorebooks a chat brings in, in SillyTavern's order (chat,
 *  persona, global), each once. Missing ids (a deleted book) are skipped. */
export function lorebooksInPlay(bank: BankLorebook[], links: LoreLinks): AttachedLorebook[] {
  const byId = new Map(bank.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const out: AttachedLorebook[] = [];
  const add = (id: string | undefined, source: LoreSource) => {
    const b = id ? byId.get(id) : undefined;
    if (!b || seen.has(b.id)) return;
    seen.add(b.id);
    // The card's own lorebook is already in; its bank copy would double it.
    if (links.projectId && b.fromCard?.projectId === links.projectId) return;
    out.push({ id: b.id, name: bankName(b), source, book: b.book });
  };
  add(links.chatLorebookId, 'chat');
  add(links.personaLorebookId, 'persona');
  for (const id of links.globalIds ?? []) add(id, 'global');
  return out;
}

/** Which lorebook an entry came from, on entries of a combined book (none
 *  on the card's own). */
export const ENTRY_BOOK = '__lorebook';
export const entryBook = (e: LorebookEntry) => (typeof e[ENTRY_BOOK] === 'string' ? (e[ENTRY_BOOK] as string) : undefined);

/**
 * The card's lorebook and the attached ones as one lorebook for the scan:
 * chat and persona entries first, then the card's, then the global ones.
 * Scan depth and token budget are the card's where it sets them, else the
 * first attached book's that does; recursion is on if any book has it.
 * Undefined when there's nothing to scan.
 */
export function combineLorebooks(cardBook: Lorebook | undefined, attached: AttachedLorebook[]): Lorebook | undefined {
  if (!attached.length) return cardBook;
  const tag = (a: AttachedLorebook) => a.book.entries.map((e) => ({ ...e, [ENTRY_BOOK]: a.name }));
  const first = attached.filter((a) => a.source !== 'global');
  const global = attached.filter((a) => a.source === 'global');
  const entries = [...first.flatMap(tag), ...(cardBook?.entries ?? []), ...global.flatMap(tag)];
  if (!entries.length) return cardBook;
  const books = [...(cardBook ? [cardBook] : []), ...attached.map((a) => a.book)];
  return {
    ...(cardBook ?? {}),
    extensions: cardBook?.extensions ?? {},
    scan_depth: books.find((b) => typeof b.scan_depth === 'number')?.scan_depth,
    token_budget: books.find((b) => typeof b.token_budget === 'number')?.token_budget,
    recursive_scanning: books.some((b) => b.recursive_scanning),
    entries,
  };
}

/** The card with the attached lorebooks folded into its own, for building
 *  a prompt; the card itself is untouched. */
export function withAttachedLore(card: CardData, attached: AttachedLorebook[]): CardData {
  if (!attached.length) return card;
  const book = combineLorebooks(card.character_book, attached);
  return book ? { ...card, character_book: book } : card;
}
