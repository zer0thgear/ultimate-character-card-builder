'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdventureCtx, UsageTally } from '@/lib/adventure';
import type { AdventureEntry, AdventureSession } from '@/types/adventure';
import { callsPerTurn, effectiveWorld, openingMessages, withOverride, runTurn, tallyUsage, undoLastTurn } from '@/lib/adventure';
import { chatGreeting, loreDefaults, macroExpander } from '@/lib/chatPrompt';
import { HEADING_CLASSES, formatChat, hideComments, type FormatNode } from '@/lib/chatFormat';
import { useProjectStore } from '@/store/projectStore';
import { useAdventureStore } from '@/store/adventureStore';
import { useLlmStore } from '@/store/llmStore';
import { resolvePersona, usePersonaStore } from '@/store/personaStore';
import { ensureLorebooks, useLorebookStore } from '@/store/lorebookStore';
import { combineLorebooks, lorebooksInPlay } from '@/lib/lorebookBank';
import { toast } from '@/store/uiStore';
import { openSettings } from '@/components/SettingsDialog';
import { api } from '@/lib/api';
import { uuid } from '@/lib/uuid';
import { AutoTextarea, Button, IconButton, Toggle, confirmDialog, cx, enterSends, inputClass, textDialog } from '@/components/ui';
import { inspectAssistRun } from '@/components/llm/AssistTrace';
import { actorConnection, callActor } from '@/components/adventure/actorCall';
import { usageLine } from '@/components/adventure/usageLine';
import { WorldDrawer, scanCard } from '@/components/adventure/AdventureWorld';
import { ActorSettingsDialog } from '@/components/adventure/ActorSettings';
import { useKeyboard } from '@/hooks/useKeyboard';

// Adventure mode (Chat mode's 🎲): a roleplay run by a Director and its
// actors, one turn at a time (lib/adventure.ts). Your adventures are the
// card's, beside its chats.

/** What every call of the open adventure is built from. */
function useAdventureCtx(adventure: AdventureSession | null): AdventureCtx | null {
  const project = useProjectStore((s) => s.project);
  const personas = usePersonaStore((s) => s.personas);
  const chatSettings = useLlmStore((s) => s.chatSettings);
  const settings = useLlmStore((s) => s.adventureSettings);
  const bank = useLorebookStore((s) => s.books);
  useEffect(ensureLorebooks, []);
  return useMemo(() => {
    if (!project) return null;
    const me = resolvePersona(personas, chatSettings, adventure);
    // The bank's global and persona lorebooks come along, as in chats.
    const attached = lorebooksInPlay(bank, { projectId: project.id, personaLorebookId: me.persona?.lorebookId, globalIds: chatSettings.globalLorebooks });
    return {
      card: project.card.data,
      userName: me.name,
      persona: me.description,
      world: effectiveWorld(project.adventure, adventure?.overrides),
      settings,
      dice: adventure?.dice ?? settings.diceDefault,
      lore: chatSettings.useLorebook ? loreDefaults(chatSettings) : null,
      loreBook: combineLorebooks(project.card.data.character_book, attached),
    };
  }, [project, personas, chatSettings, settings, adventure, bank]);
}

