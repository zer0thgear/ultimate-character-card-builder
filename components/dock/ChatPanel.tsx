'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useChatStore } from '@/store/chatStore';
import { useLlmStore } from '@/store/llmStore';
import { useBridgeStore } from '@/store/bridgeStore';
import { toast, useUiStore } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { DEFAULT_CHAT_SETTINGS, formatMessageTime, swipeDate, withoutSwipe, buildChatPrompt, displayText, chatGreeting, greetingText, messageText, newMessage, type AvatarShape, type BuildOptions, type BuiltPrompt, type SentWith, DEFAULT_GUIDE_TEMPLATE } from '@/lib/chatPrompt';
import { buildPresetPrompt } from '@/lib/presetPrompt';
import { presetParams, type ChatPreset } from '@/lib/stPreset';
import type { LlmConnection, SamplerParams } from '@/types/llm';
import { describeEntry } from '@/lib/lorebookScan';
import { AutoTextarea, Button, IconButton, Modal, NumberInput, TokenBadge, Toggle, choiceDialog, confirmDialog, textDialog, cx, downloadBlob, enterSends, inputClass } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { ChatPresetSelect, PresetPicker } from '@/components/llm/PresetManager';
import { PersonaAvatar, PersonaPicker, avatarFrame } from '@/components/llm/Personas';
import { openLightbox } from '@/components/Lightbox';
import { ChatPictureBubble, DescribeDialog, DrawButton, PendingPicture, useChatPictures, type DrawSpec } from '@/components/chatmode/ChatPictures';
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
import type { ChatImage, ChatMessage } from '@/types/project';
import { uuid } from '@/lib/uuid';
import { copyText } from '@/lib/clipboard';
import { formatChat, hideComments, type FormatNode } from '@/lib/chatFormat';
import { summaryInjection, summarySettings } from '@/lib/chatSummary';
import { ChatSummaryPanel, useChatSummary } from '@/components/dock/ChatSummaryPanel';

// Test-chatting the card, built the way SillyTavern builds its prompt (see
// lib/chatPrompt.ts), with swipes, edits, the greeting read live from the
// card, and an inspector showing exactly what was sent.

/** `wide`: the chat has the window's width (Chat mode), so it keeps to a
 *  centred column as it does with the dock filling the window. */
