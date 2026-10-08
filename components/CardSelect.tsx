'use client';

import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { sortTags } from '@/lib/appTags';
import { ensureAppTags, useAppTagStore } from '@/store/appTagStore';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
import { Button, Modal, cx, inputClass } from '@/components/ui';
import { TagChip, openManageTags } from '@/components/AppTags';

// Picking many cards in a list to give them your app tags (lib/appTags.ts)
// at once. While picking, a click on a card picks it rather than opening
// it; the picks stay as you page, search and go in and out of folders.

interface CardSelection {
  active: boolean;
  ids: string[];
  start: () => void;
  stop: () => void;
  toggle: (id: string) => void;
  add: (ids: string[]) => void;
  clear: () => void;
}

export const useCardSelection = create<CardSelection>((set) => ({
  active: false,
  ids: [],
  start: () => set({ active: true, ids: [] }),
  stop: () => set({ active: false, ids: [] }),
  toggle: (id) => set((s) => ({ ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id] })),
  add: (ids) => set((s) => ({ ids: [...new Set([...s.ids, ...ids])] })),
  clear: () => set({ ids: [] }),
}));

// A switch to the other mode's lists ends the picking.
useUiStore.subscribe((s, prev) => {
  if (s.appMode !== prev.appMode && useCardSelection.getState().active) useCardSelection.getState().stop();
});

/** For a card list: whether you're picking cards, which are picked, and
 *  what a click on a card does (picks it while picking, else `open`s it). */
export function useCardPicks() {
  const picking = useCardSelection((s) => s.active);
  const ids = useCardSelection((s) => s.ids);
  return {
    picking,
    picked: (id: string) => picking && ids.includes(id),
    click: (id: string, open: () => void) => (picking ? useCardSelection.getState().toggle(id) : open()),
  };
}

/** The tick on a picked card (and the empty box on the rest), while picking. */
export function PickMark({ picked, className }: { picked: boolean; className?: string }) {
  return (
    <span aria-hidden className={cx('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border text-xs', picked ? 'border-violet-400 bg-violet-500 text-white' : 'border-slate-500 bg-slate-950/70 text-transparent', className)}>
      ✓
    </span>
  );
}

const useBulkDialog = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

/** Over a card list: "Select" to start picking cards; while picking, how
 *  many are picked, picking the page or every card shown, and tagging them.
 *  `shown` is every card the list shows (all its pages), `page` this page's. */
export function CardSelectBar({ shown, page, compact, className }: { shown: { id: string }[]; page: { id: string }[]; compact?: boolean; className?: string }) {
  const { active, ids, start, stop, add, clear } = useCardSelection();
  const summaries = useProjectStore((s) => s.summaries);
  // Picks of cards since deleted don't count.
  const picked = useMemo(() => {
    const have = new Set(summaries.map((s) => s.id));
    return ids.filter((id) => have.has(id));
  }, [ids, summaries]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useBulkDialog.getState().open) stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stop]);
  if (!active) {
    if (shown.length < 2) return null;
    return (
      <div className={cx('flex items-center text-xs', className)}>
        <button type="button" onClick={start} className="rounded px-1 text-slate-500 underline hover:text-slate-300" title="Pick cards to tag them all at once">
          ☑ Select cards
        </button>
      </div>
    );
  }
  const link = 'rounded px-1 text-slate-400 underline hover:text-slate-200 disabled:no-underline disabled:opacity-40';
  return (
    <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1.5 text-xs', className)}>
      <span className="font-medium text-violet-200">{picked.length} selected</span>
      <button type="button" className={link} onClick={() => add(page.map((c) => c.id))} disabled={!page.length} title="Select every card on this page">
        {compact ? 'Page' : 'This page'}
      </button>
      <button type="button" className={link} onClick={() => add(shown.map((c) => c.id))} disabled={!shown.length} title="Select every card the list shows, on every page">
        All {shown.length}
      </button>
      <button type="button" className={link} onClick={clear} disabled={!picked.length}>
        None
      </button>
      <span className={cx('flex gap-1', compact ? 'w-full' : 'ml-auto')}>
        <Button size="sm" variant="primary" className={compact ? 'flex-1' : ''} disabled={!picked.length} onClick={() => useBulkDialog.getState().set(true)}>
          🏷 Tag…
        </Button>
        <Button size="sm" onClick={stop} title="Stop selecting (Esc)">
          Done
        </Button>
      </span>
    </div>
  );
}

/** Tagging the picked cards: each tag on all of them, some or none, and a
 *  click puts it on them all (or, on them all already, takes it off). */
function BulkTagDialog() {
  const { open, set } = useBulkDialog();
  useEffect(() => {
    if (open) ensureAppTags();
  }, [open]);
  const ids = useCardSelection((s) => s.ids);
  const summaries = useProjectStore((s) => s.summaries);
  const tags = useAppTagStore((s) => s.tags);
  const map = useAppTagStore((s) => s.map);
  const [draft, setDraft] = useState('');
  const cards = useMemo(() => {
    const have = new Set(summaries.map((s) => s.id));
    return ids.filter((id) => have.has(id));
  }, [ids, summaries]);
  const count = (tagId: string) => cards.filter((id) => map[id]?.includes(tagId)).length;
  const store = useAppTagStore.getState();
  const addNew = () => {
    const tag = store.create(draft);
    if (tag) store.setTagOnCards(cards, tag.id, true);
    setDraft('');
  };
  const n = cards.length;
  return (
    <Modal open={open && n > 0} onClose={() => set(false)} title={`Tag ${n} card${n === 1 ? '' : 's'}`} size="sm" footer={<Button onClick={() => set(false)}>Done</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-400">Click a tag to put it on every selected card; click one they all have to take it off them all.</p>
        {tags.length === 0 ? (
          <p className="text-sm text-slate-500">No tags yet. Make one below.</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {sortTags(tags).map((t) => {
              const k = count(t.id);
              const all = k === n;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => store.setTagOnCards(cards, t.id, !all)}
                    title={all ? `Take "${t.name}" off all ${n}` : `Put "${t.name}" on all ${n}`}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-slate-800"
                  >
                    <span aria-hidden className={cx('flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px]', all ? 'border-violet-400 bg-violet-500 text-white' : k ? 'border-violet-400 text-violet-300' : 'border-slate-500 text-transparent')}>
                      {all ? '✓' : '–'}
                    </span>
                    <TagChip tag={t} className="min-w-0" />
                    <span className="ml-auto text-[11px] text-slate-500">{all ? 'all' : `${k} of ${n}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && addNew()} placeholder="Tag name (new or yours)" className={cx(inputClass, 'flex-1')} />
          <Button variant="primary" onClick={addNew} disabled={!draft.trim()}>
            + Add to all
          </Button>
        </div>
        <button type="button" onClick={() => openManageTags()} className="self-start text-xs text-slate-500 underline hover:text-slate-300">
          ⚙ Manage tags
        </button>
      </div>
    </Modal>
  );
}

/** The dialog, mounted once. */
export function CardSelectHost() {
  return <BulkTagDialog />;
}
