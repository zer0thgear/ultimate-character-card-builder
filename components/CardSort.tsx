'use client';

import { useMemo, useState } from 'react';
import { useUiStore } from '@/store/uiStore';
import { CARD_SORTS, byAuthor, sortCards, tagCounts, withTags, type CardSortBy } from '@/lib/cardSort';
import { IconButton, Select, cx } from '@/components/ui';
import type { ProjectSummary } from '@/types/project';

/** The cards in the order this mode's lists are sorted by, and what by. */
export function useSortedCards<T extends ProjectSummary>(cards: T[]) {
  const sort = useUiStore((s) => s.cardSort[s.appMode]);
  const tags = useUiStore((s) => s.cardTags?.[s.appMode]) ?? NO_TAGS;
  const author = useUiStore((s) => s.cardAuthor?.[s.appMode]) ?? '';
  const sorted = useMemo(() => sortCards(byAuthor(withTags(cards, tags), author), sort), [cards, sort, tags, author]);
  return { sorted, by: sort.by, filtered: tags.length > 0 || !!author, total: cards.length };
}

const NO_TAGS: string[] = [];

/** The tags to filter the cards by, as chips: the commonest first, the
 *  rest a click away. Picking several shows cards that have them all. */
export function TagFilter({ cards, className }: { cards: Pick<ProjectSummary, 'tags' | 'creator'>[]; className?: string }) {
  const mode = useUiStore((s) => s.appMode);
  const picked = useUiStore((s) => s.cardTags?.[s.appMode]) ?? NO_TAGS;
  const setCardTags = useUiStore((s) => s.setCardTags);
  const [all, setAll] = useState(false);
  // Counts among the cards the other picked tags leave, so a chip says
  // what picking it would show.
  const author = useUiStore((s) => s.cardAuthor?.[s.appMode]) ?? '';
  const setCardAuthor = useUiStore((s) => s.setCardAuthor);
  const counts = useMemo(() => tagCounts(withTags(byAuthor(cards, author), picked)), [cards, picked, author]);
  if (!counts.length && !picked.length && !author) return null;
  const isPicked = (t: string) => picked.some((p) => p.toLowerCase() === t.toLowerCase());
  const toggle = (t: string) => setCardTags(mode, isPicked(t) ? picked.filter((p) => p.toLowerCase() !== t.toLowerCase()) : [...picked, t]);
  const LIMIT = 16;
  const rest = counts.filter((c) => !isPicked(c.tag));
  const shown = all ? rest : rest.slice(0, LIMIT);
  return (
    <div className={cx('flex flex-wrap items-center gap-1.5', className)}>
      {author && (
        <button type="button" onClick={() => setCardAuthor(mode, '')} className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs text-sky-200 hover:bg-sky-500/30" title="Show every author's cards">
          by {author} ✕
        </button>
      )}
      {(shown.length > 0 || picked.length > 0) && <span className="text-xs text-slate-500">Tags:</span>}
      {picked.map((t) => (
        <button key={t} type="button" onClick={() => toggle(t)} className="rounded-full bg-violet-500/25 px-2 py-0.5 text-xs text-violet-200 hover:bg-violet-500/35" title="Stop filtering by this tag">
          {t} ✕
        </button>
      ))}
      {shown.map((c) => (
        <button key={c.tag} type="button" onClick={() => toggle(c.tag)} className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700" title={picked.length ? `Only cards that also have "${c.tag}"` : `Only cards tagged "${c.tag}"`}>
          {c.tag} <span className="text-slate-500">{c.count}</span>
        </button>
      ))}
      {rest.length > LIMIT && (
        <button type="button" onClick={() => setAll(!all)} className="text-xs text-slate-400 underline hover:text-slate-200">
          {all ? 'Fewer' : `${rest.length - LIMIT} more`}
        </button>
      )}
      {picked.length > 0 && (
        <button type="button" onClick={() => setCardTags(mode, [])} className="text-xs text-slate-400 underline hover:text-slate-200">
          Clear
        </button>
      )}
    </div>
  );
}

/** In a card list: says a tag or author filter is on, with a way to clear it. */
export function TagFilterNote({ className }: { className?: string }) {
  const mode = useUiStore((s) => s.appMode);
  const picked = useUiStore((s) => s.cardTags?.[s.appMode]) ?? NO_TAGS;
  const setCardTags = useUiStore((s) => s.setCardTags);
  const author = useUiStore((s) => s.cardAuthor?.[s.appMode]) ?? '';
  const setCardAuthor = useUiStore((s) => s.setCardAuthor);
  if (!picked.length && !author) return null;
  const note = 'truncate rounded px-2 py-0.5 text-left text-[11px]';
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {author && (
        <button type="button" onClick={() => setCardAuthor(mode, '')} className={cx(note, 'bg-sky-500/15 text-sky-200 hover:bg-sky-500/25')} title="Show every author's cards">
          ✍ by {author} ✕
        </button>
      )}
      {picked.length > 0 && (
        <button type="button" onClick={() => setCardTags(mode, [])} className={cx(note, 'bg-violet-500/15 text-violet-200 hover:bg-violet-500/25')} title="Show every card">
          🏷 {picked.join(', ')} ✕
        </button>
      )}
    </div>
  );
}

/** Sort by ▾ and which way (each mode keeps its own). */
export function CardSortControl({ className }: { className?: string }) {
  const mode = useUiStore((s) => s.appMode);
  const sort = useUiStore((s) => s.cardSort[s.appMode]);
  const setCardSort = useUiStore((s) => s.setCardSort);
  const pick = (by: CardSortBy) => setCardSort(mode, { by, desc: CARD_SORTS.find((o) => o.value === by)?.desc ?? false });
  const label = sort.by === 'name' ? (sort.desc ? 'Z→A' : 'A→Z') : sort.desc ? (sort.by === 'created' || sort.by === 'used' ? 'Newest first' : 'Most first') : sort.by === 'created' || sort.by === 'used' ? 'Oldest first' : 'Fewest first';
  return (
    <div className={cx('flex items-center gap-1', className)}>
      <Select value={sort.by} onChange={pick} options={CARD_SORTS} title="Sort the cards by" className="min-w-0 flex-1 text-xs" />
      <IconButton title={`${label} (click to reverse)`} onClick={() => setCardSort(mode, { ...sort, desc: !sort.desc })} className="flex-shrink-0">
        {sort.desc ? '↓' : '↑'}
      </IconButton>
    </div>
  );
}