export function ChatPanel({ wide = false }: { wide?: boolean } = {}) {
  const project = useProjectStore((s) => s.project);
  const { chat, list, loadFor, newChat, openChat, deleteChat, rename, setGreeting, setGreetingEdit, setMessages, branchFrom } = useChatStore();
  const { connections, chatConnectionId, setChatConnection, chatSettings, presets } = useLlmStore();
  const personas = usePersonaStore((s) => s.personas);
  const phone = useMediaQuery(PHONE_QUERY);
  const keyboard = useKeyboard((s) => s.open);
  // With the dock filling the window, the chat keeps to a centred column.
  const dockFull = useUiStore((s) => s.fullPane === 'dock');
  const full = (wide || dockFull) && !phone;
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
  // 🎨 Pictures drawn into the chat (Chat mode).
  const pictures = useChatPictures();
  const [describing, setDescribing] = useState<{ spec: DrawSpec; replacing?: ChatImage } | null>(null);
  const [treeFor, setTreeFor] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // 📝 The chat's summary.
  const summarizer = useChatSummary();
  const [showSummary, setShowSummary] = useState(false);
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

  /** The pictures drawn after a message (null: after the greeting), and one
   *  on its way there. */
  const picturesAfter = (after: string | null) => {
    if (!chat || !project) return null;
    const here = (chat.images ?? []).filter((img) => img.after === after);
    const p = pictures.pending;
    return (
      <>
        {here.map((img) =>
          p?.replacing === img.id && !p.error ? (
            <PendingPicture key={img.id} pending={p} genError={pictures.genError} onDismiss={pictures.dismiss} />
          ) : (
            <ChatPictureBubble
              key={img.id}
              image={img}
              projectId={project.id}
              busy={!!p && !p.error}
              onRedraw={() => void pictures.draw({ scene: img.scene, characters: img.characters }, img.after, img)}
              onEdit={() => setDescribing({ spec: { scene: img.scene, characters: img.characters }, replacing: img })}
            />
          ),
        )}
        {p && p.after === after && !p.replacing && <PendingPicture pending={p} genError={pictures.genError} onDismiss={pictures.dismiss} />}
        {p?.replacing && p.error && here.some((img) => img.id === p.replacing) && <PendingPicture pending={p} genError={pictures.genError} onDismiss={pictures.dismiss} />}
      </>
    );
  };

  /** The chat as the model sees it: the live greeting, then the messages. */
  const history = (messages: ChatMessage[]) => {
    const g = chat ? chatGreeting(card, chat) : '';
    return g.trim() ? [{ ...newMessage('assistant', g), id: 'greeting' }, ...messages] : messages;
  };

  // Who {{user}} is in this chat: its locked persona, the active one, or
  // the plain name and description.
  const me = resolvePersona(personas, chatSettings, chat);
  const showIds = chatSettings.showMessageIds;
  const showTimes = chatSettings.showTimestamps ?? true;
  const settings = { ...chatSettings, userName: me.name, persona: me.description };
  const preset = chatSettings.presetId ? (presets.find((p) => p.id === chatSettings.presetId) ?? null) : null;
  const overrides = preset && chatSettings.presetSamplers && connection ? presetParams(preset, connection.kind) : {};

  /** The prompt for `messages` (greeting added), through the preset if one is on. */
  const build = (messages: ChatMessage[], opts: BuildOptions = {}): BuiltPrompt => {
    const summary = summaryInjection(useChatStore.getState().chat?.summary, summarySettings(chatSettings.summary));
    const full = { model: connection?.model, kind: connection?.kind, maxTokens: overrides.max_tokens ?? connection?.params.max_tokens, maxContext: connection?.params.max_context, summary, ...opts };
    const built = preset ? buildPresetPrompt(card, history(messages), settings, preset, full) : buildChatPrompt(card, history(messages), settings, full);
    return connection ? { ...built, sentWith: sentWith(connection, overrides, preset) } : built;
  };

  const summaryRequest = () => ({ build, connection, params: overrides });

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
    else if (continueFrom === undefined)
      setMessages((m) =>
        m.map((x) => (x.id === id ? { ...x, swipes: [...x.swipes, ''], swipe: x.swipes.length, swipeDates: [...x.swipes.map((_, i) => x.swipeDates?.[i] ?? x.createdAt), Date.now()] } : x)),
      );
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
    // Every so many messages, the summary catches up.
    else void summarizer.summarizeIfDue(summaryRequest());
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

  // Beside the message box, level with its top (where it stays as the box
  // grows), as SillyTavern's is: an icon, to leave the box the width.
  const sendButton = running ? (
    <Button variant="danger" onClick={stop} title="Stop" aria-label="Stop" className="h-10 w-10 flex-shrink-0">
      <span className="text-base leading-none">■</span>
    </Button>
  ) : (
    <Button variant="primary" onClick={() => void send()} title="Send (Enter)" aria-label="Send" className="h-10 w-10 flex-shrink-0">
      <span className="text-lg leading-none">➤</span>
    </Button>
  );

  /** Deletes a message; with more than one version, asks whether it's just
   *  the one showing or the lot. */
  const deleteMessage = async (m: ChatMessage) => {
    if (m.swipes.length > 1) {
      const which = await choiceDialog({
        title: 'Delete this version or the whole message?',
        body: `This reply has ${m.swipes.length} versions; version ${m.swipe + 1} is showing.`,
        choices: [
          { value: 'swipe', label: `Just version ${m.swipe + 1}` },
          { value: 'message', label: 'The whole message', danger: true },
        ],
      });
      if (!which) return;
      if (which === 'swipe') return setMessages((ms) => ms.map((x) => (x.id === m.id ? withoutSwipe(x, x.swipe) : x)));
    }
    setMessages((ms) => ms.filter((x) => x.id !== m.id));
  };

  const preview = () => setInspect(build(chat?.messages ?? []));
  const renameChat = async () => {
    if (!chat) return;
    const name = await textDialog({ title: 'Rename chat', label: 'Chat name', initial: chat.name, confirmLabel: 'Rename' });
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
          <select value={chat?.id ?? ''} onChange={(e) => e.target.value && void openChat(e.target.value)} className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs', !phone && 'min-w-36')}>
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
                <IconButton title="Rename" onClick={() => void renameChat()}>
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
                          { label: '📝 Summary', hint: "The chat's summary, sent with every prompt", run: () => setShowSummary(!showSummary) },
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
            <IconButton title="Chat settings: connection, persona, preset" onClick={() => setShowSettings(!showSettings)}>
              🔧
            </IconButton>
          ) : (
            <div className="flex items-center gap-1.5">
              <PersonaPicker onManage={() => openSettings('personas')} />
              <ChatPresetSelect />
              {chat && (
                <IconButton title={summarizer.running ? 'Summarizing the chat…' : "The chat's summary, sent with every prompt"} onClick={() => setShowSummary(!showSummary)}>
                  <span className={cx(summarizer.running && 'animate-pulse')}>📝</span>
                </IconButton>
              )}
              <IconButton title="Show the prompt the next reply would send" onClick={preview}>
                🔍
              </IconButton>
              <IconButton title="Chat settings: connection, persona, preset" onClick={() => setShowSettings(!showSettings)}>
                🔧
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
      {showSummary && chat && !(phone && keyboard) && <ChatSummaryPanel summarizer={summarizer} request={summaryRequest} onClose={() => setShowSummary(false)} />}
      {!showSettings && !phone && <ConnectionPicker value={chatConnectionId} onChange={setChatConnection} label="Connection" className="flex-shrink-0 border-b border-slate-800 px-2 py-1.5" />}

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="relative h-full overflow-y-auto px-3 py-3">
          {!chat ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
              {wide ? `Chat with ${card.name || 'this character'}.` : 'Test how the card plays.'}
              <Button variant="primary" onClick={() => void newChat(0)}>
                Start a chat
              </Button>
            </div>
          ) : (
            <div className={cx('flex flex-col gap-3', column.className)} style={column.style}>
              <GreetingBubble
                card={card}
                index={chat.greeting}
                edited={chat.greetingEdits?.[chat.greeting]}
                count={greetingCount}
                onSwipe={setGreeting}
                onEdit={(text) => setGreetingEdit(chat.greeting, text)}
                busy={!!streamingId}
                isLast={chat.messages.length === 0}
                userName={me.name}
                showId={showIds}
                date={showTimes ? chat.createdAt : undefined}
              />
              {picturesAfter(null)}
              {chat.messages.map((m, i) => (
                <div key={m.id} data-msg={m.id} className="flex flex-col gap-3">
                  <Bubble
                    card={card}
                    message={m}
                    messageId={showIds ? i + 1 : undefined}
                    showTime={showTimes}
                    userName={me.name}
                    persona={me.persona}
                    streaming={streamingId === m.id}
                    streamReasoning={streamingId === m.id ? streamReasoning : ''}
                    isLast={i === chat.messages.length - 1}
                    busy={running}
                    onChange={(patch) => setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, ...patch } : x)))}
                    onDelete={() => void deleteMessage(m)}
                    onDeleteAfter={async () => {
                      const after = chat.messages.length - (i + 1);
                      const ok = await confirmDialog({
                        title: `Delete the ${after === 1 ? 'message' : `${after} messages`} after this?`,
                        body: `Everything below #${i + 1} goes, with any pictures among it. 🔀 Branch first if you'd like to keep a copy.`,
                        confirmLabel: 'Delete',
                        danger: true,
                      });
                      if (ok) setMessages((ms) => ms.slice(0, i + 1));
                    }}
                    onBranch={() =>
                      void branchFrom(m.id).then(
                        () => toast(`Branched at #${i + 1}: this is the new chat (the old one is in the chat list).`, 'success'),
                        (err: Error) => toast(`Couldn't branch: ${err.message}`, 'error'),
                      )
                    }
                    onSwipeNew={() => void reply(chat.messages, m)}
                    onRerollContinue={() => void rerollContinue(m)}
                    onUndoContinue={() => undoLastContinue(m)}
                    onShowTree={() => setTreeFor(m.id)}
                  />
                  {picturesAfter(m.id)}
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
          <div className="flex items-start gap-1.5">
            <AutoTextarea
              data-chat-input
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
              className="min-w-0 flex-1"
              placeholder={phone ? `Message as ${me.name}…` : `Message as ${me.name}… (Enter sends, Shift+Enter for a new line; empty Enter asks for a reply)`}
            />
            {sendButton}
          </div>
          {/* One row on a phone too: the actions as icons (hold one for its
              name). */}
          <div className={cx('mt-1.5 flex items-center gap-1.5', phone ? 'flex-nowrap' : 'flex-wrap')}>
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
            {wide && (
              <DrawButton
                phone={phone}
                disabled={!!pictures.pending && !pictures.pending.error}
                onMoment={() => void pictures.drawMoment(card, chatGreeting(card, chat), chat.messages, me.name)}
                onDescribe={() => setDescribing({ spec: { scene: '', characters: pictures.formCharacters() } })}
              />
            )}
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
      {describing && chat && (
        <DescribeDialog
          initial={describing.spec}
          redrawing={!!describing.replacing}
          onWrite={(instruction) => pictures.writeFromChat(card, chatGreeting(card, chat), chat.messages, me.name, instruction)}
          onDraw={(spec) => void pictures.draw(spec, chat.messages.at(-1)?.id ?? null, describing.replacing)}
          onClose={() => setDescribing(null)}
        />
      )}
    </div>
  );
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** *actions* in italics, **bold**, and "speech" highlighted, nested either
 *  way, as frontends show them (lib/chatFormat.ts); <!-- comments --> are
 *  left out (they're for the model). */
function Formatted({ text }: { text: string }) {
  const nodes = useMemo(() => formatChat(hideComments(text)), [text]);
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
/**
 * ← and → on the keyboard, as SillyTavern has them: the version before, and
 * the next one (a new one at the end), of the last reply (or the greeting,
 * alone in the chat). Not while typing somewhere (the message box counts
 * only while it's empty), in a dialog, or while this chat is out of view.
 */
function useArrowSwipe(box: React.RefObject<HTMLElement | null>, onNext: (() => void) | null, onPrev: (() => void) | null) {
  const handlers = useRef({ onNext, onPrev });
  useEffect(() => {
    handlers.current = { onNext, onPrev };
  });
  const active = !!(onNext || onPrev);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]')) return;
      if (t instanceof HTMLTextAreaElement && !(t.hasAttribute('data-chat-input') && t.value === '')) return;
      if (document.querySelector('[role="dialog"]') || !box.current?.offsetParent) return;
      const go = e.key === 'ArrowRight' ? handlers.current.onNext : handlers.current.onPrev;
      if (!go) return;
      e.preventDefault();
      go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, box]);
}

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
/** When a message was written, in the viewer's time zone, under its name. */
function MessageTime({ time, className }: { time: number; className?: string }) {
  return (
    <div className={cx('-mt-1 mb-1 text-[10px] text-slate-600 tabular-nums', className)} title={new Date(time).toLocaleString()}>
      {formatMessageTime(time)}
    </div>
  );
}

