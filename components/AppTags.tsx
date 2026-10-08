'use client';

import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '@/lib/api';
import { uuid } from '@/lib/uuid';
import { NO_TAG_FILTER, cycleFilter, importCandidates, isFolder, mergeTagBackup, openFolders, parseTagBackup, sortTags, tagUse, tagsOf, type AppTag, type FolderEntry, type TagFolder, type TagImport } from '@/lib/appTags';
import { ensureAppTags, useAppTagStore } from '@/store/appTagStore';
import { useProjectStore } from '@/store/projectStore';
import { toast, useUiStore } from '@/store/uiStore';
import { Button, IconButton, Modal, Toggle, choiceDialog, confirmDialog, cx, downloadBlob, inputClass, pickFiles } from '@/components/ui';
import type { ProjectSummary } from '@/types/project';
import type { CardData } from '@/types/card';

// App tags in the UI (lib/appTags.ts): the filter bar over the card lists,
// folders in them, the tags on each card, giving a card tags, Manage tags,
// and what importing a card does with the tags written in it.

const chipStyle = (t: Pick<AppTag, 'color' | 'color2'>) => (t.color || t.color2 ? { background: t.color || undefined, color: t.color2 || undefined } : undefined);

/** The current mode's app tag filter. */
export function useAppTagFilter() {
  const mode = useUiStore((s) => s.appMode);
  const filter = useUiStore((s) => s.cardAppTags?.[s.appMode]) ?? NO_TAG_FILTER;
  const setCardAppTags = useUiStore((s) => s.setCardAppTags);
  return { filter, set: (f: typeof filter) => setCardAppTags(mode, f) };
}

/** A tag's chip. */
export function TagChip({ tag, className, children, onClick, title }: { tag: AppTag; className?: string; children?: React.ReactNode; onClick?: (e: React.MouseEvent) => void; title?: string }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title} style={chipStyle(tag)} className={cx('inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs', !tag.color && 'bg-slate-700 text-slate-200', className)}>
      {isFolder(tag) && <span aria-hidden>{tag.folder === 'closed' ? '🗀' : '📁'}</span>}
      <span className="truncate">{tag.name}</span>
      {children}
    </Tag>
  );
}

// ─── The filter bar ──────────────────────────────────────────────────────────

/** Whether the sidebars' tag chips are tucked away (SillyTavern's "show tag
 *  list" toggle), kept between visits. */
const useSidebarTagsHidden = create<{ hidden: boolean; toggle: () => void }>()(
  persist((set) => ({ hidden: false, toggle: () => set((s) => ({ hidden: !s.hidden })) }), { name: 'uccb-sidebar-tags', storage: createJSONStorage(() => localStorage) }),
);

/** Over a card list: your app tags to filter on (a click shows only cards
 *  with it, a second hides them, a third lets them be), the folders you're
 *  in as a path back out, and Manage tags. `cards` are the list's cards,
 *  for counts. */
