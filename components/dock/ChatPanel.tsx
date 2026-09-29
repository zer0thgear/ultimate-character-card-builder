'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useChatStore } from '@/store/chatStore';
import { useLlmStore } from '@/store/llmStore';
import { useBridgeStore } from '@/store/bridgeStore';
import { toast, useUiStore } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { buildChatPrompt, displayText, greetingText, messageText, newMessage, type AvatarShape, type BuildOptions, type BuiltPrompt, DEFAULT_GUIDE_TEMPLATE } from '@/lib/chatPrompt';
import { buildPresetPrompt } from '@/lib/presetPrompt';
import { presetParams } from '@/lib/stPreset';
import { describeEntry } from '@/lib/lorebookScan';
import { AutoTextarea, Button, IconButton, Modal, TokenBadge, Toggle, confirmDialog, cx, downloadBlob, enterSends, inputClass } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { PresetPicker } from '@/components/llm/PresetManager';
import { PersonaAvatar, PersonaPicker, avatarFrame } from '@/components/llm/Personas';
import { openLightbox } from '@/components/Lightbox';
import { addContinue, addReroll, branchCount, choose, onPath, pathDepth, pathText, rerollBase, startTree, undoContinue, type ContinueNode } from '@/lib/continueTree';
import { api } from '@/lib/api';
import { resolvePersona, usePersonaStore } from '@/store/personaStore';
import { openSettings } from '@/components/SettingsDialog';
import { useMediaQuery, PHONE_QUERY } from '@/hooks/useMediaQuery';
import { useKeyboard } from '@/hooks/useKeyboard';
import { chatFileName, chatToStJsonl, chatToText } from '@/lib/chatExport';
import type { Persona } from '@/types/project';
import { useTextTokens, formatTokens } from '@/lib/textTokens';
import type { CardData } from '@/types/card';
import type { ChatMessage } from '@/types/project';
import { uuid } from '@/lib/uuid';
import { copyText } from '@/lib/clipboard';
import { formatChat, type FormatNode } from '@/lib/chatFormat';

// Test-chatting the card, built the way SillyTavern builds its prompt (see
// lib/chatPrompt.ts), with swipes, edits, the greeting read live from the
// card, and an inspector showing exactly what was sent.