function MessageId({ id, className }: { id: number; className?: string }) {
  return <span className={cx('text-[11px] text-slate-600 tabular-nums', className)} title={id === 0 ? 'Message #0: the greeting' : `Message #${id}`}>#{id}</span>;
}

function GreetingBubble({
  card,
  index,
  edited,
  count,
  onSwipe,
  onEdit,
  busy,
  isLast,
  userName,
  showId,
  date,
}: {
  card: CardData;
  index: number;
  /** This chat's own wording of it, if it has one. */
  edited?: string;
  count: number;
  onSwipe: (i: number) => void;
  /** Sets this chat's wording (undefined: back to the card's). */
  onEdit: (text: string | undefined) => void;
  busy: boolean;
  /** Nothing after it yet: ← → swipe it. */
  isLast: boolean;
  userName: string;
  showId: boolean;
  date?: number;
}) {
  const own = greetingText(card, index);
  const text = edited ?? own;
  const shown = text.trim() ? displayText(card, text, userName) : '';
  // As the model gets it: {{char}} and {{user}} filled in.
  const tokens = useTextTokens(shown, 400);
  const [editing, setEditing] = useState<string | null>(null);
  const next = count > 1 && editing === null ? () => onSwipe(index >= count - 1 ? 0 : index + 1) : null;
  const prev = count > 1 && editing === null ? () => onSwipe(index <= 0 ? count - 1 : index - 1) : null;
  const swipe = useSwipeGesture(next, prev);
  const box = useRef<HTMLDivElement>(null);
  useArrowSwipe(box, isLast && !busy ? next : null, isLast && !busy ? prev : null);
  const saveToChat = (next: string) => {
    onEdit(next === own ? undefined : next);
    setEditing(null);
  };
  // The card's greeting itself (an edit undo in the editor takes back);
  // this chat then reads it live again.
  const saveToCard = (next: string) => {
    useProjectStore.getState().updateCard((d) => (index === 0 ? { ...d, first_mes: next } : { ...d, alternate_greetings: d.alternate_greetings.map((g, i) => (i === index - 1 ? next : g)) }));
    onEdit(undefined);
    setEditing(null);
  };
  const backToCards = async () => {
    if (await confirmDialog({ title: "Use the card's greeting again?", body: "This chat's wording of the greeting is let go, and the card's (as it is now) shows in its place.", confirmLabel: "Use the card's" })) onEdit(undefined);
  };
  return (
    <div ref={box} className="group flex gap-2">
      <Avatar role="assistant" />
      <div className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2" {...swipe.props} style={swipe.style}>
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className="max-w-[50%] flex-shrink-0 truncate font-semibold text-slate-200">{card.nickname || card.name || 'Character'}</span>
          {edited !== undefined ? (
            <span className="min-w-0 truncate text-amber-400/80" title="Edited in this chat: changes to the card's greeting don't show here until you go back to the card's">
              greeting · this chat&apos;s wording
            </span>
          ) : (
            <span className="min-w-0 truncate text-slate-500">greeting · live from the card</span>
          )}
          {shown && (
            <span className="flex-shrink-0 text-[10px] whitespace-nowrap text-slate-600 tabular-nums" title="Estimated tokens in this greeting (o200k tokenizer; your model may count a little differently)">
              {formatTokens(tokens)} tok
            </span>
          )}
          <span className="ml-auto flex flex-shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 touch:opacity-100">
            <IconButton title="Edit the greeting (for this chat, or on the card)" disabled={busy || editing !== null} onClick={() => setEditing(text)}>
              ✎
            </IconButton>
            {edited !== undefined && (
              <IconButton title="Use the card's greeting again (as it is now)" disabled={busy} onClick={() => void backToCards()}>
                ↺
              </IconButton>
            )}
          </span>
          {showId && <MessageId id={0} />}
          {count > 1 && (
            <span className="flex items-center gap-1 text-slate-400">
              <IconButton title="Previous greeting" disabled={editing !== null} onClick={() => onSwipe(index <= 0 ? count - 1 : index - 1)}>
                ‹
              </IconButton>
              <span className="tabular-nums">
                {index + 1}/{count}
              </span>
              <IconButton title="Next greeting" disabled={editing !== null} onClick={() => onSwipe(index >= count - 1 ? 0 : index + 1)}>
                ›
              </IconButton>
            </span>
          )}
        </div>
        {date !== undefined && <MessageTime time={date} />}
        {editing !== null ? (
          <div className="flex flex-col gap-1.5">
            <AutoTextarea autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} minRows={3} maxRows={20} />
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => saveToCard(editing)} title="Change the card's greeting itself (undo in the editor brings it back); every chat reading it live gets it, this one too">
                Save to the card
              </Button>
              <Button size="sm" variant="primary" onClick={() => saveToChat(editing)} title="This chat only: the card's greeting stays as it is">
                Save for this chat
              </Button>
            </div>
          </div>
        ) : shown ? (
          <Formatted text={shown} />
        ) : (
          <em className="text-sm text-slate-500">This greeting is empty.</em>
        )}
      </div>
    </div>
  );
}

