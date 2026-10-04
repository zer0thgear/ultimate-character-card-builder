'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useStoryStore } from '@/store/storyStore';
import { textTemplates, useLlmStore } from '@/store/llmStore';
import { resolvePersona, usePersonaStore } from '@/store/personaStore';
import { useAssistLog } from '@/store/assistLog';
import { toast } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { useMediaQuery, PHONE_QUERY } from '@/hooks/useMediaQuery';
import { Button, ChipInput, IconButton, NumberInput, Modal, Toggle, AutoTextarea, confirmDialog, cx, downloadBlob, inputClass, textDialog } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { inspectAssistRun } from '@/components/llm/AssistTrace';
import { greetingText } from '@/lib/chatPrompt';
import { expandMacros } from '@/lib/macros';
import { countTextNow, formatTokens } from '@/lib/textTokens';
import { uuid } from '@/lib/uuid';
import {
  DEFAULT_PROOFREAD_PROMPT,
  DEFAULT_STORY_INSTRUCTIONS,
  buildStoryRequest,
  castNames,
  castScanMessages,
  cleanContinuation,
  currentTake,
  joinContinuation,
  loreLabels,
  parseCastSuggestions,
  personaFields,
  proofreadMessages,
  storyFileName,
  storyLore,
  storyWordCount,
  type CastSuggestion,
  type StoryContext,
} from '@/lib/storyPrompt';
import type { LlmConnection, LlmMessage } from '@/types/llm';
import type { StoryPersona, StorySession } from '@/types/project';

// Writing mode (Chat mode's ✍ Story): a story you and the model write
// together in one document. Type into it, press Continue, and the model
// writes on from where the text stops; ↻ writes that part again, ‹ › step
// between the versions, ↶ ↷ undo and redo. Beside it: the memory, the
// author's note, the Cast and the lorebook (see
// lib/storyPrompt.ts for how they make up the prompt).

/** The names and descriptions the story's prompt reads, live. */
function useStoryContext(): StoryContext | null {
  const card = useProjectStore((s) => s.project?.card.data);
  const personas = usePersonaStore((s) => s.personas);
  const chatSettings = useLlmStore((s) => s.chatSettings);
  return useMemo(() => {
    if (!card) return null;
    const me = resolvePersona(personas, chatSettings);
    return { card, userName: me.name, userDescription: me.description };
  }, [card, personas, chatSettings]);
}

/** Logs a story request to the assistant's log, so 🔍 can show it. */
function logRun(label: string, connection: LlmConnection, messages: LlmMessage[]): string {
  const id = uuid();
  useAssistLog.getState().add({ id, label, at: Date.now(), connection: connection.name, model: connection.model, messages, params: connection.params, text: '', reasoning: '', running: true });
  return id;
}

