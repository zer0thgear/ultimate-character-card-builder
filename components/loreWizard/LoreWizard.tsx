'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useLlmStore } from '@/store/llmStore';
import { useLoreWizardStore } from '@/store/loreWizardStore';
import { toast } from '@/store/uiStore';
import { entryName } from '@/lib/cardSpec';
import {
  FOCUS_OPTIONS,
  SIZE_COUNT,
  applyChanges,
  cleanEntryText,
  isWritten,
  keyWarnings,
  newSession,
  parsePlan,
  parseRevision,
  planMessages,
  reviseMessages,
  saveToBook,
  toWrite,
  writeMessages,
  type WizardEntry,
  type WizardLength,
  type WizardSession,
  type WizardSize,
} from '@/lib/loreWizard';
import { uuid } from '@/lib/uuid';
import { wizardCall } from '@/components/loreWizard/wizardCall';
import { AutoTextarea, Button, ChipInput, IconButton, Modal, Select, TokenBadge, Toggle, choiceDialog, confirmDialog, cx, enterSends, inputClass } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { AssistReasoning } from '@/components/llm/AssistTrace';

// 🧙 Lorebook wizard (lib/loreWizard.ts): you describe the lorebook, the
// Planner plans its entries and asks a question or two, the Writer writes
// each entry, and you change any of it by hand or by telling the Planner.
// The written entries go into the card's lorebook when you save.

type Busy = { kind: 'plan' | 'revise' } | { kind: 'write'; id: string } | null;

const NUDGES = ['Make it darker and more dangerous', 'Add more about the villains', 'Fewer entries, each with more depth', 'Add a short history of the world', 'Give the keys more nicknames'];

