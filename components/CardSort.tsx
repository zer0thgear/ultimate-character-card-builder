'use client';

import { useMemo } from 'react';
import { useUiStore } from '@/store/uiStore';
import { CARD_SORTS, sortCards, type CardSortBy } from '@/lib/cardSort';
import { IconButton, Select, cx } from '@/components/ui';
import type { ProjectSummary } from '@/types/project';

/** The cards in the order this mode's lists are sorted by, and what by. */
export function useSortedCards<T extends ProjectSummary>(cards: T[]) {
  const sort = useUiStore((s) => s.cardSort[s.appMode]);
  const sorted = useMemo(() => sortCards(cards, sort), [cards, sort]);
  return { sorted, by: sort.by };
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