export function StoryPanel() {
  const project = useProjectStore((s) => s.project);
  const { list, story, past, future, loadFor, openStory, update, commitText, undo, redo, deleteStory } = useStoryStore();
  const { connections, chatConnectionId, storyPrompts } = useLlmStore();
  const ctx = useStoryContext();
  const phone = useMediaQuery(PHONE_QUERY);
  const stream = useLlmStream();
  const [direction, setDirection] = useState('');
  const [live, setLive] = useState<{ base: string; text: string; raw: boolean } | null>(null);
  const [phase, setPhase] = useState<'writing' | 'proofreading' | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [trimmed, setTrimmed] = useState(false);
  // Beside the story on a wide screen, unless closed; over it on a phone,
  // so only when asked for.
  const [settingsChoice, setSettingsOpen] = useState<boolean | null>(null);
  const settingsOpen = settingsChoice ?? !phone;
  const [starting, setStarting] = useState(false);
  const stopped = useRef(false);
  const doc = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (project) void loadFor(project.id);
  }, [project?.id, loadFor]); // eslint-disable-line react-hooks/exhaustive-deps

  const connection = connections.find((c) => c.id === (story?.connectionId ?? chatConnectionId)) ?? null;
  const proofConnection = connections.find((c) => c.id === story?.proofreadConnectionId) ?? connection;
  const rawText = !!textTemplates(connection);
  const take = story ? currentTake(story) : null;
  const running = phase !== null;

  // New text keeps the end of the story in view.
  useLayoutEffect(() => {
    const el = doc.current;
    if (el && live) el.scrollTop = el.scrollHeight;
  }, [live]);

  if (!project || !ctx) return null;

  const generate = async (retry = false) => {
    const s = useStoryStore.getState().story;
    if (!s || running) return;
    if (!connection) return toast('Add an LLM connection in Settings first.', 'error');
    const t = currentTake(s);
    const base = retry && t ? s.text.slice(0, t.start) : s.text;
    const req = buildStoryRequest({ ...s, text: base }, ctx, {
      mode: rawText ? 'text' : 'chat',
      maxContext: connection.params.max_context,
      maxTokens: connection.params.max_tokens,
      direction,
      instructions: storyPrompts.instructions,
      count: countTextNow,
    });
    setTrimmed(req.trimmed);
    stopped.current = false;
    setPhase('writing');
    setLive({ base, text: '', raw: rawText });
    const id = logRun(retry ? 'Story: retry' : 'Story: continue', connection, req.messages);
    setRunId(id);
    const r = await stream.run(connection, req.messages, (full) => {
      setLive({ base, text: full, raw: rawText });
      useAssistLog.getState().update(id, { text: full });
    }, req.prompt !== undefined ? { text: { prompt: req.prompt, stop: [] } } : {});
    useAssistLog.getState().update(id, { running: false, text: r.text, reasoning: r.reasoning, error: r.error });
    let out = rawText ? r.text : cleanContinuation(r.text, base);
    if (r.error && !out.trim()) {
      setPhase(null);
      setLive(null);
      return toast(r.error, 'error');
    }
    if (!rawText && s.proofread && out.trim() && !stopped.current && proofConnection) {
      setPhase('proofreading');
      const messages = proofreadMessages(base, out, storyPrompts.proofread);
      const pid = logRun('Story: proofread', proofConnection, messages);
      setRunId(pid);
      const p = await stream.run(proofConnection, messages);
      useAssistLog.getState().update(pid, { running: false, text: p.text, reasoning: p.reasoning, error: p.error });
      const fixed = cleanContinuation(p.text, base);
      if (!p.error && fixed.trim() && !stopped.current) out = fixed;
      else if (p.error) toast(`Proofreading didn't work (${p.error}), so the part is as it was written.`, 'error');
    }
    setPhase(null);
    setLive(null);
    const added = rawText ? out : joinContinuation(base, out);
    if (!added.trim()) return toast('The model sent nothing back.', 'error');
    const outputs = retry && t ? [...t.outputs, added] : [added];
    commitText(base + added, { last: { start: base.length, outputs, index: outputs.length - 1 } });
    setDirection('');
  };

  const stop = () => {
    stopped.current = true;
    stream.stop();
  };

  const swipe = (step: number) => {
    const s = useStoryStore.getState().story;
    const t = s && currentTake(s);
    if (!s || !t) return;
    const index = t.index + step;
    if (index < 0 || index >= t.outputs.length) return;
    commitText(s.text.slice(0, t.start) + t.outputs[index], { last: { ...t, index } });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void generate();
    }
  };

  if (!story) return <StoryStart starting={starting} setStarting={setStarting} />;

  const shown = live ? live.base + (live.raw ? live.text : joinContinuation(live.base, cleanContinuation(live.text, live.base))) : story.text;
  const words = storyWordCount(shown);

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-800 px-2 py-1.5">
          <select value={story.id} onChange={(e) => void openStory(e.target.value)} className={cx(inputClass, 'w-auto max-w-[16rem] min-w-0 flex-1 py-1 text-xs')} aria-label="Story">
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.words} words
              </option>
            ))}
          </select>
          <IconButton title="New story" onClick={() => setStarting(true)}>
            ＋
          </IconButton>
          <IconButton
            title="Rename this story"
            onClick={async () => {
              const name = await textDialog({ title: 'Rename story', initial: story.name, confirmLabel: 'Rename' });
              if (name?.trim()) update({ name: name.trim() });
            }}
          >
            ✎
          </IconButton>
          <IconButton title="Save the story as a text file" onClick={() => downloadBlob(story.text, storyFileName(story.name), 'text/plain;charset=utf-8')}>
            ⬇
          </IconButton>
          <IconButton
            title="Delete this story"
            tone="danger"
            onClick={async () => {
              if (await confirmDialog({ title: `Delete "${story.name}"?`, body: 'The story is deleted for good.', confirmLabel: 'Delete', danger: true })) await deleteStory(story.id);
            }}
          >
            🗑
          </IconButton>
          <span className="ml-auto text-[11px] whitespace-nowrap text-slate-500" title="Words in the story, and its tokens (estimated)">
            {words} words · {formatTokens(countTextNow(shown))} tokens
          </span>
          <Button size="sm" variant={settingsOpen ? 'primary' : 'secondary'} onClick={() => setSettingsOpen(!settingsOpen)} title="Memory, author's note, Cast, lorebook and the model" aria-label="Story settings">
            📖{!phone && ' Story settings'}
          </Button>
        </div>
        <div className="min-h-0 flex-1 px-3 py-2 phone:px-2">
          <textarea
            ref={doc}
            value={shown}
            readOnly={running}
            onChange={(e) => update({ text: e.target.value })}
            onKeyDown={onKey}
            placeholder="Write the opening, or press Continue and let the model start."
            aria-label="The story"
            className={cx(inputClass, 'mx-auto block h-full max-w-3xl resize-none px-4 py-3 font-serif text-[15px] leading-relaxed phone:px-3', running && 'text-slate-300')}
            spellCheck
          />
        </div>
        <div className="mx-auto flex w-full max-w-3xl flex-shrink-0 flex-col gap-1.5 px-3 pb-2 phone:px-2">
          <div className="flex items-center gap-1.5">
            <input
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void generate();
                }
              }}
              placeholder="Steer the next part (optional): “the storm finally breaks”"
              className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs')}
              title="A one-off note for the next continuation only. The author's note (Story settings) stays for every one."
              aria-label="Steer the next part"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {running ? (
              <Button variant="danger" onClick={stop}>
                ■ Stop
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void generate()} title="The model writes on from where the story stops (Ctrl+Enter)">
                ✍ Continue
              </Button>
            )}
            <IconButton title="Write the latest part again" disabled={running || !take} onClick={() => void generate(true)}>
              ↻
            </IconButton>
            {take && take.outputs.length > 1 && (
              <span className="flex items-center text-xs text-slate-400">
                <IconButton title="Previous version" disabled={running || take.index === 0} onClick={() => swipe(-1)}>
                  ‹
                </IconButton>
                {take.index + 1}/{take.outputs.length}
                <IconButton title="Next version" disabled={running || take.index === take.outputs.length - 1} onClick={() => swipe(1)}>
                  ›
                </IconButton>
              </span>
            )}
            <IconButton title="Undo the last change to the story (a part written, a version picked)" disabled={running || !past.length} onClick={undo}>
              ↶
            </IconButton>
            <IconButton title="Redo that change to the story" disabled={running || !future.length} onClick={redo}>
              ↷
            </IconButton>
            {runId && (
              <IconButton title="See the prompt that was sent (and what came back)" onClick={() => inspectAssistRun(runId)}>
                🔍
              </IconButton>
            )}
            <span className="ml-auto text-[11px] text-slate-500">
              {phase === 'writing' && 'Writing…'}
              {phase === 'proofreading' && 'Proofreading…'}
              {!phase && trimmed && <span title="The story is longer than the connection's context size; its start was left out of the prompt.">Start left out (context size)</span>}
              {!phase && !trimmed && (rawText ? 'Text completion' : story.proofread ? 'Proofreading on' : '')}
            </span>
          </div>
          {stream.error && !running && <p className="text-xs text-red-400">{stream.error}</p>}
        </div>
      </div>
      {settingsOpen &&
        (phone ? (
          <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <StorySettings story={story} ctx={ctx} rawText={rawText} onClose={() => setSettingsOpen(false)} />
          </div>
        ) : (
          <aside className="flex w-[380px] max-w-[40%] flex-shrink-0 flex-col border-l border-slate-800">
            <StorySettings story={story} ctx={ctx} rawText={rawText} onClose={() => setSettingsOpen(false)} />
          </aside>
        ))}
      <NewStoryDialog open={starting} onClose={() => setStarting(false)} ctx={ctx} />
    </div>
  );
}