export function LoreWizardDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const cardId = project?.id ?? '';
  const hasCard = !!project && !!(project.card.data.description.trim() || project.card.data.scenario.trim() || project.card.data.first_mes.trim());
  const stored = useLoreWizardStore((s) => s.sessions[cardId]);
  const session = useMemo(() => stored ?? newSession(hasCard), [stored, hasCard]);
  const setSession = useLoreWizardStore((s) => s.setSession);
  const [busy, setBusy] = useState<Busy>(null);
  const [live, setLive] = useState('');
  const [liveRun, setLiveRun] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  if (!project) return null;

  /** The session as it is now (a run's own copy goes stale while it waits). */
  const current = () => useLoreWizardStore.getState().sessions[cardId] ?? session;
  // Until the first change, the session is the default one shown (which
  // builds on the card only if the card has something in it).
  const update = (fn: (s: WizardSession) => WizardSession) => setSession(cardId, (s) => fn(useLoreWizardStore.getState().sessions[cardId] ? s : session));
  const card = () => useProjectStore.getState().project?.card.data;
  const setEntry = (id: string, patch: Partial<WizardEntry>) => update((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const start = () => {
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    return c.signal;
  };
  const stop = () => abort.current?.abort();

  /** The Writer, on each entry in turn (later ones see the earlier ones). */
  const write = async (ids: string[], instruction = '') => {
    const signal = start();
    for (const id of ids) {
      const s = current();
      const e = s.entries.find((x) => x.id === id);
      if (!e) continue;
      setBusy({ kind: 'write', id });
      setLive('');
      const r = await wizardCall('writer', `Writer: ${e.name}`, writeMessages(s, card(), e, instruction), { signal, onText: setLive, onRun: setLiveRun });
      if (r.aborted) break;
      const text = cleanEntryText(r.text);
      if (r.error || !text) {
        setEntry(id, { error: r.error ?? 'The reply was empty.' });
        if (r.error) toast(r.error, 'error');
        break;
      }
      setEntry(id, { content: text, rewrite: undefined, error: undefined });
    }
    setBusy(null);
    setLive('');
  };

  const plan = async () => {
    const s = current();
    const signal = start();
    setBusy({ kind: 'plan' });
    update((x) => ({ ...x, chat: [...x.chat, { role: 'user', text: x.pitch.trim() || 'Plan the lorebook this card needs.' }] }));
    const r = await wizardCall('planner', 'Planner: the plan', planMessages(s, card()), { signal, onRun: setLiveRun });
    setBusy(null);
    if (r.aborted) return;
    if (r.error) {
      toast(r.error, 'error');
      update((x) => ({ ...x, chat: x.chat.slice(0, -1) }));
      return;
    }
    const p = parsePlan(r.text);
    update((x) => ({
      ...x,
      stage: 'draft',
      entries: [...x.entries, ...p.entries],
      chat: [...x.chat, { role: 'wizard', runId: r.runId, text: p.message || (p.entries.length ? `Here's a plan with ${p.entries.length} entries.` : r.text.trim() || 'The planner sent nothing back.'), ...(p.entries.length ? { changes: [`${p.entries.length} entries planned`] } : {}) }],
    }));
  };

  const send = async (text: string) => {
    const s = current();
    const signal = start();
    setBusy({ kind: 'revise' });
    update((x) => ({ ...x, chat: [...x.chat, { role: 'user', text }] }));
    const r = await wizardCall('planner', 'Planner: your message', reviseMessages(s, card(), text), { signal, onRun: setLiveRun });
    setBusy(null);
    if (r.aborted) return;
    if (r.error) {
      toast(r.error, 'error');
      return;
    }
    const rev = parseRevision(r.text);
    const before = current().entries;
    const applied = applyChanges(before, rev.changes);
    update((x) => ({ ...x, entries: applied.entries, chat: [...x.chat, { role: 'wizard', runId: r.runId, text: rev.message || (rev.parsed ? 'Done.' : r.text.trim()), ...(applied.notes.length ? { changes: applied.notes } : {}) }] }));
    // Once writing has begun, what the message changed is written straight away.
    if (useLoreWizardStore.getState().autoWrite && before.some(isWritten)) {
      const had = new Set(before.map((e) => e.id));
      const ids = applied.entries.filter((e) => e.rewrite || (!had.has(e.id) && !isWritten(e))).map((e) => e.id);
      if (ids.length) await write(ids);
    }
  };

  const save = async () => {
    const written = session.entries.filter(isWritten);
    const book = useProjectStore.getState().project?.card.data.character_book;
    const names = new Set((book?.entries ?? []).map((e) => entryName(e).trim().toLowerCase()));
    const clash = written.filter((e) => names.has(e.name.trim().toLowerCase())).length;
    let replace = false;
    if (clash) {
      const pick = await choiceDialog({
        title: 'Some entries are already in the lorebook',
        body: `${clash} of these ${written.length} entries ${clash === 1 ? 'has' : 'have'} the same name as one in the card's lorebook (from saving before, say).`,
        choices: [
          { value: 'replace', label: 'Replace those' },
          { value: 'add', label: 'Add them as well' },
        ],
      });
      if (!pick) return;
      replace = pick === 'replace';
    }
    const r = saveToBook(book, written, { replace, name: session.title || undefined });
    useProjectStore.getState().updateCard((d) => ({ ...d, character_book: r.book }));
    const did = [r.added && `added ${r.added}`, r.replaced && `replaced ${r.replaced}`].filter(Boolean).join(' and ');
    toast(`${did.charAt(0).toUpperCase()}${did.slice(1)} lorebook entr${r.added + r.replaced === 1 ? 'y' : 'ies'}. The draft stays here until you start over.`, 'success');
  };

  const startOver = async () => {
    if (session.entries.length && !(await confirmDialog({ title: 'Start over?', body: 'The draft and the conversation go. Entries you saved to the card stay there.', confirmLabel: 'Start over', danger: true }))) return;
    stop();
    useLoreWizardStore.getState().clear(cardId);
  };

  const written = session.entries.filter(isWritten).length;
  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      title="🧙 Lorebook wizard"
      pinned={<Steps session={session} />}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" disabled={!!busy || (!session.entries.length && !session.chat.length)} onClick={() => void startOver()}>
            Start over
          </Button>
          <Button variant="ghost" onClick={onClose} title="The draft stays here for next time">
            Close
          </Button>
          {session.stage === 'draft' && (
            <Button variant="primary" disabled={!written || !!busy} onClick={() => void save()} title="Puts the written entries into the card's lorebook (planned ones that aren't written yet stay behind)">
              Save {written || ''} to the card&apos;s lorebook
            </Button>
          )}
        </>
      }
    >
      {session.stage === 'brief' ? (
        <Brief session={session} update={update} busy={!!busy} onPlan={() => void plan()} onStop={stop} hasCard={hasCard} />
      ) : (
        <div className="grid gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <EntryList session={session} update={update} setEntry={setEntry} busy={busy} live={live} onWrite={(ids, instruction) => void write(ids, instruction)} onStop={stop} />
          <Conversation session={session} busy={busy} liveRun={liveRun} onSend={(t) => void send(t)} onStop={stop} />
        </div>
      )}
    </Modal>
  );
}