export function AppTagBar({ cards, compact, className }: { cards: Pick<ProjectSummary, 'id'>[]; compact?: boolean; className?: string }) {
  useEffect(ensureAppTags, []);
  const tags = useAppTagStore((s) => s.tags);
  const map = useAppTagStore((s) => s.map);
  const folders = useAppTagStore((s) => s.folders);
  const { filter, set } = useAppTagFilter();
  const { hidden: tucked, toggle: toggleTucked } = useSidebarTagsHidden();
  const use = useMemo(() => tagUse({ tags, map }, cards.map((c) => c.id)), [tags, map, cards]);
  const path = openFolders({ tags, folders }, filter);
  // Folders show as folders in the list; the bar has the rest (and any
  // folder that's filtered on some other way: hidden, or with folders off).
  const chips = sortTags(tags).filter((t) => !(folders && isFolder(t) && !filter.exclude.includes(t.id)));
  if (!tags.length) {
    return compact ? null : (
      <div className={cx('flex items-center gap-2 text-xs text-slate-500', className)}>
        <button type="button" onClick={() => openManageTags()} className="underline hover:text-slate-300" title="Your own tags (as SillyTavern's), kept apart from the tags written in the cards: filter on them, or use them as folders">
          🏷 Tags & folders
        </button>
      </div>
    );
  }
  const goTo = (i: number) => {
    // Out of every folder after the i-th (-1: all of them).
    const keep = new Set(path.slice(0, i + 1).map((t) => t.id));
    const leave = new Set(path.map((t) => t.id).filter((id) => !keep.has(id)));
    set({ ...filter, include: filter.include.filter((id) => !leave.has(id)) });
  };
  const state = (id: string) => (filter.include.includes(id) ? 'in' : filter.exclude.includes(id) ? 'out' : null);
  const any = filter.include.length + filter.exclude.length > 0;
  const tagList = compact && tucked ? (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <button type="button" onClick={toggleTucked} className="rounded px-1 hover:bg-slate-800 hover:text-slate-300" title="Show the tag list">
        🏷 My tags ▸
      </button>
      {any && (
        <>
          <span className="text-violet-300">{filter.include.length + filter.exclude.length} filtering</span>
          <button type="button" onClick={() => set(NO_TAG_FILTER)} className="underline hover:text-slate-200" title="Show every card, out of every folder">
            Clear
          </button>
        </>
      )}
    </div>
  ) : null;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {path.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-slate-400">
          <button type="button" onClick={() => goTo(-1)} className="rounded px-1 hover:bg-slate-800 hover:text-slate-200" title="Back out of the folders">
            🗂 All
          </button>
          {path.map((t, i) => (
            <span key={t.id} className="flex min-w-0 items-center gap-1">
              <span className="text-slate-600">›</span>
              <TagChip tag={t} onClick={() => goTo(i)} title={i === path.length - 1 ? 'The folder you are in' : `Back to ${t.name}`} className={i === path.length - 1 ? 'ring-1 ring-violet-400' : ''} />
            </span>
          ))}
        </div>
      )}
      {tagList ?? (
        <div className={cx('flex flex-wrap items-center gap-1', compact && 'max-h-24 overflow-y-auto')}>
          {!compact && <span className="text-xs text-slate-500">My tags:</span>}
          {chips.map((t) => {
            const s = state(t.id);
            return (
              <TagChip
                key={t.id}
                tag={t}
                onClick={() => set(cycleFilter(filter, t.id))}
                title={s === 'in' ? `Only cards tagged "${t.name}". Click to hide them instead.` : s === 'out' ? `Hiding cards tagged "${t.name}". Click to stop.` : `Only cards tagged "${t.name}" (click again to hide them)`}
                className={cx(compact ? 'text-[11px]' : '', s === 'in' && 'ring-2 ring-violet-400', s === 'out' && 'line-through opacity-60 ring-2 ring-red-400/70', !s && 'opacity-90 hover:opacity-100')}
              >
                {s === 'in' ? '✓' : s === 'out' ? '⊘' : <span className="opacity-60">{use.get(t.id) ?? 0}</span>}
              </TagChip>
            );
          })}
          {any && (
            <button type="button" onClick={() => set(NO_TAG_FILTER)} className="text-xs text-slate-400 underline hover:text-slate-200" title="Show every card, out of every folder">
              Clear
            </button>
          )}
          <IconButton title="Manage tags" onClick={() => openManageTags()} className="h-6 min-w-6 text-xs">
            ⚙
          </IconButton>
          {compact && (
            <IconButton title="Hide the tag list" onClick={toggleTucked} className="h-6 min-w-6 text-xs">
              ▴
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Folders in the lists ────────────────────────────────────────────────────

const enter = (tag: AppTag) => {
  const ui = useUiStore.getState();
  const f = ui.cardAppTags?.[ui.appMode] ?? NO_TAG_FILTER;
  ui.setCardAppTags(ui.appMode, { include: [...f.include.filter((id) => id !== tag.id), tag.id], exclude: f.exclude.filter((id) => id !== tag.id) });
};

const folderTitle = (f: FolderEntry) => `${f.tag.name}: ${f.count} card${f.count === 1 ? '' : 's'}${f.tag.folder === 'closed' ? ' (a closed folder: they show only in here)' : ''}`;

/** A folder in a card grid (the home screens). */
export function FolderTile({ folder, cards }: { folder: FolderEntry; cards: Pick<ProjectSummary, 'id' | 'avatar'>[] }) {
  const pics = folder.sample.map((id) => cards.find((c) => c.id === id)).map((c) => (c ? api.avatarUrl(c.id, c.avatar) : null));
  return (
    <button type="button" onClick={() => enter(folder.tag)} title={folderTitle(folder)} className="group flex flex-col overflow-hidden rounded-md border border-slate-800 bg-slate-900 text-left hover:border-violet-500">
      <div className="grid aspect-[2/3] w-full grid-cols-2 grid-rows-2 gap-0.5 p-1" style={folder.tag.color ? { background: folder.tag.color } : undefined}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="overflow-hidden rounded-sm bg-slate-800/70">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {pics[i] && <img src={pics[i]!} alt="" className="h-full w-full object-cover" loading="lazy" />}
          </div>
        ))}
      </div>
      <div className="px-2 py-1.5">
        <div className="truncate text-sm text-slate-200">
          {folder.tag.folder === 'closed' ? '🗀' : '📁'} {folder.tag.name}
        </div>
        <div className="text-[10px] text-slate-500">
          {folder.count} card{folder.count === 1 ? '' : 's'}
        </div>
      </div>
    </button>
  );
}

/** A folder in a sidebar's card list. */
export function FolderRow({ folder }: { folder: FolderEntry }) {
  return (
    <button type="button" onClick={() => enter(folder.tag)} title={folderTitle(folder)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-slate-900">
      <span className="flex h-10 w-7 flex-shrink-0 items-center justify-center rounded bg-slate-800 text-base" style={folder.tag.color ? { background: folder.tag.color } : undefined}>
        {folder.tag.folder === 'closed' ? '🗀' : '📁'}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-slate-200">{folder.tag.name}</span>
        <span className="block text-[10px] text-slate-500">
          {folder.count} card{folder.count === 1 ? '' : 's'}
        </span>
      </span>
    </button>
  );
}

// ─── On each card ────────────────────────────────────────────────────────────

/** A card's app tags, under its name in a list (tags set to hide on cards
 *  left out). A click on one filters on it. */
export function CardAppTags({ cardId, className }: { cardId: string; className?: string }) {
  const tags = useAppTagStore((s) => s.tags);
  const map = useAppTagStore((s) => s.map);
  const shown = useMemo(() => tagsOf({ tags, map }, cardId).filter((t) => !t.hideOnCard), [tags, map, cardId]);
  if (!shown.length) return null;
  return (
    <span className={cx('mt-0.5 block leading-4', className)}>
      {shown.map((t) => (
        <span
          key={t.id}
          style={chipStyle(t)}
          title={`Only cards tagged "${t.name}"`}
          // Inside the card's own button, so a click here mustn't open it.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const ui = useUiStore.getState();
            const f = ui.cardAppTags?.[ui.appMode] ?? NO_TAG_FILTER;
            if (!f.include.includes(t.id)) ui.setCardAppTags(ui.appMode, { include: [...f.include, t.id], exclude: f.exclude.filter((x) => x !== t.id) });
          }}
          className={cx('mr-0.5 inline-block cursor-pointer rounded-full whitespace-nowrap px-1.5 align-top text-[10px] leading-4 hover:brightness-125', !t.color && 'bg-slate-700/80 text-slate-300')}
        >
          {t.name}
        </span>
      ))}
    </span>
  );
}

