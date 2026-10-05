'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Lorebook, LorebookEntry } from '@/types/card';
import { useProjectStore } from '@/store/projectStore';
import { useLlmStore } from '@/store/llmStore';
import { useBridgeStore } from '@/store/bridgeStore';
import { toast } from '@/store/uiStore';
import { backfillEntryNames, entryName, hasMismatchedEntryNames, lorebookFile, newEntry, newLorebook } from '@/lib/cardSpec';
import { importLorebookFile, cardFileName } from '@/lib/cardFile';
import { DEFAULT_SCAN_DEPTH, SELECTIVE_LOGIC, entryRules, scanLorebook } from '@/lib/lorebookScan';
import { lorePlace } from '@/lib/chatPrompt';
import { lorebookEntryMessages, parseLorebookEntry } from '@/lib/assist';
import { useLlmStream } from '@/hooks/useLlmStream';
import { SortableList, arrayMove, remapIndex } from '@/components/SortableList';
import { FieldActions, useCardField, useWritingTools } from '@/components/editor/fieldTools';
import { AutoTextarea, Button, ChipInput, Empty, IconButton, Modal, NumberInput, Section, TokenBadge, Toggle, confirmDialog, cx, downloadBlob, enterSends, fileBytes, inputClass, pickFiles } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { CutOffNotice } from '@/components/llm/CutOffNotice';
import { AssistReasoning } from '@/components/llm/AssistTrace';
import { ReferenceTray, referenceConnectionId, useReferences } from '@/components/llm/References';
import { withReferences } from '@/lib/references';
import { useLorebookStore } from '@/store/lorebookStore';
import { openLorebooks, pickBankLorebook } from '@/components/LorebookBank';
import { copyFromCard, hasCardLore } from '@/lib/lorebookBank';

/** Editing a lorebook of the bank (components/LorebookBank.tsx) rather than
 *  the open card's: content is edited in place, without the card's ✨ tools. */
const StandaloneContext = createContext(false);