export function AdventurePanel({ phone }: { phone: boolean }) {
  const project = useProjectStore((s) => s.project);
  const { list, adventure, loadFor, open, remove, update } = useAdventureStore();
  const [worldOpen, setWorldOpen] = useState(false);
  const [actorsOpen, setActorsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const keyboard = useKeyboard((s) => s.open);
  const ctx = useAdventureCtx(adventure);
  const projectId = project?.id;

  useEffect(() => {
    if (projectId) void loadFor(projectId);
  }, [projectId, loadFor]);

  if (!project || !ctx) return null;
  const total = tallyUsage(adventure?.entries.map((e) => e.usage) ?? []);
  const showNew = creating || !adventure;

  const rename = async () => {
    if (!adventure) return;
    const name = await textDialog({ title: 'Rename adventure', initial: adventure.name });
    if (name?.trim()) update((a) => ({ ...a, name: name.trim() }));
  };
  const del = async () => {
    if (!adventure) return;
    if (await confirmDialog({ title: `Delete "${adventure.name}"?`, body: 'The adventure is deleted for good (the card and its world stay).', confirmLabel: 'Delete', danger: true })) await remove(adventure.id);
  };

  const world = worldOpen && (
    phone ? (
      <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <WorldDrawer onClose={() => setWorldOpen(false)} />
      </div>
    ) : (
      <aside className="flex w-[400px] max-w-[45%] flex-shrink-0 flex-col border-l border-slate-800">
        <WorldDrawer onClose={() => setWorldOpen(false)} />
      </aside>
    )
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {!(phone && keyboard) && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-800 p-2 phone:flex-nowrap">
            <select
              value={creating ? '' : (adventure?.id ?? '')}
              onChange={(e) => {
                if (!e.target.value) return;
                setCreating(false);
                void open(e.target.value);
              }}
              className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs', !phone && 'min-w-36')}
            >
              {(!adventure || creating) && <option value="">{creating ? 'A new adventure…' : 'No adventure open'}</option>}
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.turns} turn{a.turns === 1 ? '' : 's'})
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" onClick={() => setCreating(true)} disabled={creating}>
              + New
            </Button>
            {adventure && !creating && (
              <>
                {!phone && (
                  <IconButton title="Rename" onClick={() => void rename()}>
                    ✎
                  </IconButton>
                )}
                <IconButton title="Delete this adventure" tone="danger" onClick={() => void del()}>
                  🗑
                </IconButton>
              </>
            )}
            {adventure && !creating && !phone && <PersonaSelect value={adventure.personaId} onChange={(personaId) => update((a) => ({ ...a, personaId }))} className="w-40" compact />}
            <Button size="sm" variant={worldOpen ? 'primary' : 'secondary'} onClick={() => setWorldOpen(!worldOpen)} title="The world: the Cast, settings and rules, the card's and this adventure's">
              🌍{!phone && ' World'}
            </Button>
            <IconButton title="Actors: each one's connection and prompt, characters per turn, style, your own actors" onClick={() => setActorsOpen(true)}>
              ⚙
            </IconButton>
            {adventure && !creating && !phone && (
              <span className="ml-auto text-[11px] whitespace-nowrap text-slate-500" title="Every call this adventure has made, in all (tokens marked ~ are estimates; prices are known for OpenRouter connections)">
                Σ {usageLine(total)}
              </span>
            )}
          </div>
        )}
        {showNew ? (
          <NewAdventure
            ctx={ctx}
            onCancel={adventure ? () => setCreating(false) : undefined}
            onStarted={() => setCreating(false)}
            onOpenWorld={() => setWorldOpen(true)}
          />
        ) : (
          <Story key={adventure.id} adventure={adventure} ctx={ctx} phone={phone} />
        )}
      </div>
      {world}
      <ActorSettingsDialog open={actorsOpen} onClose={() => setActorsOpen(false)} />
    </div>
  );
}

// ─── Starting one ────────────────────────────────────────────────────────────

/** Who you play in an adventure: one of your personas, or (unset) the one
 *  active in the chat settings. */
function PersonaSelect({ value, onChange, className, compact }: { value: string | undefined; onChange: (id: string | undefined) => void; className?: string; compact?: boolean }) {
  const personas = usePersonaStore((s) => s.personas);
  const chatSettings = useLlmStore((s) => s.chatSettings);
  const active = resolvePersona(personas, chatSettings);
  const known = !!value && personas.some((p) => p.id === value);
  return (
    <span className={cx('flex items-center gap-1', className)}>
      <select
        value={known ? value : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        title="Who you play in this adventure ({{user}})"
        aria-label="Persona"
        className={cx(inputClass, 'min-w-0 py-1 text-xs')}
      >
        <option value="">{compact ? `👤 ${active.name}` : `The active persona (${active.name})`}</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {compact ? '👤 ' : ''}
            {p.name || 'Unnamed'}
          </option>
        ))}
      </select>
      {!compact && (
        <button type="button" className="text-xs whitespace-nowrap text-violet-300 underline" onClick={() => openSettings('personas')}>
          {personas.length ? 'Manage…' : 'Add a persona…'}
        </button>
      )}
    </span>
  );
}