/** Giving a card app tags: its tags (✕ takes one off), a box to add one
 *  (a new name makes a new tag), and the card's own tags to bring in. */
export function AppTagEditor({ cardId, cardTags }: { cardId: string; cardTags?: string[] }) {
  useEffect(ensureAppTags, []);
  const tags = useAppTagStore((s) => s.tags);
  const map = useAppTagStore((s) => s.map);
  const { addToCard, setCardTags } = useAppTagStore.getState();
  const mine = tagsOf({ tags, map }, cardId);
  const [draft, setDraft] = useState('');
  const add = (name: string) => {
    if (name.trim()) addToCard(cardId, [name]);
    setDraft('');
  };
  const others = sortTags(tags).filter((t) => !mine.includes(t));
  const fromCard = cardTags ? importCandidates(cardTags, { tags, map }, cardId) : { existing: [], fresh: [] };
  const canImport = fromCard.existing.length + fromCard.fresh.length;
  const listId = `app-tags-${cardId}`;
  return (
    <div className="flex flex-col gap-2">
      <div className={cx(inputClass, 'flex min-h-8 flex-wrap items-center gap-1 py-1')}>
        {mine.map((t) => (
          <TagChip key={t.id} tag={t}>
            <button type="button" className="opacity-60 hover:opacity-100" onClick={() => setCardTags(cardId, mine.filter((x) => x !== t).map((x) => x.id))} aria-label={`Take off ${t.name}`}>
              ×
            </button>
          </TagChip>
        ))}
        <input
          value={draft}
          list={listId}
          placeholder={mine.length ? '' : 'Add a tag…'}
          onChange={(e) => {
            const v = e.target.value;
            // Picked from the suggestions: add it straight away.
            if (others.some((t) => t.name === v)) add(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add(draft);
            }
          }}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500"
        />
        <datalist id={listId}>
          {others.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        {others.slice(0, 12).map((t) => (
          <TagChip key={t.id} tag={t} onClick={() => addToCard(cardId, [t.name])} title={`Add "${t.name}"`} className="opacity-70 hover:opacity-100">
            +
          </TagChip>
        ))}
        {canImport > 0 && (
          <Button size="sm" variant="ghost" onClick={() => addToCard(cardId, [...fromCard.existing.map((t) => t.name), ...fromCard.fresh])} title={`Add the tags written in the card: ${[...fromCard.existing.map((t) => t.name), ...fromCard.fresh].join(', ')}`}>
            ＋ From the card&apos;s tags ({canImport})
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => openManageTags()}>
          ⚙ Manage tags
        </Button>
      </div>
    </div>
  );
}

const useCardTagDialog = create<{ card: Pick<ProjectSummary, 'id' | 'name' | 'tags'> | null; set: (card: Pick<ProjectSummary, 'id' | 'name' | 'tags'> | null) => void }>((set) => ({ card: null, set: (card) => set({ card }) }));

/** Opens the tags of a card from a list. */
export const openCardTags = (card: Pick<ProjectSummary, 'id' | 'name' | 'tags'>) => useCardTagDialog.getState().set(card);

function CardTagDialog() {
  const { card, set } = useCardTagDialog();
  return (
    <Modal open={!!card} onClose={() => set(null)} title={`Tags for ${card?.name || 'Unnamed'}`} size="sm" footer={<Button onClick={() => set(null)}>Done</Button>}>
      {card && (
        <>
          <AppTagEditor cardId={card.id} cardTags={card.tags} />
          <p className="mt-3 text-xs text-slate-500">Your own tags, kept by UCCB and not written into the card. The card&apos;s own tags are on its Creator tab.</p>
        </>
      )}
    </Modal>
  );
}

// ─── Manage tags ─────────────────────────────────────────────────────────────

const useManageTags = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

export const openManageTags = () => useManageTags.getState().set(true);

const FOLDER_OPTIONS: { value: TagFolder; label: string; title: string }[] = [
  { value: 'none', label: 'Not a folder', title: 'Just a tag' },
  { value: 'open', label: '📁 Open folder', title: 'Shows as a folder; its cards show outside it too' },
  { value: 'closed', label: '🗀 Closed folder', title: 'Shows as a folder; its cards show only inside it' },
];

const IMPORT_OPTIONS: { value: TagImport; label: string }[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'all', label: 'Add them all' },
  { value: 'existing', label: 'Only tags I have' },
  { value: 'none', label: 'Leave them' },
];

function ManageTagsDialog() {
  const { open, set } = useManageTags();
  useEffect(() => {
    if (open) ensureAppTags();
  }, [open]);
  const { tags, map, folders, importMode } = useAppTagStore();
  const store = useAppTagStore.getState();
  const summaries = useProjectStore((s) => s.summaries);
  const [name, setName] = useState('');
  const use = useMemo(() => tagUse({ tags, map }, summaries.map((s) => s.id)), [tags, map, summaries]);
  const list = sortTags(tags);
  const move = (i: number, by: number) => {
    const ids = list.map((t) => t.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    store.reorder(ids);
  };
  const add = () => {
    if (!name.trim()) return;
    store.create(name);
    setName('');
  };
  const remove = async (t: AppTag) => {
    const n = use.get(t.id) ?? 0;
    if (n && !(await confirmDialog({ title: `Delete the tag "${t.name}"?`, body: `It comes off ${n} card${n === 1 ? '' : 's'}. The cards stay, and so do the tags written in them.`, confirmLabel: 'Delete', danger: true }))) return;
    store.remove(t.id);
    const ui = useUiStore.getState();
    for (const mode of ['builder', 'chat'] as const) {
      const f = ui.cardAppTags?.[mode];
      if (f && (f.include.includes(t.id) || f.exclude.includes(t.id))) ui.setCardAppTags(mode, { include: f.include.filter((x) => x !== t.id), exclude: f.exclude.filter((x) => x !== t.id) });
    }
  };
  const backup = () => {
    const d = useAppTagStore.getState();
    downloadBlob(JSON.stringify({ tags: d.tags, map: d.map }, null, 2), `uccb-tags-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };
  const restore = async () => {
    const [file] = await pickFiles('.json,application/json');
    if (!file) return;
    try {
      const parsed = parseTagBackup(JSON.parse(await file.text()));
      if (!parsed) throw new Error('That isn’t a tag backup.');
      const cur = useAppTagStore.getState();
      const { data, added } = mergeTagBackup(cur, parsed, new Set(useProjectStore.getState().summaries.map((s) => s.id)), uuid);
      store.replace(data);
      toast(added ? `Added ${added} tag${added === 1 ? '' : 's'}.` : 'You had all of those tags already.', 'success');
    } catch (err) {
      toast(`Couldn't read it: ${(err as Error).message}`, 'error');
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => set(false)}
      title="🏷 Manage tags"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={restore} title="Merge in tags from a UCCB tag backup, or SillyTavern's (its Manage tags → Backup)">
            Import…
          </Button>
          <Button variant="ghost" onClick={backup} disabled={!tags.length} title="Save your tags and which cards have them">
            Back up
          </Button>
          <Button onClick={() => set(false)}>Done</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-slate-400">
          Your own tags, as in SillyTavern: kept by UCCB, not written into the cards (the card&apos;s own tags are on its Creator tab). Filter the card lists on them, and make some folders: an open folder&apos;s cards show outside it too, a closed folder&apos;s only inside it.
        </p>
        <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-3">
          <Toggle checked={folders} onChange={(v) => store.setOptions({ folders: v })} label="Tags as folders" title="Tags set as folders show as folders in the card lists" />
          <label className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            When a card is imported, its own tags:
            <select value={importMode} onChange={(e) => store.setOptions({ importMode: e.target.value as TagImport })} className={cx(inputClass, '!w-44 py-1 text-xs')}>
              {IMPORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()} placeholder="New tag name" className={cx(inputClass, 'flex-1')} />
          <Button variant="primary" onClick={add} disabled={!name.trim()}>
            + Add tag
          </Button>
          {list.length > 1 && (
            <Button variant="ghost" onClick={() => store.reorder([...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })).map((t) => t.id))} title="Put the tags in A–Z order">
              A→Z
            </Button>
          )}
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-slate-500">No tags yet. Add one here, or on a card (🏷 in the card list, or its Creator tab).</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md bg-slate-950/40 px-2 py-1.5">
                <div className="flex flex-col">
                  <IconButton title="Up" onClick={() => move(i, -1)} disabled={i === 0} className="h-4 min-w-5 text-[10px]">
                    ▲
                  </IconButton>
                  <IconButton title="Down" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="h-4 min-w-5 text-[10px]">
                    ▼
                  </IconButton>
                </div>
                <TagChip tag={t} className="min-w-0" />
                <input value={t.name} onChange={(e) => e.target.value.trim() && store.update(t.id, { name: e.target.value })} className={cx(inputClass, '!w-auto min-w-24 flex-1 py-1 text-xs')} aria-label="Name" />
                <label className="flex items-center gap-1 text-[11px] text-slate-400" title="Chip colour">
                  <input type="color" value={t.color || '#334155'} onChange={(e) => store.update(t.id, { color: e.target.value })} className="h-6 w-7 cursor-pointer rounded border border-slate-700 bg-transparent" />
                  <input type="color" value={t.color2 || '#e2e8f0'} onChange={(e) => store.update(t.id, { color2: e.target.value })} className="h-6 w-7 cursor-pointer rounded border border-slate-700 bg-transparent" title="Text colour" />
                  {(t.color || t.color2) && (
                    <button type="button" className="underline hover:text-slate-200" onClick={() => store.update(t.id, { color: undefined, color2: undefined })}>
                      reset
                    </button>
                  )}
                </label>
                <select value={t.folder} onChange={(e) => store.update(t.id, { folder: e.target.value as TagFolder })} className={cx(inputClass, '!w-36 py-1 text-xs')} title={FOLDER_OPTIONS.find((o) => o.value === t.folder)?.title}>
                  {FOLDER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} title={o.title}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <IconButton title={t.hideOnCard ? 'Hidden on the cards in the lists (click to show)' : 'Shown on the cards in the lists (click to hide)'} onClick={() => store.update(t.id, { hideOnCard: !t.hideOnCard })}>
                  {t.hideOnCard ? '🙈' : '👁'}
                </IconButton>
                <span className="w-14 text-right text-[11px] text-slate-500">
                  {use.get(t.id) ?? 0} card{use.get(t.id) === 1 ? '' : 's'}
                </span>
                <IconButton title="Delete tag" tone="danger" onClick={() => void remove(t)}>
                  🗑
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** The dialogs, mounted once. */
export function AppTagHosts() {
  return (
    <>
      <ManageTagsDialog />
      <CardTagDialog />
    </>
  );
}

// ─── On import ───────────────────────────────────────────────────────────────

/** After cards are imported: brings the tags written in them across as app
 *  tags, as the "When a card is imported" setting says (asking, by
 *  default, as SillyTavern does). Cards imported while in a folder go in
 *  that folder too. */
export async function offerCardTags(imported: { projectId: string; card: CardData }[]) {
  if (!imported.length) return;
  const store = useAppTagStore.getState();
  if (!store.loaded) await store.load();
  const data = useAppTagStore.getState();
  const ui = useUiStore.getState();
  const inFolders = openFolders(data, ui.cardAppTags?.[ui.appMode] ?? NO_TAG_FILTER).map((t) => t.name);
  const each = imported.map((i) => ({ ...i, ...importCandidates(i.card.tags ?? [], data, i.projectId) }));
  const existing = [...new Set(each.flatMap((e) => e.existing.map((t) => t.name)))];
  const fresh = [...new Set(each.flatMap((e) => e.fresh))];
  let mode = data.importMode;
  if (mode === 'ask') {
    // Nothing to ask about: only the folders you're in.
    if (!existing.length && !fresh.length) mode = 'existing';
    else {
      const one = imported.length === 1;
      const answer = await choiceDialog({
        title: one ? `Add ${imported[0].card.name || 'the card'}'s tags to your tags?` : `Add these cards' tags to your tags?`,
        body: (
          <div className="flex flex-col gap-2">
            {existing.length > 0 && <p>Tags you have: {existing.join(', ')}</p>}
            {fresh.length > 0 && <p>New tags: {fresh.join(', ')}</p>}
            <p className="text-xs text-slate-500">They stay written in the card{one ? '' : 's'} either way. ⚙ Manage tags (over the card list) sets what happens without asking.</p>
          </div>
        ),
        choices: [
          { value: 'all', label: 'Add them all' },
          ...(existing.length ? [{ value: 'existing', label: 'Only tags I have' }] : []),
          { value: 'none', label: 'None' },
        ],
      });
      mode = (answer as TagImport | null) ?? 'none';
    }
  }
  for (const e of each) {
    const names = mode === 'all' ? [...e.existing.map((t) => t.name), ...e.fresh] : mode === 'existing' ? e.existing.map((t) => t.name) : [];
    const all = [...names, ...inFolders];
    if (all.length) useAppTagStore.getState().addToCard(e.projectId, all);
  }
}