export function LorebookPanel() {
  const book = useProjectStore((s) => s.project?.card.data.character_book);
  const card = useProjectStore((s) => s.project?.card);
  const updateCard = useProjectStore((s) => s.updateCard);
  const projectId = useProjectStore((s) => s.project?.id);

  const setBook = (b: Lorebook | undefined, key?: string) =>
    updateCard((d) => {
      const next = { ...d, character_book: b };
      if (!b) delete next.character_book;
      return next;
    }, key);

  const importBook = async () => {
    const [file] = await pickFiles('.json,.png,.charx');
    if (!file) return;
    try {
      const imported = await importLorebookFile(file.name, await fileBytes(file));
      if (book?.entries.length) {
        const merge = await confirmDialog({
          title: 'Add to this lorebook?',
          body: `The file has ${imported.entries.length} entries. Add them after the ${book.entries.length} already here? (Cancel to keep things as they are.)`,
          confirmLabel: 'Add entries',
        });
        if (!merge) return;
        setBook({ ...book, entries: [...book.entries, ...imported.entries] });
      } else setBook(imported);
      toast(`Imported ${imported.entries.length} lorebook entries.`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  /** Puts the card's lorebook in the bank, as SillyTavern's "Import Card Lore". */
  const toBank = async () => {
    if (!projectId || !card || !hasCardLore(card.data)) return;
    const store = useLorebookStore.getState();
    if (!store.loaded) await store.load().catch(() => {});
    const before = copyFromCard(useLorebookStore.getState().books, projectId);
    if (before && !(await confirmDialog({ title: 'Update the copy in Lorebooks?', body: `This card's lorebook went into 📖 Lorebooks before. Its copy there is replaced with the lorebook as it is now.`, confirmLabel: 'Replace it' }))) return;
    try {
      const b = await store.importFromCard(projectId, card.data);
      if (b) {
        toast(before ? `Updated "${b.book.name}" in Lorebooks.` : `Added "${b.book.name}" to Lorebooks.`, 'success');
        openLorebooks(b.id);
      }
    } catch (err) {
      toast(`Couldn't add it: ${(err as Error).message}`, 'error');
    }
  };
  /** Copies a bank lorebook into the card: as its lorebook, or after its entries. */
  const fromBank = async () => {
    const picked = await pickBankLorebook('Copy a lorebook into this card');
    if (!picked) return;
    const copy = structuredClone(picked.book);
    if (book?.entries.length) {
      const merge = await confirmDialog({
        title: `Add "${picked.book.name || 'that lorebook'}" to this card's lorebook?`,
        body: `Its ${copy.entries.length} entries go after the ${book.entries.length} already here.`,
        confirmLabel: 'Add entries',
      });
      if (!merge) return;
      setBook({ ...book, entries: [...book.entries, ...copy.entries] });
    } else setBook(copy);
    toast(`Copied ${copy.entries.length} entries from "${picked.book.name || 'the lorebook'}".`, 'success');
  };

  if (!book) {
    return (
      <div className="flex flex-col gap-3">
        <Empty>
          This card has no lorebook. A lorebook holds facts that are added to the prompt only when their keywords come up in the chat.
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => setBook(newLorebook())}>
              Attach a new lorebook
            </Button>
            <Button onClick={() => void importBook()}>Import (JSON, card PNG, CHARX)</Button>
            <Button onClick={() => void fromBank()} title="Copy one of your lorebooks (📖 Lorebooks) into this card">
              📖 From Lorebooks…
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  return (
    <LorebookEditor
      book={book}
      setBook={setBook}
      actions={
        <>
          <Button size="sm" onClick={() => void importBook()}>
            Import…
          </Button>
          <Button size="sm" onClick={() => void fromBank()} title="Add the entries of one of your lorebooks (📖 Lorebooks) to this one">
            📖 Add from…
          </Button>
          <Button size="sm" disabled={!book.entries.length} onClick={() => void toBank()} title="Put a copy of this lorebook in 📖 Lorebooks, to attach to chats, personas or every chat">
            📖 To Lorebooks
          </Button>
          <Button size="sm" onClick={() => downloadBlob(JSON.stringify(lorebookFile(book), null, 2), `${book.name || (card ? cardFileName(card) : 'lorebook')} lorebook.json`, 'application/json')}>
            Export
          </Button>
          <IconButton
            title="Remove the lorebook from this card"
            tone="danger"
            onClick={async () => {
              if (await confirmDialog({ title: 'Remove this lorebook?', body: `All ${book.entries.length} entries go with it. Undo brings it back.`, confirmLabel: 'Remove', danger: true })) setBook(undefined);
            }}
          >
            🗑
          </IconButton>
        </>
      }
    />
  );
}

/**
 * A lorebook's settings, entries and key tester: the card's (LorebookPanel)
 * or, with `standalone`, one in the bank. `setBook`'s key groups typing
 * into one undo step where the caller has undo.
 */
export function LorebookEditor({ book, setBook, actions, standalone = false }: { book: Lorebook; setBook: (b: Lorebook, key?: string) => void; actions?: ReactNode; standalone?: boolean }) {
  const loreDepth = useLlmStore((s) => s.chatSettings.loreScanDepth ?? DEFAULT_SCAN_DEPTH);
  const loreBudget = useLlmStore((s) => s.chatSettings.loreTokenBudget ?? 0);
  return (
    <StandaloneContext.Provider value={standalone}>
      <div className="flex flex-col gap-5">
        {hasMismatchedEntryNames(book) && (
          <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <span className="flex-1">Some entries have a name but no comment (or the other way round). Chub shows names and SillyTavern shows comments.</span>
            <Button size="sm" onClick={() => setBook(backfillEntryNames(book))}>
              Fill in the blanks
            </Button>
          </div>
        )}
        <Section title="Lorebook" actions={actions}>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={book.name ?? ''} onChange={(e) => setBook({ ...book, name: e.target.value }, 'book.name')} placeholder="Lorebook name" className={inputClass} />
            <input value={book.description ?? ''} onChange={(e) => setBook({ ...book, description: e.target.value }, 'book.description')} placeholder="Description" className={inputClass} />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex w-32 flex-col gap-0.5 text-xs text-slate-400" title={`How many recent messages are searched for keys. Blank: whatever the frontend defaults to (the test chat's is ${loreDepth}, set in its 🔧 Chat settings).`}>
              Scan depth
              <NumberInput value={book.scan_depth} onChange={(v) => setBook({ ...book, scan_depth: v })} min={0} step={1} allowEmpty placeholder={`default (${loreDepth})`} />
            </label>
            <label className="flex w-32 flex-col gap-0.5 text-xs text-slate-400" title={`Most tokens the lorebook may add per message. Blank: whatever the frontend defaults to (the test chat's is ${loreBudget ? loreBudget : 'no limit'}, set in its 🔧 Chat settings).`}>
              Token budget
              <NumberInput value={book.token_budget} onChange={(v) => setBook({ ...book, token_budget: v })} min={0} step={50} allowEmpty placeholder={`default (${loreBudget ? loreBudget : 'none'})`} />
            </label>
            <Toggle checked={!!book.recursive_scanning} onChange={(v) => setBook({ ...book, recursive_scanning: v })} label="Recursive scanning" title="Entries' content can trigger other entries" />
          </div>
        </Section>
        <Entries book={book} setBook={setBook} />
        <KeyTester book={book} />
      </div>
    </StandaloneContext.Provider>
  );
}

function Entries({ book, setBook }: { book: Lorebook; setBook: (b: Lorebook, key?: string) => void }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [writing, setWriting] = useState(false);
  const standalone = useContext(StandaloneContext);
  const writingTools = useWritingTools() && !standalone;
  const entries = book.entries;
  const setEntries = (next: LorebookEntry[], key?: string) => setBook({ ...book, entries: next }, key);
  const setEntry = (i: number, patch: Partial<LorebookEntry>, key?: string) => setEntries(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)), key && `entry.${i}.${key}`);

  const q = filter.trim().toLowerCase();
  const visible = (e: LorebookEntry) => !q || entryName(e).toLowerCase().includes(q) || e.keys.some((k) => k.toLowerCase().includes(q)) || e.content.toLowerCase().includes(q);

  const add = (entry?: Partial<LorebookEntry>) => {
    setEntries([...entries, { ...newEntry(entries), ...entry }]);
    setOpen((s) => new Set(s).add(entries.length));
    setFilter('');
  };
  const move = (from: number, to: number) => {
    setEntries(arrayMove(entries, from, to));
    setOpen((s) => new Set([...s].map((i) => remapIndex(i, from, to))));
  };
  const remove = async (i: number) => {
    if (entries[i].content.trim() && !(await confirmDialog({ title: `Delete "${entryName(entries[i]) || `entry ${i + 1}`}"?`, body: standalone ? "It's gone for good." : 'Undo brings it back.', confirmLabel: 'Delete', danger: true }))) return;
    setEntries(entries.filter((_, j) => j !== i));
    setOpen((s) => new Set([...s].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
  };
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <Section
      title={`Entries (${entries.length})`}
      actions={
        <>
          {entries.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(open.size ? new Set() : new Set(entries.map((_, i) => i)))}>
              {open.size ? 'Fold all' : 'Unfold all'}
            </Button>
          )}
          {writingTools && (
            <Button size="sm" onClick={() => setWriting(true)}>
              ✨ Write one
            </Button>
          )}
          <Button size="sm" onClick={() => add()}>
            + Add
          </Button>
        </>
      }
    >
      {entries.length > 3 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, key or content…" className={inputClass} />}
      {entries.length === 0 ? (
        <Empty>No entries yet.</Empty>
      ) : (
        <SortableList count={entries.length} onMove={move}>
          {(i, handle) => {
            const e = entries[i];
            if (!visible(e)) return null;
            return (
              <div className={cx('rounded-md border border-slate-800 bg-slate-900/60', e.enabled === false && 'opacity-60')}>
                <div className="flex items-center gap-1 px-1 py-1">
                  {q ? <span className="w-5" /> : handle}
                  <Toggle checked={e.enabled !== false} onChange={(v) => setEntry(i, { enabled: v })} title={e.enabled === false ? 'Disabled' : 'Enabled'} />
                  <button type="button" className="ml-1 flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggle(i)}>
                    <span className="text-xs text-slate-500">{open.has(i) ? '▾' : '▸'}</span>
                    <span className="truncate text-sm text-slate-200">{entryName(e) || <em className="text-slate-500">unnamed</em>}</span>
                    {e.constant ? (
                      <span className="rounded bg-violet-500/15 px-1.5 text-[10px] text-violet-300">always</span>
                    ) : (
                      <span className="min-w-0 truncate text-xs text-slate-500">{e.keys.join(', ') || 'no keys'}</span>
                    )}
                  </button>
                  <TokenBadge text={e.content} className="mx-1" />
                  <IconButton title="Delete entry" tone="danger" onClick={() => void remove(i)}>
                    🗑
                  </IconButton>
                </div>
                {open.has(i) && <EntryEditor index={i} entry={e} setEntry={(patch, key) => setEntry(i, patch, key)} />}
              </div>
            );
          }}
        </SortableList>
      )}
      {writing && <WriteEntryDialog onClose={() => setWriting(false)} onAdd={(e) => add(e)} />}
    </Section>
  );
}

function EntryEditor({ index, entry: e, setEntry }: { index: number; entry: LorebookEntry; setEntry: (patch: Partial<LorebookEntry>, key?: string) => void }) {
  const standalone = useContext(StandaloneContext);
  const [cardContent, setCardContent] = useCardField(`character_book.entries.${index}.content`);
  const content = standalone ? e.content : cardContent;
  const setContent = standalone ? (v: string) => setEntry({ content: v }, 'content') : setCardContent;
  // Art is Builder's: Chat mode's card drawer leaves it out.
  const writingTools = useWritingTools() && !standalone;
  const requestEntryPrompt = useBridgeStore((s) => s.requestEntryPrompt);
  const rules = entryRules(e);
  /** Sets SillyTavern's settings in the entry's extensions; undefined removes one. */
  const setExt = (patch: Record<string, unknown>, key?: string) => {
    const extensions = { ...e.extensions, ...patch };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete extensions[k];
    setEntry({ extensions }, key);
  };
  const numExt = (k: string) => (typeof e.extensions[k] === 'number' ? (e.extensions[k] as number) : undefined);
  return (
    <div className="flex flex-col gap-3 border-t border-slate-800 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Name <span className="text-slate-500">(kept in step with comment)</span>
          <input value={entryName(e)} onChange={(ev) => setEntry({ name: ev.target.value, comment: ev.target.value }, 'name')} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Position
          <select
            value={lorePlace(e)}
            onChange={(ev) => {
              const place = ev.target.value;
              // SillyTavern reads its own number; the spec reads `position`.
              setEntry({ position: place === 'after' ? 'after_char' : 'before_char', extensions: { ...e.extensions, position: place === 'after' ? 1 : place === 'depth' ? 4 : 0 } });
            }}
            className={cx(inputClass, 'py-1')}
          >
            <option value="before">Before the character</option>
            <option value="after">After the character</option>
            <option value="depth">In the chat, at a depth</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Keys <span className="text-slate-500">(any one fires it; /regex/ works)</span>
        <ChipInput values={e.keys} onChange={(keys) => setEntry({ keys })} placeholder="keyword, another keyword" />
      </label>
      <div className="flex flex-col gap-1">
        <Toggle checked={!!e.selective} onChange={(selective) => setEntry({ selective })} label={<span className="text-xs">Also check secondary keys</span>} />
        {e.selective && (
          <div className="flex flex-col gap-1">
            <select value={rules.logic} onChange={(ev) => setExt({ selectiveLogic: Number(ev.target.value) })} className={cx(inputClass, 'w-auto self-start py-1 text-xs')} title="How the secondary keys decide, as SillyTavern's logic does">
              <option value={SELECTIVE_LOGIC.andAny}>And any: one of them is there too</option>
              <option value={SELECTIVE_LOGIC.andAll}>And all: every one of them is there too</option>
              <option value={SELECTIVE_LOGIC.notAny}>Not any: none of them is there</option>
              <option value={SELECTIVE_LOGIC.notAll}>Not all: not every one of them is there</option>
            </select>
            <ChipInput values={e.secondary_keys ?? []} onChange={(secondary_keys) => setEntry({ secondary_keys })} placeholder="secondary keys" />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="Lower goes earlier in the prompt">
          Insertion order
          <NumberInput value={e.insertion_order} onChange={(v) => setEntry({ insertion_order: v ?? 0 })} step={1} />
        </label>
        <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="Past the token budget, lower priority is dropped first">
          Priority
          <NumberInput value={e.priority} onChange={(v) => setEntry({ priority: v })} step={1} allowEmpty placeholder="—" />
        </label>
        <Toggle checked={!!e.constant} onChange={(constant) => setEntry({ constant })} label={<span className="text-xs">Always on</span>} />
        <Toggle checked={!!e.case_sensitive} onChange={(case_sensitive) => setEntry({ case_sensitive })} label={<span className="text-xs">Case-sensitive</span>} />
        <Toggle checked={!!e.use_regex} onChange={(use_regex) => setEntry({ use_regex })} label={<span className="text-xs">Keys are regex</span>} />
      </div>
      {lorePlace(e) === 'depth' && (
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="Messages from the end of the chat: 0 goes after the last one">
            Depth
            <NumberInput value={numExt('depth') ?? 4} onChange={(v) => setExt({ depth: v ?? 4 })} min={0} step={1} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-slate-400">
            Role
            <select value={numExt('role') ?? 0} onChange={(ev) => setExt({ role: Number(ev.target.value) })} className={cx(inputClass, 'py-1')}>
              <option value={0}>System</option>
              <option value={1}>User</option>
              <option value={2}>Assistant</option>
            </select>
          </label>
        </div>
      )}
      <details className="rounded border border-slate-800 px-2 py-1.5" open={hasStRules(e)}>
        <summary className="cursor-pointer text-xs text-slate-400">More rules (as SillyTavern has them){hasStRules(e) ? ' · set' : ''}</summary>
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="The chance it goes in when it fires, rolled each time">
              Trigger %
              <NumberInput value={rules.chance} onChange={(v) => setExt({ probability: v ?? 100, useProbability: (v ?? 100) < 100 })} min={0} max={100} step={1} />
            </label>
            <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="Messages it stays in for once it fires, keys or not">
              Sticky
              <NumberInput value={rules.sticky || undefined} onChange={(v) => setExt({ sticky: v || undefined })} min={0} step={1} allowEmpty placeholder="—" />
            </label>
            <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="Messages it can't fire for after it has (after it stops sticking)">
              Cooldown
              <NumberInput value={rules.cooldown || undefined} onChange={(v) => setExt({ cooldown: v || undefined })} min={0} step={1} allowEmpty placeholder="—" />
            </label>
            <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="Messages the chat needs (the greeting counted) before it can fire">
              Delay
              <NumberInput value={rules.delay || undefined} onChange={(v) => setExt({ delay: v || undefined })} min={0} step={1} allowEmpty placeholder="—" />
            </label>
            <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="Messages scanned for its keys, in place of the lorebook's scan depth">
              Scan depth
              <NumberInput value={rules.scanDepth} onChange={(v) => setExt({ scan_depth: v })} min={0} step={1} allowEmpty placeholder="book's" />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex min-w-40 flex-1 flex-col gap-0.5 text-xs text-slate-400" title="Of the entries in a group that fire together, only one goes in. Several groups: separate them with commas">
              Inclusion group
              <input value={typeof e.extensions.group === 'string' ? e.extensions.group : ''} onChange={(ev) => setExt({ group: ev.target.value || undefined }, 'group')} className={cx(inputClass, 'py-1')} placeholder="none" />
            </label>
            <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="How likely it is to be the one picked from its group">
              Group weight
              <NumberInput value={rules.groupWeight} onChange={(v) => setExt({ group_weight: v ?? 100 })} min={0} step={1} />
            </label>
            <Toggle checked={rules.groupOverride} onChange={(v) => setExt({ group_override: v || undefined })} title="Picked over the rest of its group (by insertion order, if several are)" label={<span className="text-xs">Prioritize in group</span>} />
            <Toggle checked={rules.groupScoring} onChange={(v) => setExt({ use_group_scoring: v || undefined })} title="The group's entries with the most matching keys are picked from" label={<span className="text-xs">Group scoring</span>} />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-0.5 text-xs text-slate-400">
              Whole words
              <select value={rules.wholeWords === undefined ? '' : String(rules.wholeWords)} onChange={(ev) => setExt({ match_whole_words: ev.target.value === '' ? undefined : ev.target.value === 'true' })} className={cx(inputClass, 'py-1')}>
                <option value="">Default (yes)</option>
                <option value="true">Yes</option>
                <option value="false">No: &quot;cat&quot; fires on &quot;concatenate&quot;</option>
              </select>
            </label>
            <Toggle checked={rules.excludeRecursion} onChange={(v) => setExt({ exclude_recursion: v || undefined })} title="Only the chat fires it, never another entry's content" label={<span className="text-xs">Not fired by other entries</span>} />
            <Toggle checked={rules.preventRecursion} onChange={(v) => setExt({ prevent_recursion: v || undefined })} title="Its content isn't scanned for other entries' keys" label={<span className="text-xs">Doesn&apos;t fire others</span>} />
            <Toggle checked={rules.delayUntilRecursion > 0} onChange={(v) => setExt({ delay_until_recursion: v || undefined })} title="Only another entry's content fires it, never the chat directly" label={<span className="text-xs">Only fired by other entries</span>} />
            <Toggle checked={rules.ignoreBudget} onChange={(v) => setExt({ ignore_budget: v || undefined })} title="Goes in even past the lorebook's token budget" label={<span className="text-xs">Ignore the budget</span>} />
          </div>
          <p className="text-[11px] text-slate-500">These are saved the way SillyTavern saves them in a card, and the test chat follows them. Chub and other frontends may ignore them.</p>
        </div>
      </details>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Content</span>
          <div className="flex items-center gap-1">
            <TokenBadge text={content} />
            {writingTools && (
              <IconButton
                title="Image prompt: write a character prompt for whoever this entry describes, in the Image tab (their own slot, or a new one)"
                disabled={!content.trim()}
                onClick={() => requestEntryPrompt({ name: entryName(e), content })}
              >
                🎨
              </IconButton>
            )}
            {!standalone && <FieldActions path={`character_book.entries.${index}.content`} />}
          </div>
        </div>
        <AutoTextarea value={content} onChange={(ev) => setContent(ev.target.value)} minRows={3} maxRows={20} />
      </div>
    </div>
  );
}

/** Whether any of SillyTavern's extra rules is set on the entry. */
function hasStRules(e: LorebookEntry) {
  const r = entryRules(e);
  return r.chance < 100 || r.sticky > 0 || r.cooldown > 0 || r.delay > 0 || r.scanDepth !== undefined || r.groups.length > 0 || r.wholeWords === false || r.excludeRecursion || r.preventRecursion || r.delayUntilRecursion > 0 || r.ignoreBudget;
}

function KeyTester({ book }: { book: Lorebook }) {
  const [text, setText] = useState('');
  const result = useMemo(() => (text.trim() ? scanLorebook(book, [text], { scanDepth: 1, random: () => 0 }) : null), [book, text]);
  return (
    <Section title="Try the keys">
      <AutoTextarea value={text} onChange={(e) => setText(e.target.value)} minRows={2} maxRows={8} placeholder="Type or paste a message to see which entries it would fire…" />
      {result && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {result.active.length === 0 && <span className="text-slate-500">Nothing fires.</span>}
          {result.active.map((a) => (
            <span key={a.index} className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-300" title={`Matched: ${a.reason}`}>
              {entryName(a.entry) || `Entry ${a.index + 1}`} <span className="text-emerald-400/60">· {a.reason}</span>
            </span>
          ))}
          {result.skipped?.map((a) => (
            <span key={a.index} className="rounded bg-slate-500/15 px-2 py-0.5 text-slate-400" title="Matched, but left out">
              {entryName(a.entry) || `Entry ${a.index + 1}`} · {a.reason}
            </span>
          ))}
          {result.dropped.map((a) => (
            <span key={a.index} className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-300" title="Fired, but over the token budget">
              {entryName(a.entry) || `Entry ${a.index + 1}`} · over budget
            </span>
          ))}
        </div>
      )}
    </Section>
  );
}

function WriteEntryDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (e: Partial<LorebookEntry>) => void }) {
  const card = useProjectStore((s) => s.project?.card.data);
  const { assistConnectionId, setAssistConnection } = useLlmStore();
  const [topic, setTopic] = useState('');
  const { runAssist, continueAssist, retryWithMoreRoom, cutOff, runId, stop, text, reasoning, running, error } = useLlmStream();
  const parsed = parseLorebookEntry(text);
  const refs = useReferences();
  if (!card) return null;
  const write = () => void runAssist(withReferences(lorebookEntryMessages(card, topic), refs.refs), undefined, '✨ Lorebook entry', { connectionId: referenceConnectionId(refs.refs) });
  return (
    <Modal
      open
      onClose={() => {
        stop();
        onClose();
      }}
      title="✨ Write a lorebook entry"
      size="lg"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            disabled={!parsed || running}
            onClick={() => {
              if (!parsed) return;
              onAdd({ name: parsed.name, comment: parsed.name, keys: parsed.keys, content: parsed.content });
              onClose();
            }}
          >
            Add entry
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <AutoTextarea
            autoFocus
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onPaste={refs.onPaste}
            onKeyDown={(e) => {
              if (enterSends(e)) {
                e.preventDefault();
                if (topic.trim() && !running) write();
              }
            }}
            minRows={1}
            maxRows={8}
            placeholder='What about? e.g. "her hometown", "the royal guard"'
            className="flex-1"
          />
          {running ? (
            <Button variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <>
              <Button variant="primary" disabled={!topic.trim()} onClick={write}>
                Write
              </Button>
              {text.trim() && (
                <Button onClick={() => void continueAssist(text)} title="Carry on writing the entry from where it stopped">
                  → Continue
                </Button>
              )}
            </>
          )}
        </div>
        <ReferenceTray refs={refs.refs} onAdd={refs.add} onRemove={refs.remove} />
        <ConnectionPicker value={assistConnectionId} onChange={setAssistConnection} label="Assistant connection" />
        {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
        <CutOffNotice show={cutOff && !running} hasText={!!text.trim()} reasoning={reasoning} onRetry={() => void retryWithMoreRoom()} />
        <AssistReasoning runId={runId} />
        {text && (
          <div className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm">
            {parsed ? (
              <>
                <div className="font-medium text-slate-200">{parsed.name}</div>
                <div className="mb-2 text-xs text-slate-500">Keys: {parsed.keys.join(', ')}</div>
                <div className="whitespace-pre-wrap text-slate-300">{parsed.content}</div>
              </>
            ) : (
              <div className="whitespace-pre-wrap text-slate-400">{text}</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