/** No story yet for this card. */
function StoryStart({ starting, setStarting }: { starting: boolean; setStarting: (v: boolean) => void }) {
  const ctx = useStoryContext();
  if (!ctx) return null;
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold text-slate-100">Write a story together</h2>
        <p className="mt-2 text-sm text-slate-400">
          One document that you and the model both write: type, press Continue, and it writes on from where you stop. The card&apos;s character, you, and anyone else in the Cast come in when the story mentions them, and so does the card&apos;s lorebook.
        </p>
        <Button variant="primary" className="mt-4" onClick={() => setStarting(true)}>
          Start a story…
        </Button>
      </div>
      <NewStoryDialog open={starting} onClose={() => setStarting(false)} ctx={ctx} />
    </div>
  );
}

/** Starts a story: from a greeting or a blank page, with the card's scenario
 *  as its memory. */
function NewStoryDialog({ open, onClose, ctx }: { open: boolean; onClose: () => void; ctx: StoryContext }) {
  const newStory = useStoryStore((s) => s.newStory);
  const [from, setFrom] = useState('0');
  const [memory, setMemory] = useState(true);
  const card = ctx.card;
  const greetings = [card.first_mes, ...card.alternate_greetings].map((g, i) => ({ value: String(i), label: i === 0 ? 'The first message' : `Alternate greeting ${i}`, text: g })).filter((g) => g.text.trim());
  const x = (t: string) => expandMacros(t, { char: card.name || 'Character', user: ctx.userName || 'User' });
  const start = async () => {
    const text = from === 'blank' ? '' : x(greetingText(card, Number(from))).trim();
    await newStory({ text, memory: memory ? x(card.scenario).trim() : '' });
    onClose();
  };
  const picked = greetings.find((g) => g.value === from);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New story"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void start()}>
            Start
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Open with
          <select value={greetings.some((g) => g.value === from) ? from : 'blank'} onChange={(e) => setFrom(e.target.value)} className={inputClass}>
            {greetings.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
            <option value="blank">A blank page</option>
          </select>
        </label>
        {picked && <p className="line-clamp-4 text-xs whitespace-pre-wrap text-slate-500">{x(picked.text)}</p>}
        {card.scenario.trim() && <Toggle checked={memory} onChange={setMemory} label="Put the card's scenario in the story's memory" />}
        <p className="text-xs text-slate-500">The card&apos;s character and your persona start in the Cast. Change any of it in 📖 Story settings.</p>
      </div>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold tracking-wide text-slate-300 uppercase">
        {label}
        {hint && <span className="ml-2 font-normal tracking-normal text-slate-500 normal-case">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** The story's memory, author's note, Cast, lorebook and model. */
function StorySettings({ story, ctx, rawText, onClose }: { story: StorySession; ctx: StoryContext; rawText: boolean; onClose: () => void }) {
  const update = useStoryStore((s) => s.update);
  const { chatConnectionId, storyPrompts, setStoryPrompts } = useLlmStore();
  const [showPrompts, setShowPrompts] = useState(false);
  const lore = useMemo(() => storyLore(story, ctx, { count: countTextNow, random: () => 0 }), [story, ctx]);
  const inPrompt = loreLabels(lore);
  const bookSize = ctx.card.character_book?.entries.length ?? 0;
  const setPersona = (id: string, patch: Partial<StoryPersona>) => update({ personae: story.personae.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  return (
    <>
      <div className="flex flex-shrink-0 items-center border-b border-slate-800 px-3 py-1.5">
        <span className="flex-1 text-sm font-semibold text-slate-200">📖 Story settings</span>
        <IconButton title="Close" onClick={onClose}>
          ✕
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        <Field label="Memory" hint="always at the top of the prompt">
          <AutoTextarea value={story.memory} onChange={(e) => update({ memory: e.target.value })} minRows={3} maxRows={12} placeholder="The premise, the setting, the style: what the model should always know." className="text-sm" aria-label="Memory" />
        </Field>
        <Field label="Author's note" hint="a few lines from the end, to steer">
          <AutoTextarea value={story.authorsNote} onChange={(e) => update({ authorsNote: e.target.value })} minRows={2} maxRows={8} placeholder="Tone, pacing, what should happen soon. {{char}} and {{user}} work." className="text-sm" aria-label="Author's note" />
        </Field>

        <Field label="Cast" hint="come in when their name is in the recent text">
          <div className="flex flex-col gap-2">
            {story.personae.map((p) => (
              <PersonaRow key={p.id} persona={p} ctx={ctx} active={lore.personae.some((a) => a.name === personaFields(p, ctx).name)} onChange={(patch) => setPersona(p.id, patch)} onRemove={() => update({ personae: story.personae.filter((x) => x.id !== p.id) })} />
            ))}
            <Button size="sm" className="self-start" onClick={() => update({ personae: [...story.personae, { id: uuid(), name: '', aliases: [], description: '', always: false, enabled: true }] })}>
              + Add someone
            </Button>
            <CastScan story={story} ctx={ctx} />
          </div>
        </Field>

        <Field label="Lorebook">
          <Toggle checked={story.useLorebook} onChange={(useLorebook) => update({ useLorebook })} label={bookSize ? `Use the card's lorebook (${bookSize} entries)` : "Use the card's lorebook (it has none yet)"} />
          <label className="flex items-center gap-2 text-xs text-slate-400" title="Names, aliases and lorebook keys are looked for in this many paragraphs from the end of the story">
            Look back
            <span className="w-16 flex-shrink-0">
              <NumberInput value={story.scanDepth} onChange={(v) => v && update({ scanDepth: v })} min={1} max={100} />
            </span>
            paragraphs
          </label>
          <div className="text-[11px] text-slate-500">
            {inPrompt.length ? (
              <>
                In the prompt now:{' '}
                {inPrompt.map((l, i) => (
                  <span key={i} title={l.reason === 'constant' ? 'Always in' : `Matched “${l.reason}”`}>
                    {i > 0 && ', '}
                    {l.kind === 'persona' ? '🎭 ' : '📚 '}
                    {l.name}
                  </span>
                ))}
              </>
            ) : (
              'Nothing from the Cast or the lorebook is in the prompt right now.'
            )}
          </div>
        </Field>

        <Field label="Model">
          <ConnectionPicker value={story.connectionId ?? chatConnectionId} onChange={(id) => update({ connectionId: id })} label="Writes with" />
          {rawText ? (
            <p className="text-[11px] text-slate-500">A text-completion connection: the model gets the memory, Cast, lore and story as one plain text and simply writes on, as NovelAI does.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                About
                <span className="w-20 flex-shrink-0">
                  <NumberInput value={story.words} onChange={(v) => v && update({ words: v })} min={20} max={4000} step={50} />
                </span>
                words a part
              </label>
              <Toggle checked={story.proofread} onChange={(proofread) => update({ proofread })} label="Proofread each part" title="A second call after each part: it drops repeats of the story's end and any commentary, and makes the first sentence join where the story stopped" />
              {story.proofread && <ConnectionPicker value={story.proofreadConnectionId ?? story.connectionId ?? chatConnectionId} onChange={(id) => update({ proofreadConnectionId: id })} label="Proofreads with" />}
            </>
          )}
          <button type="button" className="self-start text-[11px] text-violet-300 underline" onClick={() => setShowPrompts(!showPrompts)}>
            {showPrompts ? 'Hide the prompts' : 'Change the prompts…'}
          </button>
          {showPrompts && (
            <div className="flex flex-col gap-3">
              <PromptEditor label="Instructions (chat connections)" hint="{{words}}: the length above. Every story uses these." value={storyPrompts.instructions} fallback={DEFAULT_STORY_INSTRUCTIONS} onChange={(instructions) => setStoryPrompts({ instructions })} />
              <PromptEditor label="Proofreading" value={storyPrompts.proofread} fallback={DEFAULT_PROOFREAD_PROMPT} onChange={(proofread) => setStoryPrompts({ proofread })} />
            </div>
          )}
        </Field>
      </div>
    </>
  );
}

/** 🔍 Scan the story: the model lists named characters the Cast doesn't
 *  have yet, each to add or skip. */
function CastScan({ story, ctx }: { story: StorySession; ctx: StoryContext }) {
  const update = useStoryStore((s) => s.update);
  const { connections, chatConnectionId } = useLlmStore();
  const stream = useLlmStream();
  const [found, setFound] = useState<CastSuggestion[] | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const connection = connections.find((c) => c.id === (story.connectionId ?? chatConnectionId)) ?? null;

  const scan = async () => {
    if (!connection) return toast('Add an LLM connection in Settings first.', 'error');
    if (!story.text.trim()) return toast('There’s no story to scan yet.', 'error');
    setFound(null);
    const messages = castScanMessages(story, ctx);
    const id = logRun('Story: scan for Cast', connection, messages);
    setRunId(id);
    const r = await stream.run(connection, messages);
    useAssistLog.getState().update(id, { running: false, text: r.text, reasoning: r.reasoning, error: r.error });
    if (r.error) return toast(r.error, 'error');
    // Checked against the Cast as it is now, which may have changed meanwhile.
    const now = useStoryStore.getState().story ?? story;
    const list = parseCastSuggestions(r.text, castNames(now.personae, ctx));
    if (!list) return toast('The scan’s reply wasn’t a list of characters. 🔍 shows what came back.', 'error');
    setFound(list);
  };

  const add = (picked: CastSuggestion[]) => {
    const now = useStoryStore.getState().story;
    if (!now) return;
    update({ personae: [...now.personae, ...picked.map((c) => ({ id: uuid(), name: c.name, aliases: c.aliases, description: c.description, always: false, enabled: true }))] });
    setFound((f) => (f ? f.filter((c) => !picked.includes(c)) : f));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {stream.running ? (
          <Button size="sm" variant="danger" onClick={stream.stop}>
            ■ Stop scanning
          </Button>
        ) : (
          <Button size="sm" onClick={() => void scan()} title="The model reads the story and suggests named characters who aren't in the Cast yet, for you to add or skip">
            🔍 Scan the story
          </Button>
        )}
        {runId && !stream.running && (
          <IconButton title="See what the scan was asked and what came back" onClick={() => inspectAssistRun(runId)}>
            🔍
          </IconButton>
        )}
      </div>
      {found && found.length === 0 && <p className="text-[11px] text-slate-500">No one new: everyone named in the story is in the Cast.</p>}
      {found && found.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-violet-500/30 p-2">
          <div className="flex items-center text-xs text-slate-300">
            <span className="flex-1">New in the story:</span>
            {found.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => add(found)}>
                Add all
              </Button>
            )}
            <IconButton title="Skip them all" onClick={() => setFound(null)}>
              ✕
            </IconButton>
          </div>
          {found.map((c) => (
            <div key={c.name} className="flex items-start gap-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="text-slate-200">
                  {c.name}
                  {c.aliases.length > 0 && <span className="text-slate-500"> ({c.aliases.join(', ')})</span>}
                </div>
                {c.description && <p className="text-slate-500">{c.description}</p>}
              </div>
              <Button size="sm" onClick={() => add([c])}>
                Add
              </Button>
              <IconButton title="Skip" onClick={() => setFound((f) => (f ? f.filter((x) => x !== c) : f))}>
                ✕
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PromptEditor({ label, hint, value, fallback, onChange }: { label: string; hint?: string; value: string | undefined; fallback: string; onChange: (v: string | undefined) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="flex-1">{label}</span>
        {value !== undefined && (
          <button type="button" className="text-[11px] text-violet-300 underline" onClick={() => onChange(undefined)}>
            Reset
          </button>
        )}
      </div>
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      <AutoTextarea value={value ?? fallback} onChange={(e) => onChange(e.target.value === fallback ? undefined : e.target.value)} minRows={4} maxRows={16} className="font-mono text-xs" aria-label={label} />
    </div>
  );
}

function PersonaRow({ persona: p, ctx, active, onChange, onRemove }: { persona: StoryPersona; ctx: StoryContext; active: boolean; onChange: (patch: Partial<StoryPersona>) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(!p.link && !p.name);
  const f = personaFields(p, ctx);
  const linked = p.link === 'char' ? "from the card's character" : p.link === 'user' ? 'from your persona' : null;
  return (
    <div className={cx('rounded-md border', active ? 'border-violet-500/40' : 'border-slate-800', !p.enabled && 'opacity-50')}>
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button type="button" className="min-w-0 flex-1 truncate text-left text-sm text-slate-200" onClick={() => setOpen(!open)} title={open ? 'Fold' : 'Edit'}>
          {open ? '▾' : '▸'} {f.name || <em className="text-slate-500">Unnamed</em>}
          {linked && <span className="ml-1.5 text-[10px] text-slate-500">{linked}</span>}
          {active && <span className="ml-1.5 text-[10px] text-violet-300" title="In the prompt right now">● in</span>}
        </button>
        <Toggle checked={p.enabled} onChange={(enabled) => onChange({ enabled })} title="On: can come into the prompt" />
        <IconButton title="Remove" tone="danger" onClick={onRemove}>
          ✕
        </IconButton>
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t border-slate-800 px-2 py-2">
          {linked ? (
            <div className="flex flex-col gap-1 text-xs text-slate-400">
              <p className="line-clamp-4 whitespace-pre-wrap text-slate-500">{f.description || '(no description)'}</p>
              <span>
                Read live {linked}.{' '}
                <button type="button" className="text-violet-300 underline" onClick={() => onChange({ link: undefined, name: f.name, description: p.link === 'char' ? f.description : ctx.userDescription })}>
                  Make a copy to change for this story
                </button>
              </span>
            </div>
          ) : (
            <>
              <input value={p.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Name" className={cx(inputClass, 'py-1 text-sm')} aria-label="Name" />
              <AutoTextarea value={p.description} onChange={(e) => onChange({ description: e.target.value })} minRows={3} maxRows={12} placeholder="Who they are: looks, manner, what they want." className="text-sm" aria-label="Description" />
            </>
          )}
          <div className="flex flex-col gap-1 text-xs text-slate-400">
            Other names
            <ChipInput values={p.aliases} onChange={(aliases) => onChange({ aliases })} placeholder="Nicknames, titles (Enter to add)" />
          </div>
          <Toggle checked={p.always} onChange={(always) => onChange({ always })} label="Always in the prompt" />
        </div>
      )}
    </div>
  );
}