export function ChatPanel() {
  const project = useProjectStore((s) => s.project);
  const { chat, list, loadFor, newChat, openChat, deleteChat, rename, setGreeting, setMessages } = useChatStore();
  const { connections, chatConnectionId, setChatConnection, chatSettings, presets } = useLlmStore();
  const personas = usePersonaStore((s) => s.personas);
  const phone = useMediaQuery(PHONE_QUERY);
  const keyboard = useKeyboard((s) => s.open);
  // With the dock filling the window, the chat keeps to a centred column.
  const full = useUiStore((s) => s.fullPane === 'dock') && !phone;
  const { chatFullWidth, setChatFullWidth } = useUiStore();
  /** The full-window column: a share of the window, centred. */
  const column = full ? { className: 'mx-auto w-full', style: { maxWidth: `${Math.round(chatFullWidth * 100)}%` } } : {};
  const connection = connections.find((c) => c.id === chatConnectionId) ?? null;
  const pending = useBridgeStore((s) => s.chatGreeting);
  const clearPending = useBridgeStore((s) => s.clearChat);
  const { run, stop, running, text: streamText, reasoning: streamReasoning, error } = useLlmStream();
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [inspect, setInspect] = useState<BuiltPrompt | null>(null);
  const [lastPrompt, setLastPrompt] = useState<BuiltPrompt | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  // 🧭 A guide for the next generation: used once, unless pinned.
  const [guide, setGuide] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [guidePinned, setGuidePinned] = useState(false);
  const [treeFor, setTreeFor] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // Following the chat's end: true while you're at the bottom. Scrolling up
  // stops it, and so does a reply growing past the top of the view.
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  // ↓ during a reply: follow its end, not its start, until the next one.
  const chase = useRef(false);

  useEffect(() => {
    if (project) void loadFor(project.id);
  }, [project?.id, loadFor]); // eslint-disable-line react-hooks/exhaustive-deps

  // A greeting's 💬 in the editor opens a fresh chat with it.
  useEffect(() => {
    if (pending === null || !project || useChatStore.getState().projectId !== project.id) return;
    clearPending();
    void newChat(pending);
  }, [pending, project, clearPending, newChat, list]);

  // New text scrolls into view while following, but never past the start of
  // the reply being written, so it can be read from the top as it streams.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !follow.current) return;
    let target = el.scrollHeight - el.clientHeight;
    const writing = streamingId && !chase.current ? el.querySelector<HTMLElement>(`[data-msg="${streamingId}"]`) : null;
    if (writing) target = Math.min(target, writing.offsetTop - 8);
    if (target > el.scrollTop) el.scrollTop = target;
    // Held at the reply's start with more below: stop following (↓ shows).
    if (writing && el.scrollHeight - el.scrollTop - el.clientHeight >= 60) {
      follow.current = false;
      setTimeout(() => setFollowing(false));
    }
  }, [chat?.messages.length, streamText, streamingId]);

  // A chat opens at its end.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    follow.current = true;
    el.scrollTop = el.scrollHeight;
  }, [chat?.id]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    follow.current = atEnd;
    if (atEnd !== following) setFollowing(atEnd);
  };
  const toEnd = () => {
    const el = scroller.current;
    if (!el) return;
    follow.current = true;
    chase.current = true;
    setFollowing(true);
    el.scrollTop = el.scrollHeight;
  };

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
  const showIds = chatSettings.showMessageIds;
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
  const reply = async (messages: ChatMessage[], target?: ChatMessage, continueFrom?: string, emptySend = false): Promise<{ text: string; error?: string }> => {
    const guided = takeGuide();
    const built = continueFrom !== undefined
      ? build(messages, { mode: 'continue', continueText: continueFrom, guide: guided })
      : build(target ? messages.filter((m) => m.id !== target.id) : messages, { emptySend, guide: guided });
    const id = target?.id ?? uuid();
    const base = continueFrom ?? '';
    let written = base;
    setStreamingId(id);
    if (!target) setMessages((m) => [...m, { ...newMessage('assistant', '', connection?.model), id }]);
    else if (continueFrom === undefined) setMessages((m) => m.map((x) => (x.id === id ? { ...x, swipes: [...x.swipes, ''], swipe: x.swipes.length } : x)));
    const r = await complete(built, (full) => {
      written = base + (continueFrom && full && !/^\s/.test(full) && !/\s$/.test(base) ? ' ' : '') + full;
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, swipes: x.swipes.map((s, i) => (i === x.swipe ? written : s)) } : x)));
    });
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
    return { text: written, error: r.error };
  };

  /** The guide for this generation, cleared unless it's pinned. */
  const takeGuide = () => {
    const g = guide.trim();
    if (g && !guidePinned) setGuide('');
    return g || undefined;
  };

  /** Sets a reply's continue tree for its shown swipe, and its text to match. */
  const setTree = (id: string, tree: ContinueNode) =>
    setMessages((m) =>
      m.map((x) => {
        if (x.id !== id) return x;
        const continues = x.swipes.map((_, i) => (i === x.swipe ? tree : x.continues?.[i]));
        return { ...x, continues, swipes: x.swipes.map((s, i) => (i === x.swipe ? pathText(tree) : s)) };
      }),
    );
  /** The shown swipe's tree, started from its text if it has none yet (or
   *  its text no longer matches, after an edit). */
  const treeOf = (m: ChatMessage) => {
    const t = m.continues?.[m.swipe];
    return t && pathText(t) === messageText(m) ? t : startTree(messageText(m));
  };

  /** ↻ Another version of the last continue, beside the old one. */
  const rerollContinue = async (m: ChatMessage) => {
    if (!chat || running) return;
    const tree = treeOf(m);
    const base = rerollBase(tree);
    if (base === null) return;
    const r = await reply(chat.messages, m, base);
    const added = r.text.slice(base.length);
    setTree(m.id, added.trim() ? addReroll(tree, added) : tree);
  };
  /** ↶ Takes the last continue back off (it stays in the tree). */
  const undoLastContinue = (m: ChatMessage) => setTree(m.id, undoContinue(treeOf(m)));

  const send = async () => {
    if (running || !chat) return;
    const text = input.trim();
    const messages = text ? [...chat.messages, newMessage('user', text)] : chat.messages;
    if (text) {
      setMessages(() => messages);
      setInput('');
    }
    follow.current = true;
    chase.current = false;
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
    if (last?.role !== 'assistant') return void (await reply(chat.messages));
    const tree = treeOf(last);
    const base = pathText(tree);
    const r = await reply(chat.messages, last, base);
    const added = r.text.slice(base.length);
    setTree(last.id, added.trim() ? addContinue(tree, added) : tree);
  };

  /** Writes your next message for you, into the box, to edit and send. */
  const impersonate = async () => {
    if (!chat || running) return;
    setInput('');
    const r = await complete(build(chat.messages, { mode: 'impersonate', guide: takeGuide() }), (full) => setInput(full));
    if (r.error) toast(r.error, 'error');
    else setInput(r.text.trim());
  };

  const sendButton = running ? (
    <Button size="sm" variant="danger" onClick={stop} className={cx(phone && 'px-4')}>
      Stop
    </Button>
  ) : (
    <Button size="sm" variant="primary" onClick={() => void send()} className={cx(phone && 'px-4')}>
      Send
    </Button>
  );

  const preview = () => setInspect(build(chat?.messages ?? []));
  const renameChat = () => {
    if (!chat) return;
    const name = prompt('Chat name', chat.name);
    if (name?.trim()) rename(name.trim());
  };
  const deleteThisChat = async () => {
    if (chat && (await confirmDialog({ title: `Delete "${chat.name}"?`, confirmLabel: 'Delete', danger: true }))) await deleteChat(chat.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* On a phone: one row (the chats, ⋯ for the rest, ⚙ for who and how),
          gone while you type. */}
      {!(phone && keyboard) && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-800 p-2 phone:flex-nowrap">
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
            <div className="relative flex items-center">
              {!phone && (
                <IconButton title="Rename" onClick={renameChat}>
                  ✎
                </IconButton>
              )}
              <IconButton title={phone ? 'More: rename, export, delete, the prompt' : 'Export this chat for SillyTavern or Chub'} onClick={() => setExportOpen(!exportOpen)}>
                {phone ? '⋯' : '⬇'}
              </IconButton>
              {exportOpen && (
                <div className="absolute top-full right-0 z-30 mt-1 w-64 rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl" onMouseLeave={() => setExportOpen(false)}>
                  {[
                    ...(phone ? [{ label: '✎ Rename', hint: '', run: renameChat }] : []),
                    { label: '⬇ SillyTavern / Chub (.jsonl)', hint: 'Import it in SillyTavern (Manage chat files → Import) or Chub', run: () => downloadBlob(chatToStJsonl(chat, card, me.name), `${chatFileName(chat, card)}.jsonl`, 'application/jsonl') },
                    { label: '⬇ Plain text (.txt)', hint: 'For reading or sharing', run: () => downloadBlob(chatToText(chat, card, me.name), `${chatFileName(chat, card)}.txt`, 'text/plain') },
                    ...(phone
                      ? [
                          { label: '🔍 The next prompt', hint: 'What the next reply would send', run: preview },
                          ...(lastPrompt ? [{ label: `🔍 The last prompt · ${lastPrompt.lore.active.length} lore`, hint: 'What the last reply sent', run: () => setInspect(lastPrompt) }] : []),
                          { label: '🗑 Delete this chat', hint: '', run: deleteThisChat },
                        ]
                      : []),
                  ].map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      title={o.hint}
                      className="block w-full rounded px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                      onClick={async () => {
                        setExportOpen(false);
                        await useChatStore.getState().flush();
                        o.run();
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {!phone && (
                <IconButton title="Delete this chat" tone="danger" onClick={deleteThisChat}>
                  🗑
                </IconButton>
              )}
            </div>
          )}
          {phone ? (
            <IconButton title="Chat settings: model, persona, preset" onClick={() => setShowSettings(!showSettings)}>
              ⚙
            </IconButton>
          ) : (
            <div className="flex items-center gap-1.5">
              <PersonaPicker onManage={() => openSettings('personas')} />
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                title={preset ? `Every chat uses the "${preset.name}" preset. Click to change it.` : 'No preset: the built-in prompt. Click to import or pick a SillyTavern preset.'}
                className={cx('max-w-28 truncate rounded px-1.5 py-0.5 text-[10px]', preset ? 'bg-violet-500/15 text-violet-300' : 'bg-slate-800 text-slate-500')}
              >
                {preset ? preset.name : 'Built-in prompt'}
              </button>
              <IconButton title="Show the prompt the next reply would send" onClick={preview}>
                🔍
              </IconButton>
              <IconButton title="Chat settings: connection, persona, prompt" onClick={() => setShowSettings(!showSettings)}>
                ⚙
              </IconButton>
              {full && (
                <input
                  type="range"
                  min={40}
                  max={100}
                  step={5}
                  value={Math.round(chatFullWidth * 100)}
                  onChange={(e) => setChatFullWidth(Number(e.target.value) / 100)}
                  title={`Message width: ${Math.round(chatFullWidth * 100)}% of the window`}
                  aria-label="Message width"
                  className="w-20 accent-violet-500"
                />
              )}
            </div>
          )}
        </div>
      )}

      {showSettings && !(phone && keyboard) && <ChatSettings phone={phone} onClose={() => setShowSettings(false)} />}
      {!showSettings && !phone && <ConnectionPicker value={chatConnectionId} onChange={setChatConnection} label="Model" className="flex-shrink-0 border-b border-slate-800 px-2 py-1.5" />}

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="relative h-full overflow-y-auto px-3 py-3">
          {!chat ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
              Test how the card plays.
              <Button variant="primary" onClick={() => void newChat(0)}>
                Start a chat
              </Button>
            </div>
          ) : (
            <div className={cx('flex flex-col gap-3', column.className)} style={column.style}>
              <GreetingBubble card={card} index={chat.greeting} count={greetingCount} onSwipe={setGreeting} userName={me.name} showId={showIds} />
              {chat.messages.map((m, i) => (
                <div key={m.id} data-msg={m.id}>
                  <Bubble
                    card={card}
                    message={m}
                    messageId={showIds ? i + 1 : undefined}
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
                    onRerollContinue={() => void rerollContinue(m)}
                    onUndoContinue={() => undoLastContinue(m)}
                    onShowTree={() => setTreeFor(m.id)}
                  />
                </div>
              ))}
              {error && !running && <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
            </div>
          )}
        </div>
        {chat && !following && (
          <button
            type="button"
            onClick={toEnd}
            title="Jump to the latest message"
            className="absolute right-3 bottom-3 flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-200 shadow-lg hover:bg-slate-800"
          >
            ↓
          </button>
        )}
      </div>

      {treeFor && chat && (() => {
        const m = chat.messages.find((x) => x.id === treeFor);
        return m ? <ContinueTreeDialog message={m} tree={treeOf(m)} busy={running} onChoose={(id) => setTree(m.id, choose(treeOf(m), id))} onClose={() => setTreeFor(null)} /> : null;
      })()}
      {chat && (
        <div className="flex-shrink-0 border-t border-slate-800 p-2">
          <div className={column.className} style={column.style}>
          {guideOpen && (
            <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1">
              <span className="text-sm" title="Guide">
                🧭
              </span>
              <input
                autoFocus
                value={guide}
                onChange={(e) => setGuide(e.target.value)}
                placeholder="Steer the next reply, swipe, continue or impersonation, e.g. “she finally admits it”"
                className="min-w-0 flex-1 bg-transparent py-0.5 text-sm text-slate-200 outline-none placeholder:text-slate-500"
              />
              <IconButton title={guidePinned ? 'Pinned: used for every generation until you unpin it' : 'Used once, then cleared. Pin it to keep it.'} tone={guidePinned ? 'accent' : 'default'} onClick={() => setGuidePinned(!guidePinned)}>
                📌
              </IconButton>
              <IconButton
                title="Close the guide"
                onClick={() => {
                  setGuide('');
                  setGuidePinned(false);
                  setGuideOpen(false);
                }}
              >
                ✕
              </IconButton>
            </div>
          )}
          <AutoTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (enterSends(e)) {
                e.preventDefault();
                void send();
              }
            }}
            minRows={2}
            maxRows={10}
            placeholder={phone ? `Message as ${me.name}…` : `Message as ${me.name}… (Enter sends, Shift+Enter for a new line; empty Enter asks for a reply)`}
          />
          {/* One row on a phone too: the actions as icons (hold one for its
              name), Send on the right. */}
          <div className={cx('mt-1.5 flex items-center gap-1.5', phone ? 'flex-nowrap' : 'flex-wrap')}>
            {!phone && sendButton}
            <Button size="sm" disabled={running} onClick={() => void regenerate()} title={phone ? 'Regenerate: another version of the last reply' : 'Another version of the last reply'}>
              {phone ? <span className="px-1 text-base leading-none">↻</span> : '↻ Regenerate'}
            </Button>
            <Button size="sm" disabled={running} onClick={() => void continueLast()} title="Continue the last reply">
              {phone ? <span className="px-1 text-base leading-none">→</span> : '→ Continue'}
            </Button>
            <Button size="sm" disabled={running} onClick={() => void impersonate()} title={phone ? 'Impersonate: write your next message for you (it lands in the box to edit)' : 'Write your next message for you (it lands in the box to edit)'}>
              {phone ? <span className="px-0.5 text-base leading-none">🎭</span> : '🎭 Impersonate'}
            </Button>
            <Button
              size="sm"
              variant={guide.trim() ? 'primary' : 'secondary'}
              onClick={() => setGuideOpen(!guideOpen)}
              title="Guide: steer the next reply, swipe, continue or impersonation with an instruction the model sees just before it writes"
            >
              <span className={cx(phone && 'px-0.5 text-base leading-none')}>🧭</span>
              {guide.trim() ? (phone ? (guidePinned ? '📌' : '') : guidePinned ? ' Guided 📌' : ' Guided') : ''}
            </Button>
            {phone && <span className="ml-auto">{sendButton}</span>}
            {lastPrompt && !phone && (
              <button type="button" className="ml-auto text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setInspect(lastPrompt)}>
                Last prompt · {lastPrompt.lore.active.length} lore
              </button>
            )}
          </div>
          </div>
        </div>
      )}
      {inspect && <PromptInspector prompt={inspect} onClose={() => setInspect(null)} />}
    </div>
  );
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** *actions* in italics, **bold**, and "speech" highlighted, nested either
 *  way, as frontends show them (lib/chatFormat.ts). */
