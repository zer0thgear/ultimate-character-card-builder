// The card lists' order: by name, when made, when last used (edited or
// chatted with), or how much it's been chatted with. Each mode keeps its own.

import type { ProjectSummary } from '@/types/project';
import { formatTokens } from '@/lib/textTokens';

export type CardSortBy = 'name' | 'created' | 'used' | 'chats' | 'messages' | 'tokens';

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
  { value: 'tokens', label: 'Tokens', desc: true },
];

type Sortable = Pick<ProjectSummary, 'name' | 'createdAt' | 'updatedAt' | 'lastChat' | 'chats' | 'messages' | 'sent' | 'received' | 'tokens'>;

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
  const key = (s: T) => (by === 'created' ? s.createdAt : by === 'used' ? lastUsed(s) : by === 'chats' ? (s.chats ?? 0) : by === 'tokens' ? (s.tokens ?? 0) : (s.messages ?? 0));
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

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** How much a card's been chatted with: its chats, the messages sent and
 *  received in them, and their tokens. */
export function chatStatsDetail(s: Pick<Sortable, 'chats' | 'sent' | 'received' | 'tokens'>): string {
  return `${plural(s.chats ?? 0, 'chat')} · ${s.sent ?? 0} sent · ${s.received ?? 0} received · ${formatTokens(s.tokens ?? 0)} tokens`;
}

/** What the list shows under a card for the order it's in. */
export function sortDetail(s: Sortable, by: CardSortBy): string {
  const date = (t: number) => new Date(t).toLocaleDateString();
  if (by === 'created') return `Created ${date(s.createdAt)}`;
  if (by === 'chats') return `${plural(s.chats ?? 0, 'chat')} · ${plural(s.messages ?? 0, 'message')}`;
  if (by === 'messages') return `${plural(s.messages ?? 0, 'message')} · ${s.sent ?? 0} sent · ${s.received ?? 0} received`;
  if (by === 'tokens') return `${formatTokens(s.tokens ?? 0)} tokens · ${plural(s.messages ?? 0, 'message')}`;
  return date(lastUsed(s));
}

// ─── Tags ────────────────────────────────────────────────────────────────────

/** Every tag on the cards with how many have it, most used first (then A–Z).
 *  Tags are matched without regard to case; the commonest spelling shows. */
export function tagCounts(cards: Pick<ProjectSummary, 'tags'>[]): { tag: string; count: number }[] {
  const by = new Map<string, { spellings: Map<string, number>; count: number }>();
  for (const c of cards) {
    for (const t of new Set(c.tags.map((x) => x.trim()).filter(Boolean))) {
      const key = t.toLowerCase();
      const e = by.get(key) ?? { spellings: new Map(), count: 0 };
      e.count++;
      e.spellings.set(t, (e.spellings.get(t) ?? 0) + 1);
      by.set(key, e);
    }
  }
  return [...by.values()]
    .map((e) => ({ tag: [...e.spellings].sort((a, b) => b[1] - a[1])[0][0], count: e.count }))
    .sort((a, b) => b.count - a.count || byName.compare(a.tag, b.tag));
}

/** The cards that have every one of `tags` (any case). */
export function withTags<T extends Pick<ProjectSummary, 'tags'>>(cards: T[], tags: string[]): T[] {
  if (!tags.length) return cards;
  const want = tags.map((t) => t.toLowerCase());
  return cards.filter((c) => {
    const have = new Set(c.tags.map((t) => t.trim().toLowerCase()));
    return want.every((t) => have.has(t));
  });
}