function Bubble({
  card,
  message: m,
  messageId,
  showTime,
  userName,
  persona,
  streaming,
  streamReasoning,
  isLast,
  busy,
  onChange,
  onDelete,
  onDeleteAfter,
  onBranch,
  onSwipeNew,
  onRerollContinue,
  onUndoContinue,
  onShowTree,
}: {
  card: CardData;
  message: ChatMessage;
  /** Its number in the chat (the greeting is #0), when they're shown. */
  messageId?: number;
  /** Show when it (this version of it) was written. */
  showTime: boolean;
  userName: string;
  persona: Persona | null;
  streaming: boolean;
  streamReasoning: string;
  isLast: boolean;
  busy: boolean;
  onChange: (patch: Partial<ChatMessage>) => void;
  onDelete: () => void;
  onDeleteAfter: () => void;
  /** A new chat from here (this message and those before it). */
  onBranch: () => void;
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
  const next = swipeable ? () => (m.swipe < m.swipes.length - 1 ? onChange({ swipe: m.swipe + 1 }) : onSwipeNew()) : null;
  const prev = swipeable && m.swipe > 0 ? () => onChange({ swipe: m.swipe - 1 }) : null;
  const swipe = useSwipeGesture(next, prev);
  const box = useRef<HTMLDivElement>(null);
  useArrowSwipe(box, next, prev);
  return (
    <div ref={box} className={cx('group flex gap-2', isUser && 'flex-row-reverse')}>
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
            <IconButton title="Branch: a new chat from here (this message and everything before it, every version kept); this chat stays as it is" disabled={busy} onClick={onBranch}>
              🔀
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
        {showTime && <MessageTime time={swipeDate(m)} className={isUser ? 'text-right' : undefined} />}
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
      <ConnectionPicker value={chatConnectionId} onChange={setChatConnection} label="Connection" />
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
        {s.useLorebook && (
          <div className="flex w-full flex-wrap items-end gap-3" title="Used where the card's lorebook leaves its own blank; a lorebook's scan depth and token budget win. Only this test chat uses these: other frontends have their own defaults.">
            <span className="w-full text-xs text-slate-500">Lorebook defaults, where the card&apos;s lorebook sets none:</span>
            <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="How many recent messages are searched for keys">
              Scan depth
              <NumberInput value={s.loreScanDepth ?? DEFAULT_CHAT_SETTINGS.loreScanDepth} onChange={(v) => setChatSettings({ loreScanDepth: v ?? DEFAULT_CHAT_SETTINGS.loreScanDepth })} min={1} step={1} />
            </label>
            <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="The most tokens the lorebook's entries may add to a prompt; past it, the lowest-priority ones are left out. Blank or 0: no limit.">
              Token budget
              <NumberInput value={s.loreTokenBudget || undefined} onChange={(v) => setChatSettings({ loreTokenBudget: v ?? 0 })} min={0} step={100} allowEmpty placeholder="no limit" />
            </label>
            <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="With recursive scanning on (a lorebook setting), how many rounds of entries triggering entries, at most">
              Recursion steps
              <NumberInput value={s.loreMaxRecursion ?? DEFAULT_CHAT_SETTINGS.loreMaxRecursion} onChange={(v) => setChatSettings({ loreMaxRecursion: v ?? DEFAULT_CHAT_SETTINGS.loreMaxRecursion })} min={1} max={20} step={1} />
            </label>
          </div>
        )}
        <Toggle checked={s.showMessageIds} onChange={(v) => setChatSettings({ showMessageIds: v })} label={<span className="text-xs">Show message numbers (#0 is the greeting)</span>} />
        <Toggle checked={s.showTimestamps ?? true} onChange={(v) => setChatSettings({ showTimestamps: v })} label={<span className="text-xs" title="Each reply's versions have their own; the greeting shows when the chat began">Show when messages were sent</span>} />
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

const PARAM_LABELS: Record<string, string> = {
  max_tokens: 'max tokens',
  temperature: 'temperature',
  top_p: 'top P',
  top_k: 'top K',
  top_a: 'top A',
  min_p: 'min P',
  repetition_penalty: 'repetition penalty',
  frequency_penalty: 'frequency penalty',
  presence_penalty: 'presence penalty',
  seed: 'seed',
  reasoning_effort: 'reasoning effort',
  effort: 'effort',
  thinking: 'thinking',
  enable_thinking: 'thinking',
};

/** The samplers a chat request goes with: the connection's, with the
 *  preset's over them where it's used. */
function sentWith(connection: LlmConnection, overrides: Partial<SamplerParams>, preset: ChatPreset | null): SentWith {
  const merged: Record<string, unknown> = { ...connection.params, ...overrides };
  const params = Object.keys(PARAM_LABELS)
    .filter((k) => merged[k] !== undefined && merged[k] !== false && merged[k] !== '')
    .map((k) => ({ key: PARAM_LABELS[k], value: String(merged[k] === true ? 'on' : merged[k]), fromPreset: k in overrides }));
  const context = preset?.maxContext || connection.params.max_context;
  if (context) params.push({ key: 'context size', value: String(context), fromPreset: !!preset?.maxContext });
  return { connection: connection.name, model: connection.model, params, presetName: preset?.name };
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
        {prompt.sentWith && (
          <div className="text-xs text-slate-400">
            Sent with <span className="text-slate-200">{prompt.sentWith.connection}</span> ({prompt.sentWith.model || 'no model'}):{' '}
            {prompt.sentWith.params.map((p, i) => (
              <span key={p.key}>
                {i > 0 && ', '}
                {p.key} <span className={p.fromPreset ? 'text-violet-300' : 'text-slate-200'} title={p.fromPreset ? `From the preset "${prompt.sentWith!.presetName}"` : "The connection's own"}>{p.value}</span>
              </span>
            ))}
            {prompt.sentWith.params.some((p) => p.fromPreset) && <span className="text-slate-500"> (violet: from the preset &quot;{prompt.sentWith.presetName}&quot;)</span>}
            . Anything not listed is left to the model&apos;s default.
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