function Formatted({ text }: { text: string }) {
  const nodes = useMemo(() => formatChat(text), [text]);
  return <div className="chat-text text-sm leading-relaxed whitespace-pre-wrap text-slate-200">{renderNodes(nodes)}</div>;
}

function renderNodes(nodes: FormatNode[]): React.ReactNode {
  return nodes.map((n, i) =>
    typeof n === 'string' ? (
      <Fragment key={i}>{n}</Fragment>
    ) : n.kind === 'em' ? (
      <em key={i}>{renderNodes(n.children)}</em>
    ) : n.kind === 'strong' ? (
      <strong key={i}>{renderNodes(n.children)}</strong>
    ) : n.kind === 'image' ? (
      // An embedded picture, as the card shows it on Chub or SillyTavern.
      // eslint-disable-next-line @next/next/no-img-element
      <img key={i} src={n.src} alt={n.alt} title={n.alt || undefined} loading="lazy" referrerPolicy="no-referrer" className="my-1 inline-block max-h-96 max-w-full rounded-md align-middle" />
    ) : (
      <q key={i}>{renderNodes(n.children)}</q>
    ),
  );
}

function Avatar({ role, persona }: { role: 'user' | 'assistant' | 'system'; persona?: Persona | null }) {
  const project = useProjectStore((s) => s.project);
  const shape = useLlmStore((s) => s.chatSettings.avatarShape) ?? 'circle';
  if (shape === 'none') return null;
  // Tapping a picture shows it full size.
  const url = role === 'user' ? (persona ? api.personaAvatarUrl(persona) : null) : project?.avatar ? `/api/projects/${project.id}/avatar?v=${project.avatar.version}` : null;
  const frame = avatarFrame(shape, 36);
  const face =
    role === 'user' ? (
      <PersonaAvatar persona={persona} shape={shape} />
    ) : (
      <div className={cx('flex-shrink-0 overflow-hidden bg-slate-800', frame.className)} style={frame.style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt="" className="h-full w-full object-cover object-top" />}
      </div>
    );
  if (!url) return face;
  return (
    <button type="button" onClick={() => openLightbox(url)} title="Show full size" className={cx('flex-shrink-0 cursor-zoom-in self-start', frame.className)}>
      {face}
    </button>
  );
}

