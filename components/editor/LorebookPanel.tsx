'use client';

import { useMemo, useState } from 'react';
import type { Lorebook, LorebookEntry } from '@/types/card';
import { useProjectStore } from '@/store/projectStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { backfillEntryNames, entryName, hasMismatchedEntryNames, lorebookFile, newEntry, newLorebook } from '@/lib/cardSpec';
import { importLorebookFile, cardFileName } from '@/lib/cardFile';
import { scanLorebook } from '@/lib/lorebookScan';
import { lorebookEntryMessages, parseLorebookEntry } from '@/lib/assist';
import { useLlmStream } from '@/hooks/useLlmStream';
import { SortableList, arrayMove, remapIndex } from '@/components/SortableList';
import { FieldActions, useCardField } from '@/components/editor/fieldTools';
import { AutoTextarea, Button, ChipInput, Empty, IconButton, Modal, NumberInput, Section, TokenBadge, Toggle, confirmDialog, cx, downloadBlob, fileBytes, inputClass, pickFiles } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { AssistReasoning } from '@/components/llm/AssistTrace';
import { ReferenceTray, referenceConnectionId, useReferences } from '@/components/llm/References';
import { withReferences } from '@/lib/references';

export function LorebookPanel() {
  const book = useProjectStore((s) => s.project?.card.data.character_book);
  const card = useProjectStore((s) => s.project?.card);
  const updateCard = useProjectStore((s) => s.updateCard);

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

  if (!book) {
    return (
      <div className="flex flex-col gap-3">
        <Empty>
          This card has no lorebook. A lorebook holds facts that are added to the prompt only when their keywords come up in the chat.
          <div className="mt-3 flex justify-center gap-2">
            <Button variant="primary" onClick={() => setBook(newLorebook())}>
              Attach a new lorebook
            </Button>
            <Button onClick={() => void importBook()}>Import (JSON, card PNG, CHARX)</Button>
          </div>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {hasMismatchedEntryNames(book) && (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <span className="flex-1">Some entries have a name but no comment (or the other way round). Chub shows names and SillyTavern shows comments.</span>
          <Button size="sm" onClick={() => setBook(backfillEntryNames(book))}>
            Fill in the blanks
          </Button>
        </div>
      )}
      <Section
        title="Lorebook"
        actions={
          <>
            <Button size="sm" onClick={() => void importBook()}>
              Import…
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
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={book.name ?? ''} onChange={(e) => setBook({ ...book, name: e.target.value }, 'book.name')} placeholder="Lorebook name" className={inputClass} />
          <input value={book.description ?? ''} onChange={(e) => setBook({ ...book, description: e.target.value }, 'book.description')} placeholder="Description" className={inputClass} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex w-32 flex-col gap-0.5 text-xs text-slate-400" title="How many recent messages are searched for keys (frontend default if empty, usually 2)">
            Scan depth
            <NumberInput value={book.scan_depth} onChange={(v) => setBook({ ...book, scan_depth: v })} min={0} step={1} allowEmpty placeholder="default" />
          </label>
          <label className="flex w-32 flex-col gap-0.5 text-xs text-slate-400" title="Most tokens the lorebook may add per message">
            Token budget
            <NumberInput value={book.token_budget} onChange={(v) => setBook({ ...book, token_budget: v })} min={0} step={50} allowEmpty placeholder="default" />
          </label>
          <Toggle checked={!!book.recursive_scanning} onChange={(v) => setBook({ ...book, recursive_scanning: v })} label="Recursive scanning" title="Entries' content can trigger other entries" />
        </div>
      </Section>
      <Entries book={book} setBook={setBook} />
      <KeyTester book={book} />
    </div>
  );
}

function Entries({ book, setBook }: { book: Lorebook; setBook: (b: Lorebook, key?: string) => void }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [writing, setWriting] = useState(false);
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
    if (entries[i].content.trim() && !(await confirmDialog({ title: `Delete "${entryName(entries[i]) || `entry ${i + 1}`}"?`, body: 'Undo brings it back.', confirmLabel: 'Delete', danger: true }))) return;
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
          <Button size="sm" onClick={() => setWriting(true)}>
            ✨ Write one
          </Button>
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
  const [content, setContent] = useCardField(`character_book.entries.${index}.content`);
  return (
    <div className="flex flex-col gap-3 border-t border-slate-800 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Name <span className="text-slate-500">(kept in step with comment)</span>
          <input value={entryName(e)} onChange={(ev) => setEntry({ name: ev.target.value, comment: ev.target.value }, 'name')} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Position
          <select value={e.position || 'before_char'} onChange={(ev) => setEntry({ position: ev.target.value as LorebookEntry['position'] })} className={cx(inputClass, 'py-1')}>
            <option value="before_char">Before the character</option>
            <option value="after_char">After the character</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Keys <span className="text-slate-500">(any one fires it; /regex/ works)</span>
        <ChipInput values={e.keys} onChange={(keys) => setEntry({ keys })} placeholder="keyword, another keyword" />
      </label>
      <div className="flex flex-col gap-1">
        <Toggle checked={!!e.selective} onChange={(selective) => setEntry({ selective })} label={<span className="text-xs">Also needs a secondary key</span>} />
        {e.selective && <ChipInput values={e.secondary_keys ?? []} onChange={(secondary_keys) => setEntry({ secondary_keys })} placeholder="secondary keys" />}
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
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Content</span>
          <div className="flex items-center gap-1">
            <TokenBadge text={content} />
            <FieldActions path={`character_book.entries.${index}.content`} />
          </div>
        </div>
        <AutoTextarea value={content} onChange={(ev) => setContent(ev.target.value)} minRows={3} maxRows={20} />
      </div>
    </div>
  );
}

function KeyTester({ book }: { book: Lorebook }) {
  const [text, setText] = useState('');
  const result = useMemo(() => (text.trim() ? scanLorebook(book, [text], { scanDepth: 1 }) : null), [book, text]);
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
  const { runAssist, runId, stop, text, running, error } = useLlmStream();
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
        <div className="flex gap-2">
          <input
            autoFocus
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onPaste={refs.onPaste}
            onKeyDown={(e) => e.key === 'Enter' && topic.trim() && !running && write()}
            placeholder='What about? e.g. "her hometown", "the royal guard"'
            className={inputClass}
          />
          {running ? (
            <Button variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" disabled={!topic.trim()} onClick={write}>
              Write
            </Button>
          )}
        </div>
        <ReferenceTray refs={refs.refs} onAdd={refs.add} onRemove={refs.remove} />
        <ConnectionPicker value={assistConnectionId} onChange={setAssistConnection} label="Assistant model" />
        {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
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
