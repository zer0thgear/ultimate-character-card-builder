'use client';

import { useRef, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useUiStore } from '@/store/uiStore';
import { CARD_PAGE_SIZES, DEFAULT_CARD_PAGE_SIZE, pageOf, pageWith } from '@/lib/cardPages';
import { IconButton, Select, cx } from '@/components/ui';

// The card lists a page at a time (lib/cardPages.ts), with how many to a
// page kept between visits.

const usePageSize = create<{ size: number; setSize: (size: number) => void }>()(
  persist((set) => ({ size: DEFAULT_CARD_PAGE_SIZE, setSize: (size) => set({ size }) }), { name: 'uccb-card-pages', storage: createJSONStorage(() => localStorage) }),
);

const NO_TAGS: string[] = [];

/** A page of these cards. It goes back to the first page when the sort,
 *  the tag, my-tag or author filter or `query` changes, and to the page with
 *  `focusId` on it when that changes (another card opened). Put `listRef`
 *  on the list's scroller, so a new page starts at the top. */
export function useCardPage<T extends { id: string }>(cards: T[], { query = '', focusId }: { query?: string; focusId?: string } = {}) {
  const size = usePageSize((s) => s.size);
  const sort = useUiStore((s) => s.cardSort[s.appMode]);
  const tags = useUiStore((s) => s.cardTags?.[s.appMode]) ?? NO_TAGS;
  const author = useUiStore((s) => s.cardAuthor?.[s.appMode]) ?? '';
  const appTags = useUiStore((s) => s.cardAppTags?.[s.appMode]);
  const key = JSON.stringify([sort, tags, author, appTags, query, size]);
  const [at, setAt] = useState({ page: 0, key, focusId });
  let page = at.page;
  if (at.key !== key || at.focusId !== focusId) {
    // Adjusted while rendering (React's pattern for state that follows props).
    const focused = at.focusId !== focusId && focusId ? pageWith(cards, (c) => c.id === focusId, size) : -1;
    page = focused >= 0 ? focused : at.key !== key ? 0 : at.page;
    setAt({ page, key, focusId });
  }
  const listRef = useRef<HTMLDivElement>(null);
  const shown = pageOf(cards, page, size);
  const setPage = (p: number) => {
    setAt((a) => ({ ...a, page: p }));
    listRef.current?.scrollTo({ top: 0 });
  };
  return { pager: { ...shown, setPage, total: cards.length }, listRef };
}

/** Page buttons, and how many cards to a page: only once there are more
 *  cards than the smallest page holds. `compact` for the sidebar. */
export function CardPager({ pager, compact, className }: { pager: Pick<ReturnType<typeof useCardPage>['pager'], 'page' | 'pages' | 'total' | 'setPage'>; compact?: boolean; className?: string }) {
  const { size, setSize } = usePageSize();
  const { page, pages, total, setPage } = pager;
  if (total <= CARD_PAGE_SIZES[0]) return null;
  const first = page * size + 1;
  const last = size > 0 ? Math.min(total, (page + 1) * size) : total;
  return (
    <div className={cx('flex items-center gap-1 text-xs text-slate-400', className)}>
      {pages > 1 && (
        <>
          {!compact && (
            <IconButton title="First page" disabled={page === 0} onClick={() => setPage(0)}>
              «
            </IconButton>
          )}
          <IconButton title="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹
          </IconButton>
          <span className="whitespace-nowrap tabular-nums" title={`Cards ${first}–${last} of ${total}`}>
            {compact ? `${page + 1} / ${pages}` : `Page ${page + 1} of ${pages} · ${first}–${last} of ${total}`}
          </span>
          <IconButton title="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            ›
          </IconButton>
          {!compact && (
            <IconButton title="Last page" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>
              »
            </IconButton>
          )}
        </>
      )}
      <Select
        value={String(size)}
        onChange={(v) => setSize(Number(v))}
        title="Cards to a page"
        className={cx('ml-auto text-xs', compact ? 'w-20' : 'w-32')}
        options={CARD_PAGE_SIZES.map((n) => ({ value: String(n), label: n ? (compact ? `${n} / page` : `${n} per page`) : 'All' }))}
      />
    </div>
  );
}