/**
 * A sideways swipe on a message, by touch only: left for the next version,
 * right for the one before. Scrolling up and down is left to the browser;
 * the bubble follows the finger a little while it's a swipe. Off with
 * Chat settings → Swipe gesture, or when there's nothing to swipe.
 */
function useSwipeGesture(onNext: (() => void) | null, onPrev: (() => void) | null) {
  const enabled = useLlmStore((s) => s.chatSettings.swipeGesture ?? true) && !!(onNext || onPrev);
  const start = useRef<{ x: number; y: number; id: number; sideways: boolean | null } | null>(null);
  const [dx, setDx] = useState(0);
  if (!enabled) return { props: {}, style: undefined };
  const end = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    setDx(0);
    if (!s || e.pointerId !== s.id || !s.sideways) return;
    const moved = e.clientX - s.x;
    if (moved < -60) onNext?.();
    else if (moved > 60) onPrev?.();
  };
  return {
    props: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('button, textarea, input, a, details')) return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, sideways: null };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = start.current;
        if (!s || e.pointerId !== s.id) return;
        const x = e.clientX - s.x;
        const y = e.clientY - s.y;
        // Decided once, on the first clear move: sideways is a swipe, anything else a scroll.
        if (s.sideways === null && Math.hypot(x, y) > 10) s.sideways = Math.abs(x) > Math.abs(y) * 1.5;
        if (s.sideways) setDx(Math.max(-80, Math.min(80, x * 0.4)));
      },
      onPointerUp: end,
      onPointerCancel: () => {
        start.current = null;
        setDx(0);
      },
    },
    // pan-y: the browser keeps vertical scrolling and hands sideways moves over.
    style: { touchAction: 'pan-y', transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? undefined : 'transform 150ms ease-out' } as React.CSSProperties,
  };
}

