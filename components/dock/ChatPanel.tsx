'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useChatStore } from '@/store/chatStore';
import { useLlmStore } from '@/store/llmStore';
import { useBridgeStore } from '@/store/bridgeStore';
import { toast } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { buildChatPrompt, displayText, greetingText, messageText, newMessage, type BuildOptions, type BuiltPrompt } from '@/lib/chatPrompt';
import { buildPresetPrompt } from '@/lib/presetPrompt';
import { presetParams } from '@/lib/stPreset';
import { describeEntry } from '@/lib/lorebookScan';
import { AutoTextarea, Button, IconButton, Modal, TokenBadge, Toggle, confirmDialog, cx, inputClass } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { PresetPicker } from '@/components/llm/PresetManager';
import { PersonaAvatar, PersonaPicker } from '@/components/llm/Personas';
import { resolvePersona, usePersonaStore } from '@/store/personaStore';
import { openSettings } from '@/components/SettingsDialog';
import type { Persona } from '@/types/project';
import { useTextTokens, formatTokens } from '@/lib/textTokens';
import type { CardData } from '@/types/card';
import type { ChatMessage } from '@/types/project';

// Test-chatting the card, built the way SillyTavern builds its prompt (see
// lib/chatPrompt.ts), with swipes, edits, the greeting read live from the
// card, and an inspector showing exactly what was sent.