function Steps({ session }: { session: WizardSession }) {
  const written = session.entries.filter(isWritten).length;
  const steps = [
    { label: 'Describe it', done: session.stage === 'draft' },
    { label: 'Plan the entries', done: session.entries.length > 0 },
    { label: `Write them${session.entries.length ? ` (${written}/${session.entries.length})` : ''}`, done: !!session.entries.length && written === session.entries.length },
    { label: 'Save to the card', done: false },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
      {steps.map((s, i) => (
        <span key={s.label} className={cx(s.done && 'text-emerald-400')}>
          {s.done ? '✓' : `${i + 1}.`} {s.label}
        </span>
      ))}
      <WizardConnections />
    </div>
  );
}

function WizardConnections() {
  const assist = useLlmStore((s) => s.assistConnectionId);
  const { plannerConnectionId, writerConnectionId, setConnection } = useLoreWizardStore();
  return (
    <details className="ml-auto text-xs">
      <summary className="cursor-pointer text-slate-400 hover:text-slate-200">⚙ Connections</summary>
      <div className="mt-1 flex w-80 max-w-full flex-col gap-1.5">
        <ConnectionPicker label="Planner" value={plannerConnectionId ?? assist} onChange={(id) => setConnection('planner', id)} />
        <ConnectionPicker label="Writer" value={writerConnectionId ?? assist} onChange={(id) => setConnection('writer', id)} />
        <p className="text-[11px] text-slate-500">Both use the writing assistant&apos;s connection until you pick one. The Planner answers in JSON, so it wants a model that follows formats well; the Writer can be a cheaper or more creative one.</p>
      </div>
    </details>
  );
}