/** A message's number, SillyTavern style. */
function MessageId({ id, className }: { id: number; className?: string }) {
  return <span className={cx('text-[11px] text-slate-600 tabular-nums', className)} title={id === 0 ? 'Message #0: the greeting' : `Message #${id}`}>#{id}</span>;
}

function GreetingBubble({ card, index, count, onSwipe, userName, showId }: { card: CardData; index: number; count: number; onSwipe: (i: number) => void; userName: string; showId: boolean }) {
  const text = greetingText(card, index);
  const swipe = useSwipeGesture(count > 1 ? () => onSwipe(index >= count - 1 ? 0 : index + 1) : null, count > 1 ? () => onSwipe(index <= 0 ? count - 1 : index - 1) : null);
  return (
    <div className="flex gap-2">
      <Avatar role="assistant" />
      <div className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2" {...swipe.props} style={swipe.style}>
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-200">{card.nickname || card.name || 'Character'}</span>
          <span className="text-slate-500">greeting · live from the card</span>
          {showId && <MessageId id={0} className="ml-auto" />}
          {count > 1 && (
            <span className={cx('flex items-center gap-1 text-slate-400', !showId && 'ml-auto')}>
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
  messageId,
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
  onRerollContinue,
  onUndoContinue,
  onShowTree,
}: {
  card: CardData;
  message: ChatMessage;
  /** Its number in the chat (the greeting is #0), when they're shown. */
  messageId?: number;
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
  onRerollContinue: () => void;
  onUndoContinue: () => void;
  onShowTree: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const text = messageText(m);
  const tokens = useTextTokens(text, 800);
  const reasoning = streaming ? streamReasoning : m.reasoning?.[m.swipe];
  const isUser = m.role === 'user';
  // This swipe's continues, when it has any and they still match its text.
  const tree = !isUser && m.continues?.[m.swipe] && pathText(m.continues[m.swipe]!) === text ? m.continues[m.swipe] : undefined;
  // Only the last reply has versions to swipe through, as its buttons do.
  const swipeable = !isUser && isLast && !busy && editing === null;
  const swipe = useSwipeGesture(
    swipeable ? () => (m.swipe < m.swipes.length - 1 ? onChange({ swipe: m.swipe + 1 }) : onSwipeNew()) : null,
    swipeable && m.swipe > 0 ? () => onChange({ swipe: m.swipe - 1 }) : null,
  );
  return (
    <div className={cx('group flex gap-2', isUser && 'flex-row-reverse')}>
      <Avatar role={m.role} persona={persona} />
      <div className={cx('min-w-0 flex-1 rounded-lg px-3 py-2', isUser ? 'bg-sky-500/10' : 'bg-slate-900')} {...swipe.props} style={swipe.style}>
        <div className={cx('mb-1 flex items-center gap-2 text-xs', isUser && 'flex-row-reverse')}>
          <span className="font-semibold text-slate-200">{isUser ? userName || 'User' : card.nickname || card.name || 'Character'}</span>
          {m.model && !isUser && <span className="truncate text-slate-600">{m.model}</span>}
          <span className={cx('flex items-center gap-0.5 opacity-0 group-hover:opacity-100 touch:opacity-100', isUser ? 'mr-auto' : 'ml-auto')}>
            <span className="mr-1 text-[10px] text-slate-600">{formatTokens(tokens)} tok</span>
            <IconButton title="Edit" disabled={busy} onClick={() => setEditing(text)}>
              ✎
            </IconButton>
            <IconButton title="Copy" onClick={() => void copyText(text)}>
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
                  // An edit starts the swipe's continue tree afresh.
                  onChange({ swipes: m.swipes.map((s, i) => (i === m.swipe ? editing : s)), continues: m.continues?.map((c, i) => (i === m.swipe ? undefined : c)) });
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
        {((!isUser && isLast) || messageId !== undefined) && (
          <div className={cx('mt-1.5 flex items-center justify-end gap-1 text-xs text-slate-400', isUser && 'flex-row-reverse')}>
            {messageId !== undefined && <MessageId id={messageId} className={isUser ? 'ml-auto' : 'mr-auto'} />}
            {!isUser && isLast && (
              <>
            {tree && pathDepth(tree) > 0 && (
              <>
                <IconButton title="Undo the last continue (it stays in 🌿, to go back to)" disabled={busy} onClick={onUndoContinue}>
                  ↶
                </IconButton>
                <IconButton title="Reroll the last continue (the old one stays in 🌿)" disabled={busy} onClick={onRerollContinue}>
                  ↻
                </IconButton>
              </>
            )}
            {tree && branchCount(tree) > 0 && (
              <IconButton title="Continues: every one you've made, as a tree, to pick a path" onClick={onShowTree}>
                🌿<span className="ml-0.5 text-[10px] tabular-nums">{branchCount(tree)}</span>
              </IconButton>
            )}
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 🌿 Every continue of a reply's swipe, as a tree: the chosen path is
 *  highlighted, and picking any point makes the reply end there. */
function ContinueTreeDialog({ message, tree, busy, onChoose, onClose }: { message: ChatMessage; tree: ContinueNode; busy: boolean; onChoose: (id: string) => void; onClose: () => void }) {
  const snippet = (t: string) => {
    const s = t.replace(/\s+/g, ' ').trim();
    return s.length > 140 ? `${s.slice(0, 140)}…` : s || '(nothing)';
  };
  const Node = ({ node, depth }: { node: ContinueNode; depth: number }) => {
    const chosen = onPath(tree, node.id);
    const end = chosen && (node.active === undefined || !node.children[node.active]);
    return (
      <li>
        <button
          type="button"
          disabled={busy}
          onClick={() => onChoose(node.id)}
          title={node.text}
          className={cx(
            'w-full rounded-md border px-2 py-1.5 text-left text-xs',
            end ? 'border-violet-500 bg-violet-500/15 text-slate-100' : chosen ? 'border-violet-500/40 bg-violet-500/5 text-slate-200' : 'border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200',
          )}
        >
          <span className="mr-1.5 text-[10px] tracking-wide text-slate-500 uppercase">{depth === 0 ? 'Reply' : `+${depth}`}</span>
          {snippet(node.text)}
        </button>
        {node.children.length > 0 && (
          <ul className="mt-1 ml-3 flex flex-col gap-1 border-l border-slate-800 pl-2">
            {node.children.map((c) => (
              <Node key={c.id} node={c} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  };
  return (
    <Modal open onClose={onClose} title="🌿 Continues" size="lg" footer={<Button onClick={onClose}>Done</Button>}>
      <p className="mb-3 text-xs text-slate-500">
        Every continue of this reply{message.swipes.length > 1 ? ` (version ${message.swipe + 1})` : ''}. The highlighted path is what the reply says now; pick any point to end it there, then Continue to branch from it.
      </p>
      <ul className="flex flex-col gap-1">
        <Node node={tree} depth={0} />
      </ul>
    </Modal>
  );
}

// ─── Settings and inspector ──────────────────────────────────────────────────

function ChatSettings({ phone, onClose }: { phone: boolean; onClose: () => void }) {
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
      {phone && (
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Persona <PersonaPicker onManage={() => openSettings('personas')} />
        </label>
      )}
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
        <Toggle checked={s.showMessageIds} onChange={(v) => setChatSettings({ showMessageIds: v })} label={<span className="text-xs">Show message numbers (#0 is the greeting)</span>} />
        <label className="flex w-full flex-col gap-0.5 text-xs text-slate-400">
          🧭 Guide template <span className="text-slate-500">({'{{guide}}'} is where your guide goes; sent last, just before the reply)</span>
          <input value={s.guideTemplate ?? DEFAULT_GUIDE_TEMPLATE} onChange={(e) => setChatSettings({ guideTemplate: e.target.value })} className={cx(inputClass, 'text-xs')} />
        </label>
        <Toggle checked={s.swipeGesture ?? true} onChange={(v) => setChatSettings({ swipeGesture: v })} label={<span className="text-xs" title="On a touch screen: swipe the last reply left for its next version (a new one at the end), right for the one before; the greeting swipes between greetings">Swipe gesture on the last reply</span>} />
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Avatars
          <select value={s.avatarShape} onChange={(e) => setChatSettings({ avatarShape: e.target.value as AvatarShape })} className={cx(inputClass, 'w-auto py-0.5 text-xs')}>
            <option value="circle">Circles</option>
            <option value="square">Squares</option>
            <option value="rectangle">Rectangles (portrait)</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function PromptInspector({ prompt, onClose }: { prompt: BuiltPrompt; onClose: () => void }) {
  const all = useMemo(() => prompt.parts.map((p) => p.content).join('\n\n'), [prompt]);
  const total = useTextTokens(all, 0);
  return (
    <Modal open onClose={onClose} title={`Prompt · ~${formatTokens(total)} tokens`} size="lg" footer={<Button onClick={() => void copyText(JSON.stringify(prompt.messages, null, 2))}>Copy as JSON</Button>}>
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
