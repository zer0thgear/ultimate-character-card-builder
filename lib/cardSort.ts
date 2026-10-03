// The card lists' order: by name, when made, when last used (edited or
// chatted with), or how much it's been chatted with. Each mode keeps its own.

import type { ProjectSummary } from '@/types/project';

export type CardSortBy = 'name' | 'created' | 'used' | 'chats' | 'messages';

export interface CardSort {
  by: CardSortBy;
  desc: boolean;
}

export const DEFAULT_CARD_SORT: CardSort = { by: 'used', desc: true };

export const CARD_SORTS: { value: CardSortBy; label: string; /** Which way it goes first when picked. */ desc: boolean }[] = [
  { value: 'used', label: 'Last used', desc: true },
  { value: 'name', label: 'Name', desc: false },
  { value: 'created', label: 'Created', desc: true },
  { value: 'chats', label: 'Chats', desc: true },
  { value: 'messages', label: 'Messages', desc: true },
];

type Sortable = Pick<ProjectSummary, 'name' | 'createdAt' | 'updatedAt' | 'lastChat' | 'chats' | 'messages'>;

/** When a card was last used: edited, or chatted with. */
export const lastUsed = (s: Pick<Sortable, 'updatedAt' | 'lastChat'>) => Math.max(s.updatedAt, s.lastChat ?? 0);

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** `cards` in that order (a new array). Ties go by name; unnamed cards are
 *  last by name either way. */
export function sortCards<T extends Sortable>(cards: T[], { by, desc }: CardSort): T[] {
  const names = (a: T, b: T) => {
    const x = a.name.trim();
    const y = b.name.trim();
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    return byName.compare(x, y);
  };
  const key = (s: T) => (by === 'created' ? s.createdAt : by === 'used' ? lastUsed(s) : by === 'chats' ? (s.chats ?? 0) : (s.messages ?? 0));
  return [...cards].sort((a, b) => {
    if (by === 'name') {
      // Unnamed stay at the bottom, whichever way.
      const both = a.name.trim() && b.name.trim();
      return both && desc ? names(b, a) : names(a, b);
    }
    const d = key(a) - key(b);
    return (desc ? -d : d) || names(a, b);
  });
}

/** What the list shows under a card for the order it's in. */
export function sortDetail(s: Sortable, by: CardSortBy): string {
  const date = (t: number) => new Date(t).toLocaleDateString();
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (by === 'created') return `Created ${date(s.createdAt)}`;
  if (by === 'chats' || by === 'messages') return `${plural(s.chats ?? 0, 'chat')} · ${plural(s.messages ?? 0, 'message')}`;
  return date(lastUsed(s));
}