function Brief({ session: s, update, busy, onPlan, onStop, hasCard }: { session: WizardSession; update: (fn: (s: WizardSession) => WizardSession) => void; busy: boolean; onPlan: () => void; onStop: () => void; hasCard: boolean }) {
  const set = (patch: Partial<WizardSession>) => update((x) => ({ ...x, ...patch }));
  const card = useProjectStore((st) => st.project?.card.data);
  const hasBook = !!card?.character_book?.entries.length;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-slate-400">
        Tell the wizard what the lorebook is about. It plans the entries and asks a question or two, then writes them one by one. You can change any entry by hand, or tell it what to change and it rewrites them.
      </p>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        What should it cover?
        <AutoTextarea
          autoFocus
          value={s.pitch}
          onChange={(e) => set({ pitch: e.target.value })}
          minRows={4}
          maxRows={14}
          placeholder={hasCard ? "Leave it blank to plan from the card, or say what you want: \"the city she grew up in, its guilds and the cult in the sewers\"" : 'The world, its places and people: "a sunken archipelago ruled by rival pirate houses, with sea-witches and a drowned god"'}
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-400">Focus on (optional)</span>
        <div className="flex flex-wrap gap-1.5">
          {FOCUS_OPTIONS.map((f) => {
            const on = s.focus.includes(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => set({ focus: on ? s.focus.filter((x) => x !== f) : [...s.focus, f] })}
                className={cx('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-violet-500/60 bg-violet-500/15 text-violet-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800')}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          How many entries
          <Select<WizardSize>
            value={s.size}
            onChange={(size) => set({ size })}
            options={[
              { value: 'small', label: `A few (about ${SIZE_COUNT.small})` },
              { value: 'medium', label: `Some (about ${SIZE_COUNT.medium})` },
              { value: 'large', label: `Lots (about ${SIZE_COUNT.large})` },
            ]}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Entry length
          <Select<WizardLength>
            value={s.length}
            onChange={(length) => set({ length })}
            options={[
              { value: 'short', label: 'Short (under 80 words)' },
              { value: 'medium', label: 'Medium (80–180 words)' },
              { value: 'long', label: 'Long (180–350 words)' },
            ]}
          />
        </label>
        {!hasBook && (
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-slate-400">
            Lorebook name
            <input value={s.title} onChange={(e) => set({ title: e.target.value })} placeholder="optional" className={inputClass} />
          </label>
        )}
      </div>
      <Toggle
        checked={s.useCard}
        onChange={(useCard) => set({ useCard })}
        label={<span className="text-xs">Build on the card{hasBook ? ' and its lorebook' : ''}</span>}
        title="Send the card (and the names of the lorebook's entries) along, so the lorebook fits it and doesn't repeat it. Off for a lorebook that stands on its own."
      />
      <div className="flex justify-end">
        {busy ? (
          <Button variant="danger" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" disabled={!s.pitch.trim() && !s.useCard} onClick={onPlan}>
            Plan the lorebook
          </Button>
        )}
      </div>
      {busy && <p className="animate-pulse text-sm text-slate-400">The planner is drawing up the entries…</p>}
    </div>
  );
}

function EntryList({
  session: s,
  update,
  setEntry,
  busy,
  live,
  onWrite,
  onStop,
}: {
  session: WizardSession;
  update: (fn: (s: WizardSession) => WizardSession) => void;
  setEntry: (id: string, patch: Partial<WizardEntry>) => void;
  busy: Busy;
  live: string;
  onWrite: (ids: string[], instruction?: string) => void;
  onStop: () => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const warnings = useMemo(() => keyWarnings(s.entries), [s.entries]);
  const pending = toWrite(s.entries);
  const written = s.entries.filter(isWritten).length;
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const add = () => {
    const id = uuid();
    update((x) => ({ ...x, entries: [...x.entries, { id, name: 'New entry', keys: [], brief: '', content: '' }] }));
    setOpen((o) => new Set(o).add(id));
  };
  return (
    <div className="flex min-h-0 flex-col gap-2 lg:overflow-y-auto lg:pr-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-slate-400">
          {s.entries.length} entr{s.entries.length === 1 ? 'y' : 'ies'} · {written} written
        </span>
        {s.entries.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(open.size ? new Set() : new Set(s.entries.map((e) => e.id)))}>
            {open.size ? 'Fold all' : 'Unfold all'}
          </Button>
        )}
        <Button size="sm" onClick={add} disabled={!!busy}>
          + Add
        </Button>
        {busy?.kind === 'write' ? (
          <Button size="sm" variant="danger" onClick={onStop}>
            Stop writing
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={!pending.length || !!busy} onClick={() => onWrite(pending.map((e) => e.id))} title="The Writer writes each entry in turn; later ones see what's already written">
            ✍ Write {pending.length ? (written ? `${pending.length} more` : `all ${pending.length}`) : 'all'}
          </Button>
        )}
      </div>
      {!s.entries.length && <p className="rounded-md border border-dashed border-slate-800 p-4 text-center text-sm text-slate-500">Nothing planned yet. Tell the wizard what you want, or + Add an entry yourself.</p>}
      {s.entries.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          open={open.has(e.id)}
          onToggle={() => toggle(e.id)}
          warnings={warnings[e.id]}
          writing={busy?.kind === 'write' && busy.id === e.id ? live || '…' : null}
          busy={!!busy}
          setEntry={(patch) => setEntry(e.id, patch)}
          onWrite={(instruction) => onWrite([e.id], instruction)}
          onRemove={async () => {
            if (isWritten(e) && !(await confirmDialog({ title: `Remove "${e.name}"?`, body: 'It goes from the draft (not from the card, if you saved it there).', confirmLabel: 'Remove', danger: true }))) return;
            update((x) => ({ ...x, entries: x.entries.filter((y) => y.id !== e.id) }));
          }}
        />
      ))}
    </div>
  );
}