export function ChatPanel() {
  const project = useProjectStore((s) => s.project);
  const { chat, list, loadFor, newChat, openChat, deleteChat, rename, setGreeting, setMessages } = useChatStore();
  const { connections, chatConnectionId, setChatConnection, chatSettings, presets } = useLlmStore();
  const personas = usePersonaStore((s) => s.personas);
  const connection = connections.find((c) => c.id === chatConnectionId) ?? null;
  const pending = useBridgeStore((s) => s.chatGreeting);
  const clearPending = useBridgeStore((s) => s.clearChat);
  const { run, stop, running, text: streamText, reasoning: streamReasoning, error } = useLlmStream();
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [inspect, setInspect] = useState<BuiltPrompt | null>(null);
  const [lastPrompt, setLastPrompt] = useState<BuiltPrompt | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (project) void loadFor(project.id);
  }, [project?.id, loadFor]); // eslint-disable-line react-hooks/exhaustive-deps

  // A greeting's 💬 in the editor opens a fresh chat with it.
  useEffect(() => {
    if (pending === null || !project || useChatStore.getState().projectId !== project.id) return;
    clearPending();
    void newChat(pending);
  }, [pending, project, clearPending, newChat, list]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [chat?.messages.length, streamText]);

  if (!project) return null;
  const card = project.card.data;
  const greetingCount = 1 + card.alternate_greetings.length;

  /** The chat as the model sees it: the live greeting, then the messages. */
  const history = (messages: ChatMessage[]) => {
    const g = chat ? greetingText(card, chat.greeting) : '';
    return g.trim() ? [{ ...newMessage('assistant', g), id: 'greeting' }, ...messages] : messages;
  };

  // Who {{user}} is in this chat: its locked persona, the active one, or
  // the plain name and description.
  const me = resolvePersona(personas, chatSettings, chat);
  const settings = { ...chatSettings, userName: me.name, persona: me.description };
  const preset = chatSettings.presetId ? (presets.find((p) => p.id === chatSettings.presetId) ?? null) : null;
  const overrides = preset && chatSettings.presetSamplers && connection ? presetParams(preset, connection.kind) : {};

  /** The prompt for `messages` (greeting added), through the preset if one is on. */
  const build = (messages: ChatMessage[], opts: BuildOptions = {}): BuiltPrompt => {
    const full = { model: connection?.model, kind: connection?.kind, maxTokens: overrides.max_tokens ?? connection?.params.max_tokens, ...opts };
    return preset ? buildPresetPrompt(card, history(messages), settings, preset, full) : buildChatPrompt(card, history(messages), settings, full);
  };

  /** Streams a completion for `built`, calling `onText` with the reply so far. */
  const complete = (built: BuiltPrompt, onText: (full: string) => void) => {
    setLastPrompt(built);
    const messages = built.prefill !== undefined ? [...built.messages, { role: 'assistant' as const, content: built.prefill }] : built.messages;
    return run(connection, messages, onText, { prefill: built.prefill !== undefined, params: overrides });
  };

  /**
   * Generates a reply after `messages`: a new message, or with `target` a
   * new swipe of that message (the prompt then stops before it). With
   * `continueFrom`, the model carries on from the target's text, by
   * prefilling it or with the preset's continue nudge.
   */
  const reply = async (messages: ChatMessage[], target?: ChatMessage, continueFrom?: string, emptySend = false) => {
    const built = continueFrom !== undefined
      ? build(messages, { mode: 'continue', continueText: continueFrom })
      : build(target ? messages.filter((m) => m.id !== target.id) : messages, { emptySend });
    const id = target?.id ?? crypto.randomUUID();
    const base = continueFrom ?? '';
    setStreamingId(id);
    if (!target) setMessages((m) => [...m, { ...newMessage('assistant', '', connection?.model), id }]);
    else if (continueFrom === undefined) setMessages((m) => m.map((x) => (x.id === id ? { ...x, swipes: [...x.swipes, ''], swipe: x.swipes.length } : x)));
    const r = await complete(built, (full) =>
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, swipes: x.swipes.map((s, i) => (i === x.swipe ? base + (continueFrom && !/^\s/.test(full) && !/\s$/.test(base) ? ' ' : '') + full : s)) } : x))),
    );
    setStreamingId(null);
    setMessages((m) =>
      m
        .map((x) => {
          if (x.id !== id) return x;
          const reasoning = x.swipes.map((_, i) => (i === x.swipe ? r.reasoning || x.reasoning?.[i] : x.reasoning?.[i]));
          return { ...x, model: connection?.model, reasoning };
        })
        // A reply that failed before writing anything is taken back out.
        .filter((x) => !(x.id === id && !target && !messageText(x).trim())),
    );
    if (r.error) toast(r.error, 'error');
  };

  const send = async () => {
    if (running || !chat) return;
    const text = input.trim();
    const messages = text ? [...chat.messages, newMessage('user', text)] : chat.messages;
    if (text) {
      setMessages(() => messages);
      setInput('');
    }
    await reply(messages, undefined, undefined, !text);
  };

  const regenerate = async () => {
    if (!chat || running) return;
    const last = chat.messages[chat.messages.length - 1];
    if (last?.role === 'assistant') await reply(chat.messages, last);
    else await reply(chat.messages);
  };

  const continueLast = async () => {
    if (!chat || running) return;
    const last = chat.messages[chat.messages.length - 1];
    if (last?.role !== 'assistant') return reply(chat.messages);
    await reply(chat.messages, last, messageText(last));
  };

  /** Writes your next message for you, into the box, to edit and send. */
  const impersonate = async () => {
    if (!chat || running) return;
    setInput('');
    const r = await complete(build(chat.messages, { mode: 'impersonate' }), (full) => setInput(full));
    if (r.error) toast(r.error, 'error');
    else setInput(r.text.trim());
  };

  const preview = () => setInspect(build(chat?.messages ?? []));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-slate-800 p-2">
        <select value={chat?.id ?? ''} onChange={(e) => e.target.value && void openChat(e.target.value)} className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs')}>
          {!chat && <option value="">No chat open</option>}
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.messageCount})
            </option>
          ))}
        </select>
        <Button size="sm" variant="primary" onClick={() => void newChat(0)}>
          + New
        </Button>
        {chat && (
          <>
            <IconButton
              title="Rename"
              onClick={() => {
                const name = prompt('Chat name', chat.name);
                if (name?.trim()) rename(name.trim());
              }}
            >
              ✎
            </IconButton>
            <IconButton
              title="Delete this chat"
              tone="danger"
              onClick={async () => {
                if (await confirmDialog({ title: `Delete "${chat.name}"?`, confirmLabel: 'Delete', danger: true })) await deleteChat(chat.id);
              }}
            >
              🗑
            </IconButton>
          </>
        )}
        <IconButton title="Show the prompt the next reply would send" onClick={preview}>
          🔍
        </IconButton>
        <PersonaPicker onManage={() => openSettings('personas')} />
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          title={preset ? `Every chat uses the "${preset.name}" preset. Click to change it.` : 'No preset: the built-in prompt. Click to import or pick a SillyTavern preset.'}
          className={cx('max-w-28 truncate rounded px-1.5 py-0.5 text-[10px]', preset ? 'bg-violet-500/15 text-violet-300' : 'bg-slate-800 text-slate-500')}
        >
          {preset ? preset.name : 'Built-in prompt'}
        </button>
        <IconButton title="Chat settings: connection, persona, prompt" onClick={() => setShowSettings(!showSettings)}>
          ⚙
        </IconButton>
      </div>

      {showSettings && <ChatSettings onClose={() => setShowSettings(false)} />}
      {!showSettings && <ConnectionPicker value={chatConnectionId} onChange={setChatConnection} label="Model" className="flex-shrink-0 border-b border-slate-800 px-2 py-1.5" />}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!chat ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
            Test how the card plays.
            <Button variant="primary" onClick={() => void newChat(0)}>
              Start a chat
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <GreetingBubble card={card} index={chat.greeting} count={greetingCount} onSwipe={setGreeting} userName={me.name} />
            {chat.messages.map((m, i) => (
              <Bubble
                key={m.id}
                card={card}
                message={m}
                userName={me.name}
                persona={me.persona}
                streaming={streamingId === m.id}
                streamReasoning={streamingId === m.id ? streamReasoning : ''}
                isLast={i === chat.messages.length - 1}
                busy={running}
                onChange={(patch) => setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, ...patch } : x)))}
                onDelete={() => setMessages((ms) => ms.filter((x) => x.id !== m.id))}
                onDeleteAfter={() => setMessages((ms) => ms.slice(0, i + 1))}
                onSwipeNew={() => void reply(chat.messages, m)}
              />
            ))}
            {error && !running && <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
            <div ref={bottom} />
          </div>
        )}
      </div>

      {chat && (
        <div className="flex-shrink-0 border-t border-slate-800 p-2">
          <AutoTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            minRows={2}
            maxRows={10}
            placeholder={`Message as ${me.name}… (Enter sends, Shift+Enter for a new line; empty Enter asks for a reply)`}
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            {running ? (
              <Button size="sm" variant="danger" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => void send()}>
                Send
              </Button>
            )}
            <Button size="sm" disabled={running} onClick={() => void regenerate()} title="Another version of the last reply">
              ↻ Regenerate
            </Button>
            <Button size="sm" disabled={running} onClick={() => void continueLast()} title="Continue the last reply">
              → Continue
            </Button>
            <Button size="sm" disabled={running} onClick={() => void impersonate()} title="Write your next message for you (it lands in the box to edit)">
              🎭 Impersonate
            </Button>
            {lastPrompt && (
              <button type="button" className="ml-auto text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setInspect(lastPrompt)}>
                Last prompt · {lastPrompt.lore.active.length} lore
              </button>
            )}
          </div>
        </div>
      )}
      {inspect && <PromptInspector prompt={inspect} onClose={() => setInspect(null)} />}
    </div>
  );
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** *actions* in italics and "speech" highlighted, as frontends show them. */
function Formatted({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|"[^"\n]*")/g);
  return (
    <div className="chat-text text-sm leading-relaxed whitespace-pre-wrap text-slate-200">
      {parts.map((p, i) =>
        p.startsWith('*') && p.endsWith('*') && p.length > 1 ? (
          <em key={i}>{p.slice(1, -1)}</em>
        ) : p.startsWith('"') && p.endsWith('"') && p.length > 1 ? (
          <q key={i}>{p}</q>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </div>
  );
}

function Avatar({ role, persona }: { role: 'user' | 'assistant' | 'system'; persona?: Persona | null }) {
  const project = useProjectStore((s) => s.project);
  const url = project?.avatar ? `/api/projects/${project.id}/avatar?v=${project.avatar.version}` : null;
  if (role === 'user') return <PersonaAvatar persona={persona} />;
  return (
    <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-slate-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" className="h-full w-full object-cover object-top" />}
    </div>
  );
}

function GreetingBubble({ card, index, count, onSwipe, userName }: { card: CardData; index: number; count: number; onSwipe: (i: number) => void; userName: string }) {
  const text = greetingText(card, index);
  return (
    <div className="flex gap-2">
      <Avatar role="assistant" />
      <div className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2">
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-200">{card.nickname || card.name || 'Character'}</span>
          <span className="text-slate-500">greeting · live from the card</span>
          {count > 1 && (
            <span className="ml-auto flex items-center gap-1 text-slate-400">
              <IconButton title="Previous greeting" onClick={() => onSwipe(index <= 0 ? count - 1 : index - 1)}>
                ‹
              </IconButton>
              <span className="tabular-nums">
                {index + 1}/{count}
              </span>
              <IconButton title="Next greeting" onClick={() => onSwipe(index >= count - 1 ? 0 : index + 1)}>
                ›
              </IconButton>
            </span>
          )}
        </div>
        {text.trim() ? <Formatted text={displayText(card, text, userName)} /> : <em className="text-sm text-slate-500">This greeting is empty.</em>}
      </div>
    </div>
  );
}

function Bubble({
  card,
  message: m,
  userName,
  persona,
  streaming,
  streamReasoning,
  isLast,
  busy,
  onChange,
  onDelete,
  onDeleteAfter,
  onSwipeNew,
}: {
  card: CardData;
  message: ChatMessage;
  userName: string;
  persona: Persona | null;
  streaming: boolean;
  streamReasoning: string;
  isLast: boolean;
  busy: boolean;
  onChange: (patch: Partial<ChatMessage>) => void;
  onDelete: () => void;
  onDeleteAfter: () => void;
  onSwipeNew: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const text = messageText(m);
  const tokens = useTextTokens(text, 800);
  const reasoning = streaming ? streamReasoning : m.reasoning?.[m.swipe];
  const isUser = m.role === 'user';
  return (
    <div className={cx('group flex gap-2', isUser && 'flex-row-reverse')}>
      <Avatar role={m.role} persona={persona} />
      <div className={cx('min-w-0 flex-1 rounded-lg px-3 py-2', isUser ? 'bg-sky-500/10' : 'bg-slate-900')}>
        <div className={cx('mb-1 flex items-center gap-2 text-xs', isUser && 'flex-row-reverse')}>
          <span className="font-semibold text-slate-200">{isUser ? userName || 'User' : card.nickname || card.name || 'Character'}</span>
          {m.model && !isUser && <span className="truncate text-slate-600">{m.model}</span>}
          <span className={cx('flex items-center gap-0.5 opacity-0 group-hover:opacity-100', isUser ? 'mr-auto' : 'ml-auto')}>
            <span className="mr-1 text-[10px] text-slate-600">{formatTokens(tokens)} tok</span>
            <IconButton title="Edit" disabled={busy} onClick={() => setEditing(text)}>
              ✎
            </IconButton>
            <IconButton title="Copy" onClick={() => void navigator.clipboard.writeText(text)}>
              ⧉
            </IconButton>
            {!isLast && (
              <IconButton title="Delete everything after this" tone="danger" disabled={busy} onClick={onDeleteAfter}>
                ⤓
              </IconButton>
            )}
            <IconButton title="Delete message" tone="danger" disabled={busy} onClick={onDelete}>
              🗑
            </IconButton>
          </span>
        </div>
        {reasoning && (
          <details className="mb-1 text-xs text-slate-500" open={streaming && !text}>
            <summary className="cursor-pointer">Reasoning</summary>
            <div className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap">{reasoning}</div>
          </details>
        )}
        {editing !== null ? (
          <div className="flex flex-col gap-1.5">
            <AutoTextarea autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} minRows={3} maxRows={20} />
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onChange({ swipes: m.swipes.map((s, i) => (i === m.swipe ? editing : s)) });
                  setEditing(null);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        ) : text ? (
          <Formatted text={isUser ? displayText(card, text, userName) : text} />
        ) : (
          <span className="animate-pulse text-sm text-slate-500">…</span>
        )}
        {!isUser && isLast && (
          <div className="mt-1.5 flex items-center justify-end gap-1 text-xs text-slate-400">
            {m.swipes.length > 1 && (
              <>
                <IconButton title="Previous version" disabled={busy || m.swipe === 0} onClick={() => onChange({ swipe: m.swipe - 1 })}>
                  ‹
                </IconButton>
                <span className="tabular-nums">
                  {m.swipe + 1}/{m.swipes.length}
                </span>
              </>
            )}
            <IconButton title={m.swipe < m.swipes.length - 1 ? 'Next version' : 'Generate another version'} disabled={busy} onClick={() => (m.swipe < m.swipes.length - 1 ? onChange({ swipe: m.swipe + 1 }) : onSwipeNew())}>
              ›
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings and inspector ──────────────────────────────────────────────────

function ChatSettings({ onClose }: { onClose: () => void }) {
  const { chatSettings: s, setChatSettings, chatConnectionId, setChatConnection } = useLlmStore();
  const usingPreset = !!s.presetId;
  const personas = usePersonaStore((st) => st.personas);
  const chat = useChatStore((st) => st.chat);
  const usingPersona = !!resolvePersona(personas, s, chat).persona;
  return (
    <div className="flex max-h-[55%] flex-shrink-0 flex-col gap-3 overflow-y-auto border-b border-slate-800 bg-slate-950 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Chat settings</span>
        <IconButton title="Close" onClick={onClose}>
          ✕
        </IconButton>
      </div>
      <ConnectionPicker value={chatConnectionId} onChange={setChatConnection} label="Model" />
      <PresetPicker />
      {usingPersona ? (
        <div className="flex items-center justify-between rounded-md border border-slate-800 px-2 py-1.5 text-xs text-slate-400">
          You&apos;re chatting as a persona; its name and description apply.
          <button type="button" className="text-violet-300 hover:underline" onClick={() => openSettings('personas')}>
            Edit personas
          </button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Your name ({'{{user}}'})
            <input value={s.userName} onChange={(e) => setChatSettings({ userName: e.target.value })} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            <span>
              Your description{' '}
              <button type="button" className="text-violet-300 hover:underline" onClick={() => openSettings('personas')}>
                or save personas
              </button>
            </span>
            <input value={s.persona} onChange={(e) => setChatSettings({ persona: e.target.value })} placeholder="Optional: who you are in the chat" className={inputClass} />
          </label>
        </div>
      )}
      {!usingPreset && (
        <>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            <span className="flex justify-between">
              Main prompt <TokenBadge text={s.mainPrompt} />
            </span>
            <AutoTextarea value={s.mainPrompt} onChange={(e) => setChatSettings({ mainPrompt: e.target.value })} minRows={2} maxRows={8} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Default post-history instructions
            <AutoTextarea value={s.defaultPostHistory} onChange={(e) => setChatSettings({ defaultPostHistory: e.target.value })} minRows={1} maxRows={6} placeholder="Optional, sent after the chat" />
          </label>
        </>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Toggle checked={s.useCardSystemPrompt} onChange={(v) => setChatSettings({ useCardSystemPrompt: v })} label={<span className="text-xs">Card&apos;s system prompt replaces {usingPreset ? 'Main Prompt' : 'the main prompt'}</span>} />
        <Toggle checked={s.useCardPostHistory} onChange={(v) => setChatSettings({ useCardPostHistory: v })} label={<span className="text-xs">Card&apos;s post-history instructions replace {usingPreset ? 'Post-History Instructions' : 'the default'}</span>} />
        <Toggle checked={s.includeExamples} onChange={(v) => setChatSettings({ includeExamples: v })} label={<span className="text-xs">Send example messages</span>} />
        <Toggle checked={s.useLorebook} onChange={(v) => setChatSettings({ useLorebook: v })} label={<span className="text-xs">Use the lorebook</span>} />
      </div>
    </div>
  );
}

function PromptInspector({ prompt, onClose }: { prompt: BuiltPrompt; onClose: () => void }) {
  const all = useMemo(() => prompt.parts.map((p) => p.content).join('\n\n'), [prompt]);
  const total = useTextTokens(all, 0);
  return (
    <Modal open onClose={onClose} title={`Prompt · ~${formatTokens(total)} tokens`} size="lg" footer={<Button onClick={() => void navigator.clipboard.writeText(JSON.stringify(prompt.messages, null, 2))}>Copy as JSON</Button>}>
      <div className="flex flex-col gap-3">
        {(prompt.prefill !== undefined || prompt.droppedHistory > 0) && (
          <div className="text-xs text-amber-300">
            {prompt.droppedHistory > 0 && <div>{prompt.droppedHistory} oldest messages left out to fit the preset&apos;s context size.</div>}
            {prompt.prefill !== undefined && <div>The reply starts from a prefill: “{prompt.prefill.slice(0, 120)}{prompt.prefill.length > 120 ? '…' : ''}”</div>}
          </div>
        )}
        <div className="text-xs text-slate-400">
          Lorebook: {prompt.lore.active.length ? prompt.lore.active.map((a) => `${describeEntry(a)} (${a.reason})`).join(' · ') : 'nothing fired'}
          {prompt.lore.dropped.length > 0 && <span className="text-amber-300"> · over budget: {prompt.lore.dropped.map(describeEntry).join(', ')}</span>}
        </div>
        {prompt.parts.map((p, i) => (
          <div key={i} className="rounded-md border border-slate-800">
            <div className="flex items-center gap-2 border-b border-slate-800 px-2.5 py-1 text-xs">
              <span className={cx('rounded px-1.5 text-[10px] uppercase', p.role === 'system' ? 'bg-violet-500/15 text-violet-300' : p.role === 'user' ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300')}>{p.role}</span>
              <span className="text-slate-300">{p.label}</span>
              <TokenBadge text={p.content} className="ml-auto" />
            </div>
            <div className="max-h-48 overflow-y-auto px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-slate-400">{p.content}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