/** The opening's narration (turn 0). */
const openingEntry = (text: string): AdventureEntry => ({ id: uuid(), turn: 0, kind: 'narration', text, createdAt: Date.now() });

function NewAdventure({ ctx, onCancel, onStarted, onOpenWorld }: { ctx: AdventureCtx; onCancel?: () => void; onStarted: () => void; onOpenWorld: () => void }) {
  const card = ctx.card;
  const create = useAdventureStore((s) => s.create);
  const update = useAdventureStore((s) => s.update);
  const diceDefault = useLlmStore((s) => s.adventureSettings.diceDefault);
  const maxActors = useLlmStore((s) => s.adventureSettings.maxActors);
  const project = useProjectStore((s) => s.project);
  const [how, setHow] = useState<'greeting' | 'director'>('greeting');
  const [greeting, setGreeting] = useState(0);
  const [seed, setSeed] = useState(-1);
  const [prompt, setPrompt] = useState('');
  const [dice, setDice] = useState(diceDefault);
  const [personaId, setPersonaId] = useState<string | undefined>(undefined);
  const personas = usePersonaStore((s) => s.personas);
  const chatSettings = useLlmStore((s) => s.chatSettings);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const greetings = [card.first_mes, ...card.alternate_greetings];
  // Who you play: the persona picked here, else the active one.
  const me = resolvePersona(personas, chatSettings, { personaId });
  const startCtx: AdventureCtx = { ...ctx, userName: me.name, persona: me.description, dice };
  const x = macroExpander(card, [], { userName: me.name, persona: me.description }).x;
  const label = (i: number) => `${i === 0 ? 'First message' : `Alternate ${i}`}: ${x(greetings[i] ?? '').replace(/\s+/g, ' ').slice(0, 70) || '(empty)'}`;
  const w = project?.adventure;
  const worldEmpty = !w || !(w.settings.length || w.personae.length || w.rules.trim());

  const start = async () => {
    setBusy(true);
    try {
      if (how === 'greeting') {
        const text = x(chatGreeting(card, { greeting }));
        const entries = text.trim() ? [openingEntry(text)] : [];
        await create({ opening: { kind: 'greeting', greeting }, entries, dice, ...(personaId ? { personaId } : {}) });
        onStarted();
        return;
      }
      const a = await create({ opening: { kind: 'director', prompt, ...(seed >= 0 ? { greeting: seed } : {}) }, entries: [], dice, ...(personaId ? { personaId } : {}) });
      onStarted();
      const first = openingEntry('');
      const id = first.id;
      update((s) => ({ ...s, entries: [first] }));
      const r = await callActor('director', '🎬 Opening', openingMessages(startCtx, { prompt, greeting: seed >= 0 ? chatGreeting(card, { greeting: seed }) : undefined }), {
        onText: (t) => useAdventureStore.getState().adventure?.id === a.id && update((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, text: t } : e)) })),
      });
      if (useAdventureStore.getState().adventure?.id !== a.id) return;
      update((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, text: r.text.trim(), usage: r.usage } : e)).filter((e) => e.text) }));
      if (r.error) toast(`The Director couldn't write the opening: ${r.error}`, 'error');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 text-sm text-slate-300">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">🎲 A new adventure with {card.name || 'this character'}</h2>
          <p className="mt-1 text-xs text-slate-400">
            A roleplay run like a tabletop game. Each turn you say what you do; the 🎬 Director decides what happens and who has something to add, the app rolls the dice, and the 📜 Narrator and those characters take it in turns, each with a call of their own. That&apos;s up to {callsPerTurn({ maxActors })} calls a turn, so it costs more than a chat.
          </p>
        </div>
        {worldEmpty && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            This card has no world for adventures yet. 🔍 Scan the card and the Scout lists its settings, characters and rules from its definitions and lorebook (one call), for you to check in 🌍 World. Adventures work without one too.
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={scanning}
                onClick={async () => {
                  setScanning(true);
                  if (await scanCard()) onOpenWorld();
                  setScanning(false);
                }}
              >
                {scanning ? 'Scanning…' : '🔍 Scan the card'}
              </Button>
              <Button size="sm" variant="ghost" onClick={onOpenWorld}>
                🌍 Write it myself
              </Button>
            </div>
          </div>
        )}
        <fieldset className="flex flex-col gap-2">
          <label className="flex items-start gap-2">
            <input type="radio" checked={how === 'greeting'} onChange={() => setHow('greeting')} className="mt-1" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span>Open with one of the card&apos;s greetings</span>
              {how === 'greeting' && (
                <select value={greeting} onChange={(e) => setGreeting(Number(e.target.value))} className={cx(inputClass, 'py-1 text-xs')}>
                  {greetings.map((_, i) => (
                    <option key={i} value={i}>
                      {label(i)}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" checked={how === 'director'} onChange={() => setHow('director')} className="mt-1" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span>Have the Director write a bespoke opening</span>
              {how === 'director' && (
                <>
                  <select value={seed} onChange={(e) => setSeed(Number(e.target.value))} className={cx(inputClass, 'py-1 text-xs')}>
                    <option value={-1}>From the world and what you ask for (no greeting)</option>
                    {greetings.map((_, i) => (
                      <option key={i} value={i}>
                        Built on {label(i)}
                      </option>
                    ))}
                  </select>
                  <AutoTextarea value={prompt} onChange={(e) => setPrompt(e.target.value)} minRows={2} placeholder="What you'd like (optional): a heist gone wrong, a rainy night at the inn, the start of a journey…" className={cx(inputClass, 'text-sm')} />
                </>
              )}
            </span>
          </label>
        </fieldset>
        <label className="flex flex-col gap-1">
          <span>You play</span>
          <PersonaSelect value={personaId} onChange={setPersonaId} className="max-w-sm" />
        </label>
        <Toggle checked={dice} onChange={setDice} label="🎲 Roll dice for uncertain actions" title="The Director asks for a roll when an outcome is uncertain; the app rolls real dice and the story follows the result" />
        <div className="flex gap-2">
          <Button variant="primary" disabled={busy || (how === 'greeting' && !greetings.length)} onClick={() => void start()}>
            {busy ? 'Starting…' : 'Start the adventure'}
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── The story ───────────────────────────────────────────────────────────────

function Story({ adventure, ctx, phone }: { adventure: AdventureSession; ctx: AdventureCtx; phone: boolean }) {
  const update = useAdventureStore((s) => s.update);
  const project = useProjectStore((s) => s.project);
  const maxActors = useLlmStore((s) => s.adventureSettings.maxActors);
  const [input, setInput] = useState('');
  const [toDirector, setToDirector] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const entries = adventure.entries;
  const lastTurn = entries.reduce((n, e) => Math.max(n, e.turn), 0);
  const avatar = project ? api.avatarUrl(project.id, project.avatar) : null;
  const mainNames = [ctx.card.name, ctx.card.nickname].filter(Boolean).map((n) => n!.trim().toLowerCase());

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const play = async (opts: { action?: string; toDirector?: boolean; redo?: boolean } = {}) => {
    if (running) return;
    const a = useAdventureStore.getState().adventure;
    if (!a || a.id !== adventure.id) return;
    let session: Pick<AdventureSession, 'entries' | 'scene'> = { entries: a.entries, scene: a.scene };
    let turn: number | undefined;
    if (opts.redo) {
      turn = lastTurn;
      session = undoLastTurn(session);
    }
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError(null);
    stick.current = true;
    const mine = (fn: (s: AdventureSession) => AdventureSession) => useAdventureStore.getState().adventure?.id === adventure.id && update(fn);
    try {
      const r = await runTurn(
        { ctx, session, action: opts.action, toDirector: opts.toDirector, redo: opts.redo, turn },
        {
          call: (actor, label, messages, onText) => callActor(actor, label, messages, { onText, signal: controller.signal }),
          onChange: (es, scene) => mine((s) => ({ ...s, entries: es, scene })),
          signal: controller.signal,
        },
      );
      // Newcomers join this adventure's Cast (🌍 World can add them to the card's).
      mine((s) => ({ ...s, entries: r.entries, scene: r.scene, overrides: r.newCast.reduce((o, c) => withOverride(o, 'personae', c.id, c), s.overrides) }));
      if (r.error) setError(r.error);
    } finally {
      abort.current = null;
      setRunning(false);
    }
  };

  const send = () => {
    const text = input.trim();
    if (toDirector && !text) return;
    setInput('');
    void play({ action: text, toDirector });
  };

  const turns = useMemo(() => {
    const groups = new Map<number, AdventureEntry[]>();
    for (const e of entries) groups.set(e.turn, [...(groups.get(e.turn) ?? []), e]);
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [entries]);
  const scene = adventure.scene;
  const connection = actorConnection('director');

  return (
    <>
      {scene && (scene.location || scene.situation) && (
        <div className="flex-shrink-0 truncate border-b border-slate-800 bg-slate-900/50 px-3 py-1 text-[11px] text-slate-400" title={[scene.situation, scene.present.length ? `Present: ${scene.present.join(', ')}` : ''].filter(Boolean).join('\n')}>
          📍 {[scene.location, scene.time].filter(Boolean).join(' · ') || 'Somewhere'}
          {scene.present.length > 0 && <span className="text-slate-500"> · with {scene.present.join(', ')}</span>}
        </div>
      )}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {!entries.length && !running && <p className="text-center text-sm text-slate-500">The stage is empty. Say what you do, or ⏭ let the Director begin.</p>}
          {turns.map(([turn, list]) => (
            <TurnView key={turn} turn={turn} entries={list} userName={ctx.userName} avatar={avatar} mainNames={mainNames} busy={running} update={update} />
          ))}
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
              {error}{' '}
              <button type="button" className="underline" onClick={() => void play({ redo: true })}>
                Try the turn again
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 border-t border-slate-800 p-2">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5">
          <AutoTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (enterSends(e)) {
                e.preventDefault();
                if (!running) send();
              }
            }}
            minRows={2}
            maxRows={8}
            placeholder={toDirector ? 'Tell the Director, out of character (it steers the next turn)…' : `What do you do, ${ctx.userName}? (Empty: let things unfold)`}
            className={cx(inputClass, 'text-sm', toDirector && 'border-amber-500/50')}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {running ? (
              <Button size="sm" variant="danger" onClick={() => abort.current?.abort()}>
                ⏹ Stop
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={send} disabled={toDirector && !input.trim()} title={input.trim() || toDirector ? 'Play the turn (Enter)' : 'Nothing to say: the Director moves the story on'}>
                {input.trim() || toDirector ? 'Send' : '⏭ Let it unfold'}
              </Button>
            )}
            <Button size="sm" variant={toDirector ? 'primary' : 'ghost'} onClick={() => setToDirector(!toDirector)} title="Speak to the Director out of character: ask for a twist, a time skip, a new character… It plans the next turn with it.">
              🎬{!phone && ' To the Director'}
            </Button>
            <Button size="sm" variant="ghost" disabled={running || lastTurn === 0} onClick={() => void play({ redo: true })} title="Play the latest turn again from your action (new plan, new roll, new words)">
              ↻{!phone && ' Redo turn'}
            </Button>
            <span className="ml-auto flex items-center gap-2">
              <Toggle checked={adventure.dice} onChange={(dice) => update((a) => ({ ...a, dice }))} label={<span className="text-xs">🎲{!phone && ' Dice'}</span>} title="Roll real dice when the Director calls for it" />
              <span className="hidden text-[11px] text-slate-500 sm:inline" title={`The Director uses ${connection ? `${connection.name} (${connection.model})` : 'no connection'}; ⚙ sets each actor's`}>
                ≤ {callsPerTurn({ maxActors })} calls/turn
              </span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function TurnView({ turn, entries, userName, avatar, mainNames, busy, update }: { turn: number; entries: AdventureEntry[]; userName: string; avatar: string | null; mainNames: string[]; busy: boolean; update: (fn: (a: AdventureSession) => AdventureSession) => void }) {
  const tally = tallyUsage(entries.map((e) => e.usage));
  return (
    <section className="flex flex-col gap-2">
      {entries.map((e) => (
        <EntryView key={e.id} entry={e} userName={userName} avatar={mainNames.includes((e.speaker ?? '').trim().toLowerCase()) ? avatar : null} busy={busy} update={update} />
      ))}
      {tally.calls > 0 && <TurnCost turn={turn} tally={tally} />}
    </section>
  );
}

function TurnCost({ turn, tally }: { turn: number; tally: UsageTally }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-slate-600">
      <span className="h-px flex-1 bg-slate-800" />
      <span title="What this turn's calls took (~: estimated tokens)">
        {turn === 0 ? 'Opening' : `Turn ${turn}`} · {usageLine(tally)}
      </span>
      <span className="h-px flex-1 bg-slate-800" />
    </div>
  );
}

function EntryView({ entry: e, userName, avatar, busy, update }: { entry: AdventureEntry; userName: string; avatar: string | null; busy: boolean; update: (fn: (a: AdventureSession) => AdventureSession) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const change = (patch: Partial<AdventureEntry>) => update((a) => ({ ...a, entries: a.entries.map((x) => (x.id === e.id ? { ...x, ...patch } : x)) }));
  const remove = () => update((a) => ({ ...a, entries: a.entries.filter((x) => x.id !== e.id) }));
  const tools = (
    <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 touch:opacity-100">
      {e.usage?.runId && (
        <IconButton title="What this actor was sent, and its reply" onClick={() => inspectAssistRun(e.usage!.runId!)}>
          🔍
        </IconButton>
      )}
      {e.kind !== 'roll' && e.kind !== 'cast' && (
        <IconButton title="Edit" disabled={busy} onClick={() => setEditing(e.text)}>
          ✎
        </IconButton>
      )}
      <IconButton title="Delete" tone="danger" disabled={busy} onClick={remove}>
        🗑
      </IconButton>
    </span>
  );
  const body =
    editing !== null ? (
      <div className="flex flex-col gap-1.5">
        <AutoTextarea value={editing} onChange={(ev) => setEditing(ev.target.value)} minRows={3} maxRows={20} autoFocus className={cx(inputClass, 'text-sm')} />
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              change({ text: editing });
              setEditing(null);
            }}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      </div>
    ) : (
      <Formatted text={e.text} />
    );

  if (e.kind === 'director')
    return (
      <details className="group rounded-md border border-slate-800/80 bg-slate-900/40 px-2 py-1 text-xs text-slate-400">
        <summary className="flex cursor-pointer items-center gap-2 select-none">
          <span className="flex-1">🎬 The Director&apos;s plan</span>
          {tools}
        </summary>
        {editing !== null ? body : <div className="mt-1 whitespace-pre-wrap text-slate-400">{e.text}</div>}
      </details>
    );
  if (e.kind === 'roll' && e.roll)
    return (
      <div className="group flex items-center justify-center gap-2">
        <span
          className={cx(
            'rounded-full border px-3 py-0.5 text-xs',
            e.roll.outcome === 'success' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : e.roll.outcome === 'failure' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-slate-700 bg-slate-900 text-slate-300',
          )}
          title={`Rolled ${e.roll.rolls.join(', ')}${e.roll.modifier ? `, ${e.roll.modifier > 0 ? '+' : ''}${e.roll.modifier}` : ''}`}
        >
          🎲 {e.text}
        </span>
        {tools}
      </div>
    );
  if (e.kind === 'cast')
    return (
      <div className="group flex items-center justify-center gap-2">
        <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-0.5 text-xs text-violet-200" title="They're in this adventure's Cast now (🌍 World), to be played the same way from here on">
          🎭 {e.text}
        </span>
        {tools}
      </div>
    );
  if (e.kind === 'action' || e.kind === 'note')
    return (
      <div className="group flex justify-end">
        <div className={cx('max-w-[85%] rounded-lg px-3 py-2', e.kind === 'note' ? 'border border-dashed border-amber-500/40 bg-amber-500/5' : 'bg-violet-600/20')}>
          <div className="mb-0.5 flex items-center gap-2 text-[11px] text-slate-400">
            <span className="flex-1">{e.kind === 'note' ? `🎬 ${userName}, to the Director` : userName}</span>
            {tools}
          </div>
          {body}
        </div>
      </div>
    );
  if (e.kind === 'extra')
    return (
      <div className="group rounded-md border border-sky-500/25 bg-sky-500/5 px-3 py-2">
        <div className="mb-0.5 flex items-center gap-2 text-[11px] text-sky-300/90">
          <span className="flex-1" title={e.private ? 'Only you and the Director see this; the Narrator and the Cast are not sent it' : undefined}>
            {e.icon ?? '✦'} {e.speaker}
            {e.private && <span className="ml-1 text-slate-500">· private</span>}
          </span>
          {tools}
        </div>
        {body}
        {!e.text && editing === null && <span className="animate-pulse text-xs text-slate-500">…</span>}
      </div>
    );
  if (e.kind === 'character')
    return (
      <div className="group flex gap-2">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-800 text-xs text-slate-300">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover object-top" /> : (e.speaker ?? '?').trim()[0]?.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2 text-[11px] text-slate-400">
            <span className="flex-1 font-medium text-violet-200">{e.speaker}</span>
            {tools}
          </div>
          {body}
          {!e.text && editing === null && <span className="animate-pulse text-xs text-slate-500">…</span>}
        </div>
      </div>
    );
  return (
    <div className="group">
      <div className="mb-0.5 flex items-center gap-2 text-[11px] text-slate-500">
        <span className="flex-1">📜 Narrator</span>
        {tools}
      </div>
      {body}
      {!e.text && editing === null && <span className="animate-pulse text-xs text-slate-500">…</span>}
    </div>
  );
}

/** *actions*, **bold** and "speech", as the chat shows them. */
function Formatted({ text }: { text: string }) {
  const nodes = useMemo(() => formatChat(hideComments(text)), [text]);
  return <div className="chat-text text-sm leading-relaxed whitespace-pre-wrap text-slate-200">{render(nodes)}</div>;
}

function render(nodes: FormatNode[]): React.ReactNode {
  return nodes.map((n, i) =>
    typeof n === 'string' ? (
      n
    ) : n.kind === 'em' ? (
      <em key={i}>{render(n.children)}</em>
    ) : n.kind === 'strong' ? (
      <strong key={i}>{render(n.children)}</strong>
    ) : n.kind === 'image' ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={i} src={n.src} alt={n.alt} loading="lazy" referrerPolicy="no-referrer" className="my-1 inline-block max-h-96 max-w-full rounded-md align-middle" />
    ) : n.kind === 'heading' ? (
      <span key={i} role="heading" aria-level={n.level} className={`block font-semibold text-slate-100 ${HEADING_CLASSES[n.level]}`}>
        {render(n.children)}
      </span>
    ) : (
      <q key={i}>{render(n.children)}</q>
    ),
  );
}