function EntryCard({
  entry: e,
  open,
  onToggle,
  warnings,
  writing,
  busy,
  setEntry,
  onWrite,
  onRemove,
}: {
  entry: WizardEntry;
  open: boolean;
  onToggle: () => void;
  warnings?: string[];
  writing: string | null;
  busy: boolean;
  setEntry: (patch: Partial<WizardEntry>) => void;
  onWrite: (instruction?: string) => void;
  onRemove: () => void;
}) {
  const [change, setChange] = useState('');
  const done = isWritten(e);
  const status = writing !== null ? 'writing…' : e.error ? 'failed' : e.rewrite ? 'to rewrite' : done ? 'written' : 'planned';
  const tone = { 'writing…': 'bg-sky-500/15 text-sky-300 animate-pulse', failed: 'bg-red-500/15 text-red-300', 'to rewrite': 'bg-amber-500/15 text-amber-300', written: 'bg-emerald-500/15 text-emerald-300', planned: 'bg-slate-700/60 text-slate-400' }[status];
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onToggle}>
          <span className="text-xs text-slate-500">{open ? '▾' : '▸'}</span>
          <span className="truncate text-sm text-slate-200">{e.name || <em className="text-slate-500">unnamed</em>}</span>
          {e.category && <span className="hidden rounded bg-slate-800 px-1.5 text-[10px] text-slate-400 sm:inline">{e.category}</span>}
          <span className={cx('rounded px-1.5 text-[10px]', tone)}>{status}</span>
          {e.always ? <span className="rounded bg-violet-500/15 px-1.5 text-[10px] text-violet-300">always</span> : <span className="min-w-0 truncate text-xs text-slate-500">{e.keys.join(', ') || 'no keys'}</span>}
          {warnings?.length ? (
            <span className="text-xs text-amber-400" title={warnings.join('\n')}>
              ⚠
            </span>
          ) : null}
        </button>
        {done && <TokenBadge text={e.content} className="mx-1" />}
        <IconButton title={done ? 'Write it again from its plan' : 'Write this entry'} disabled={busy} onClick={() => onWrite()}>
          {done ? '↻' : '✍'}
        </IconButton>
        <IconButton title="Remove from the draft" tone="danger" disabled={busy} onClick={onRemove}>
          🗑
        </IconButton>
      </div>
      {!open && !writing && (done || e.brief) && <p className="line-clamp-2 px-3 pb-2 text-xs text-slate-500">{done ? e.content : e.brief}</p>}
      {writing !== null && <p className="px-3 pb-2 text-xs whitespace-pre-wrap text-slate-300">{writing}</p>}
      {open && (
        <div className="flex flex-col gap-3 border-t border-slate-800 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Name
              <input value={e.name} onChange={(ev) => setEntry({ name: ev.target.value })} className={inputClass} />
            </label>
            <div className="flex flex-col gap-1 text-xs text-slate-400">
              Keys
              <ChipInput values={e.keys} onChange={(keys) => setEntry({ keys })} placeholder="keyword, another keyword" />
            </div>
          </div>
          {warnings?.length ? <p className="text-[11px] text-amber-300">⚠ {warnings.join(' · ')}</p> : null}
          <Toggle checked={!!e.always} onChange={(always) => setEntry({ always })} label={<span className="text-xs">Always on (no keys needed)</span>} />
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Plan <span className="text-slate-500">(what it covers; the Writer goes by this)</span>
            <AutoTextarea value={e.brief} onChange={(ev) => setEntry({ brief: ev.target.value })} minRows={1} maxRows={6} />
          </label>
          {(done || e.rewrite) && (
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Text
              <AutoTextarea value={e.content} onChange={(ev) => setEntry({ content: ev.target.value })} minRows={3} maxRows={20} />
            </label>
          )}
          {e.rewrite && (
            <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
              <span className="flex-1 whitespace-pre-wrap">To change: {e.rewrite}</span>
              <Button size="sm" variant="ghost" onClick={() => setEntry({ rewrite: undefined })}>
                Never mind
              </Button>
            </div>
          )}
          {e.error && <p className="text-xs text-red-300">{e.error}</p>}
          {done && (
            <div className="flex items-start gap-2">
              <AutoTextarea
                value={change}
                onChange={(ev) => setChange(ev.target.value)}
                onKeyDown={(ev) => {
                  if (enterSends(ev) && change.trim() && !busy) {
                    ev.preventDefault();
                    onWrite(change.trim());
                    setChange('');
                  }
                }}
                minRows={1}
                maxRows={4}
                placeholder="What should change? e.g. &quot;make him older&quot;, &quot;add the secret passage&quot;"
                className="flex-1"
              />
              <Button
                disabled={!change.trim() || busy}
                onClick={() => {
                  onWrite(change.trim());
                  setChange('');
                }}
              >
                ↻ Rewrite
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Conversation({ session: s, busy, liveRun, onSend, onStop }: { session: WizardSession; busy: Busy; liveRun: string | null; onSend: (text: string) => void; onStop: () => void }) {
  const [input, setInput] = useState('');
  const autoWrite = useLoreWizardStore((st) => st.autoWrite);
  const setAutoWrite = useLoreWizardStore((st) => st.setAutoWrite);
  const bottom = useRef<HTMLDivElement>(null);
  const thinking = busy?.kind === 'plan' || busy?.kind === 'revise';
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [s.chat.length, thinking]);
  const send = () => {
    const t = input.trim();
    if (!t || busy) return;
    onSend(t);
    setInput('');
  };
  return (
    <div className="flex min-h-80 flex-col rounded-md border border-slate-800 bg-slate-950/40 lg:min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3">
          {s.chat.map((m, i) => (
            <div key={i} className={cx('rounded-lg px-3 py-2 text-sm whitespace-pre-wrap', m.role === 'user' ? 'ml-6 bg-sky-500/10 text-slate-200' : 'mr-2 bg-slate-900 text-slate-300')}>
              {m.role === 'wizard' && m.runId && <AssistReasoning runId={m.runId} className="mb-1.5 whitespace-normal" />}
              {m.text}
              {m.changes?.length ? (
                <ul className="mt-1.5 flex flex-col gap-0.5 text-xs whitespace-normal text-slate-500">
                  {m.changes.map((c, j) => (
                    <li key={j}>{c}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          {thinking && (
            <div className="mr-2 rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-400">
              <AssistReasoning runId={liveRun} className="mb-1.5" />
              <span className="animate-pulse">{busy?.kind === 'plan' ? 'Planning the entries…' : 'Working out what to change…'}</span>
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>
      <div className="flex-shrink-0 border-t border-slate-800 p-2">
        {!busy && s.chat.length < 4 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {NUDGES.map((n) => (
              <button key={n} type="button" onClick={() => setInput(n)} className="rounded-md bg-slate-900 px-2 py-0.5 text-left text-[11px] text-slate-400 hover:bg-slate-800">
                {n}
              </button>
            ))}
          </div>
        )}
        <AutoTextarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (enterSends(e)) {
              e.preventDefault();
              send();
            }
          }}
          minRows={2}
          maxRows={8}
          placeholder="Answer its questions, or say what to change: add, drop, rename, rewrite…"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <Toggle checked={autoWrite} onChange={setAutoWrite} label={<span className="text-[11px] text-slate-400">Write changes right away</span>} title="Once entries are written, rewrite the ones your message changes (and write new ones) as soon as the planner answers" />
          {thinking ? (
            <Button size="sm" variant="danger" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" disabled={!input.trim() || !!busy} onClick={send}>
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
