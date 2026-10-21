// Chub's linked lorebooks: a Chub card can link lorebooks kept apart from
// it on Chub (beside the one written into it). The card lists them in
// extensions.chub.related_lorebooks, each with its Chub path
// ("lorebooks/creator/name"). UCCB fetches each into the Lorebooks bank
// once (BankLorebook.chub) and links it to the card
// (CardProject.lorebookIds), so it comes along in the card's chats.

import type { BankLorebook } from '@/types/project';

export interface ChubLoreLink {
  /** "lorebooks/creator/name". */
  path: string;
  id?: number;
}

const LOREBOOK_PATH = /^lorebooks\/[\w.~-]+\/[\w.~-]+$/;

/** The lorebooks a card links on Chub, each once. */
export function chubLoreLinks(card: { extensions?: Record<string, unknown> }): ChubLoreLink[] {
  const chub = card.extensions?.chub as { related_lorebooks?: unknown } | undefined;
  const out: ChubLoreLink[] = [];
  for (const r of Array.isArray(chub?.related_lorebooks) ? chub.related_lorebooks : []) {
    const x = (r && typeof r === 'object' ? r : {}) as { path?: unknown; id?: unknown };
    const path = typeof x.path === 'string' ? x.path.trim().replace(/^\/+|\/+$/g, '') : '';
    if (!LOREBOOK_PATH.test(path) || out.some((o) => o.path.toLowerCase() === path.toLowerCase())) continue;
    out.push({ path, ...(typeof x.id === 'number' && x.id > 0 ? { id: x.id } : {}) });
  }
  return out;
}

/** The bank's copy of a Chub lorebook, if it was fetched before. */
export const bankCopyOf = (bank: BankLorebook[], path: string) => bank.find((b) => b.chub?.path.toLowerCase() === path.toLowerCase());

/** The card's Chub links that aren't linked to it yet (not in the bank, or in it but not linked). */
export function missingChubLore(card: { extensions?: Record<string, unknown> }, linkedIds: string[] | undefined, bank: BankLorebook[]): ChubLoreLink[] {
  const linked = new Set(linkedIds ?? []);
  return chubLoreLinks(card).filter((l) => {
    const copy = bankCopyOf(bank, l.path);
    return !copy || !linked.has(copy.id);
  });
}
