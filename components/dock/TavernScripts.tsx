'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { CardData, Lorebook } from '@/types/card';
import type { BankLorebook, ChatMessage, ChatSession } from '@/types/project';
import { newPreset, parseStPreset, toStPreset, type ChatPreset } from '@/lib/stPreset';
import { chatGreeting, newMessage, type ChatPromptSettings } from '@/lib/chatPrompt';
import {
  cardScripts,
  fromStWorldFile,
  fromThPreset,
  fromThWorldbook,
  stWorldEntry,
  stWorldFile,
  thWorldbook,
  fromThRegexes,
  presetScripts,
  scriptKey,
  scriptSrcdoc,
  thMessages,
  thPreset,
  thRegexes,
  withInjections,
  type ScriptButton,
  type TavernScript,
  type ThInjection,
} from '@/lib/tavernHelper';
import { useChatStore } from '@/store/chatStore';
import { useLlmStore } from '@/store/llmStore';
import { useLorebookStore } from '@/store/lorebookStore';
import { newLorebook } from '@/lib/cardSpec';
import { chatToStJsonl } from '@/lib/chatExport';
import { entryBook } from '@/lib/lorebookBank';
import type { ScanResult } from '@/lib/lorebookScan';
import { useProjectStore } from '@/store/projectStore';
import { toast } from '@/store/uiStore';
import { useAssistLog, type AssistRun } from '@/store/assistLog';
import { uuid } from '@/lib/uuid';
import { Button, Modal, confirmDialog } from '@/components/ui';

// Tavern Helper (JS-Slash-Runner) scripts in the chat: the ones the chat
// preset and the card carry, each in a hidden sandboxed frame running
// public/tavern-helper-runtime.js, once you've said it may run. This file
// answers their calls (changing the chat, its variables, the preset and
// regex scripts, generating), keeps their copy of what they read up to
// date, and tells them what happens in the chat (Tavern Helper's events).

/** What scripts can ask the chat to do that only the chat can. */
export interface ScriptActions {
  /** A quiet generation for a script (generate / generateRaw): not added
   *  to the chat. */
  generate: (config: Record<string, unknown>, raw: boolean, script: TavernScript) => Promise<string>;
  stop: () => void;
  /** /setinput, /send, /trigger and /echo. */
  slash: (command: string) => Promise<void>;
  /** The message box (SillyTavern's #send_textarea), and its send button. */
  setInput: (text: string) => void;
  submit: (text: string) => void;
  /** The chat connection's models (SillyTavern's model list). */
  listModels: () => Promise<string[]>;
}

interface Running {
  script: TavernScript;
  key: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const record = (v: unknown): Record<string, unknown> => (isObject(v) ? v : {});
/** Tavern Helper's own variables in a preset's or card's extensions (its
 *  typings spell it "variales"). */
const thVars = (ext: unknown) => {
  const th = record(record(ext).tavern_helper);
  return record(th.variables ?? th.variales);
};
const withThVars = (ext: unknown, vars: Record<string, unknown>) => {
  const e = record(ext);
  return { ...e, tavern_helper: { ...record(e.tavern_helper), variables: vars } };
};
/** How long the chat waits on scripts going over the prompt. */
const PROMPT_WAIT_MS = 3000;
/** The most a script's localStorage may hold. */
const STORAGE_MAX = 1_000_000;

/** The card's lorebook's name, as scripts see it. */
const cardBookName = (c: CardData) => c.character_book?.name?.trim() || c.name || 'Character';
const bankName = (b: BankLorebook) => b.book.name?.trim() || 'Lorebook';

type BookRef = { kind: 'card'; book: Lorebook } | { kind: 'bank'; id: string; book: Lorebook };
/** A lorebook scripts named: the card's, or one in the Lorebooks bank. */
function findBook(name: unknown): BookRef | null {
  const card = useProjectStore.getState().project?.card.data;
  if (card?.character_book && cardBookName(card) === name) return { kind: 'card', book: card.character_book };
  const b = useLorebookStore.getState().books.find((x) => bankName(x) === name);
  return b ? { kind: 'bank', id: b.id, book: b.book } : null;
}
function saveBook(ref: BookRef, book: Lorebook) {
  if (ref.kind === 'card') useProjectStore.getState().updateCard((d) => ({ ...d, character_book: book }), 'tavern-helper-lore');
  else useLorebookStore.getState().setBook(ref.id, book);
}
/**
 * SillyTavern's own server, as scripts call it (fetch('/api/…')): the parts
 * UCCB can answer, in SillyTavern's shapes. The model list is the chat
 * connection's (a script can't point it at another server).
 */
async function stApi(path: string, body: unknown, act: ScriptActions | null, names: { char: string; user: string }): Promise<{ status: number; body: unknown }> {
  const b = record(body);
  const card = useProjectStore.getState().project?.card.data;
  const chat = useChatStore.getState().chat;
  const notFound = (what: string) => ({ status: 404, body: { error: what } });
  switch (path) {
    case '/api/backends/chat-completions/status':
    case '/api/backends/text-completions/status': {
      if (!act) return { status: 503, body: { error: 'The chat is not ready.' } };
      const models = await act.listModels();
      return { status: 200, body: { object: 'list', data: models.map((id) => ({ id, object: 'model' })) } };
    }
    case '/api/worldinfo/get': {
      const ref = findBook(b.name);
      return ref ? { status: 200, body: stWorldFile(ref.book, String(b.name)) } : notFound(`There's no lorebook "${String(b.name)}".`);
    }
    case '/api/worldinfo/edit': {
      const ref = findBook(b.name);
      if (!ref) return notFound(`There's no lorebook "${String(b.name)}".`);
      saveBook(ref, fromStWorldFile(b.data, ref.book));
      return { status: 200, body: { ok: true } };
    }
    case '/api/characters/get':
      return card ? { status: 200, body: { ...card, avatar: `${card.name}.png`, chat: chat?.name ?? '', data: card } } : notFound('No character is open.');
    case '/api/chats/get':
      return { status: 200, body: chat && card ? chatToStJsonl(chat, card, names.user).trim().split('\n').map((l) => JSON.parse(l) as unknown) : [] };
    case '/api/settings/get': {
      const books = useLorebookStore.getState().books.map(bankName);
      return { status: 200, body: { settings: JSON.stringify({ username: names.user }), world_names: [...(card?.character_book ? [cardBookName(card)] : []), ...books] } };
    }
    case '/api/ping':
      return { status: 204, body: '' };
    default:
      return notFound(`UCCB doesn't have SillyTavern's ${path}.`);
  }
}

const needBook = (name: unknown) => {
  const ref = findBook(name);
  if (!ref) throw new Error(`There's no lorebook "${String(name)}".`);
  return ref;
};

export function useTavernScripts({
  card,
  chat,
  preset,
  settings,
  userName,
  model,
  input,
  actions,
  lorebookIds,
}: {
  card: CardData | null;
  chat: ChatSession | null;
  /** The preset in use (null when none is, or a text-completion connection leaves it out). */
  preset: ChatPreset | null;
  settings: ChatPromptSettings;
  userName: string;
  /** The chat connection's model (getChatCompletionModel). */
  model?: string;
  /** The message box, which scripts see as SillyTavern's. */
  input: string;
  /** Set by the chat once it's rendered (its actions need what it builds). */
  actions: RefObject<ScriptActions | null>;
  /** The card's linked lorebooks (its "additional" ones, to scripts). */
  lorebookIds?: string[];
}) {
  const on = settings.runScripts !== false;
  const all = useMemo(() => {
    if (!on) return [];
    const list = [...presetScripts(preset), ...cardScripts(card?.extensions as Record<string, unknown> | undefined)].map((script) => ({ script, key: scriptKey(script) }));
    return list.filter((x, i) => list.findIndex((y) => y.key === x.key) === i);
  }, [on, preset, card?.extensions]);
  const approvals = settings.scriptApprovals;
  const running = useMemo(() => all.filter((x) => approvals?.[x.key] === 'run'), [all, approvals]);
  const pending = useMemo(() => all.filter((x) => !approvals?.[x.key]), [all, approvals]);

  const [buttons, setButtons] = useState<Record<string, ScriptButton[]>>({});
  const [reloads, setReloads] = useState<Record<string, number>>({});
  /** What each script shows over the chat (see the runtime's report()). */
  const [overlays, setOverlays] = useState<Record<string, { rects: number[][]; grab: boolean }>>({});
  /** How scripts changed messages' look (by message id), with the text it
   *  was for: shown in place of the message until its text changes. */
  const [displays, setDisplays] = useState<{ chatId?: string; byId: Record<string, { html: string; text: string }> }>({ byId: {} });
  /** Each running script's frame, by its key. */
  const [frames] = useState(() => new Map<string, HTMLIFrameElement>());
  const injections = useRef(new Map<string, ThInjection & { once: boolean }>());
  const acks = useRef(new Map<number, (value: unknown) => void>());
  const ackSeq = useRef(0);
  /** Set while the chat writes a reply, or a script changes the chat, so
   *  those changes aren't reported as your edits. */
  const generating = useRef(false);
  const applying = useRef(false);

  // What scripts read, in Tavern Helper's shapes.
  const names = useMemo(() => ({ char: card?.nickname || card?.name || 'Character', user: userName || 'User' }), [card?.nickname, card?.name, userName]);
  // Message 0 is the greeting (empty if the chat has none), as the chat numbers them.
  const greeting = card && chat ? chatGreeting(card, chat) : null;
  const chatPart = useMemo(() => thMessages(chat?.messages ?? [], greeting, names), [chat?.messages, greeting, names]);
  const presetPart = useMemo(() => (preset && running.length ? thPreset(preset) : null), [preset, running.length]);
  // The same preset as SillyTavern's settings (getContext().chatCompletionSettings).
  // UCCB's connections count as SillyTavern's custom (OpenAI-compatible) source.
  const stPresetPart = useMemo(
    () => (preset && running.length ? { ...toStPreset(preset), chat_completion_source: 'custom', custom_model: model ?? '', openai_model: model ?? '' } : null),
    [preset, running.length, model],
  );
  // The other presets, for scripts that read them by name (getPreset, the
  // preset manager), and Tavern Helper's default_preset.
  const presetList = useLlmStore((s) => s.presets);
  const otherPresetsPart = useMemo(() => {
    if (!running.length) return { all: {}, allSt: {} };
    const others = presetList.filter((p) => p.id !== preset?.id).reverse();
    return {
      all: Object.fromEntries(others.map((p) => [p.name, thPreset(p)])),
      allSt: Object.fromEntries(others.map((p) => [p.name, { ...toStPreset(p), chat_completion_source: 'custom' }])),
    };
  }, [presetList, preset?.id, running.length]);
  const defaultPresetPart = useMemo(() => (running.length ? thPreset(newPreset('Default')) : null), [running.length]);
  const cardPart = useMemo(
    () =>
      card
        ? { name: card.name, description: card.description, personality: card.personality, scenario: card.scenario, first_mes: card.first_mes, mes_example: card.mes_example, creator_notes: card.creator_notes, system_prompt: card.system_prompt, post_history_instructions: card.post_history_instructions, alternate_greetings: card.alternate_greetings, tags: card.tags }
        : null,
    [card],
  );
  const regexPart = useMemo(
    () => ({ preset: preset ? thRegexes(record(preset.extra?.extensions).regex_scripts, 'global') : [], character: thRegexes(record(card?.extensions).regex_scripts, 'character') }),
    [preset, card?.extensions],
  );
  const varsPart = useMemo(
    () => ({ chat: chat?.vars ?? {}, global: settings.thGlobalVars ?? {}, preset: thVars(preset?.extra?.extensions), character: thVars(card?.extensions) }),
    [chat?.vars, settings.thGlobalVars, preset, card?.extensions],
  );
  const presetNames = useLlmStore((s) => s.presets.map((p) => p.name).join('\u0000'));
  const misc = useMemo(
    () => ({ names, presetName: preset?.name ?? '', presetNames: presetNames ? presetNames.split('\u0000') : [], cardRegexOn: settings.useCardRegex !== false, model: model ?? '', chatId: chat?.id ?? '', card: cardPart }),
    [names, preset?.name, presetNames, settings.useCardRegex, model, chat?.id, cardPart],
  );
  // The lorebooks scripts can name: the card's, and the bank's.
  const bank = useLorebookStore((s) => s.books);
  const worldbooksPart = useMemo(() => {
    const ofIds = (ids: (string | undefined)[]) => bank.filter((b) => ids.includes(b.id)).map(bankName);
    return {
      names: [...(card?.character_book ? [cardBookName(card)] : []), ...bank.map(bankName)],
      global: ofIds(settings.globalLorebooks ?? []),
      charPrimary: card?.character_book ? cardBookName(card) : null,
      charAdditional: ofIds(lorebookIds ?? []),
      chat: ofIds([chat?.lorebookId])[0] ?? null,
    };
  }, [bank, card, settings.globalLorebooks, chat?.lorebookId, lorebookIds]);
  const loreSettingsPart = useMemo(
    () => ({
      selected_global_lorebooks: worldbooksPart.global,
      scan_depth: settings.loreScanDepth ?? 2,
      context_percentage: 100,
      budget_cap: settings.loreTokenBudget ?? 0,
      min_activations: 0,
      max_depth: 0,
      max_recursion_steps: settings.loreMaxRecursion ?? 0,
      insertion_strategy: 'character_first',
      include_names: true,
      recursive: true,
      case_sensitive: false,
      match_whole_words: false,
      use_group_scoring: false,
      overflow_alert: false,
    }),
    [worldbooksPart.global, settings.loreScanDepth, settings.loreTokenBudget, settings.loreMaxRecursion],
  );
  const scriptVars = settings.thScriptVars;
  const snapshot = (script: TavernScript) => ({ chat: chatPart, preset: presetPart, stPreset: stPresetPart, allPresets: otherPresetsPart.all, allStPresets: otherPresetsPart.allSt, defaultPreset: defaultPresetPart, input, regexes: regexPart, worldbooks: worldbooksPart, loreSettings: loreSettingsPart, vars: { ...varsPart, script: scriptVars?.[script.id] ?? {} }, ...misc });
  const latest = useRef({ running, snapshot, chat, chatPart, preset, actions, card, names });
  useEffect(() => {
    latest.current = { running, snapshot, chat, chatPart, preset, actions, card, names };
  });

  const post = (key: string, msg: Record<string, unknown>) => frames.get(key)?.contentWindow?.postMessage({ uccbTh: 1, ...msg }, '*');
  const postAll = (msg: Record<string, unknown>, except?: string) => {
    for (const r of latest.current.running) if (r.key !== except) post(r.key, msg);
  };

  // Keep each script's copy current. The chat changes with every word of a
  // reply being written, so it goes over at most a few times a second.
  const chatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (chatTimer.current) return;
    chatTimer.current = setTimeout(() => {
      chatTimer.current = null;
      postAll({ state: { chat: latest.current.chatPart } });
    }, generating.current ? 300 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatPart]);
  useEffect(() => postAll({ state: { preset: presetPart, stPreset: stPresetPart, regexes: regexPart, ...misc } }), [presetPart, stPresetPart, regexPart, misc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => postAll({ state: { allPresets: otherPresetsPart.all, allStPresets: otherPresetsPart.allSt, defaultPreset: defaultPresetPart } }), [otherPresetsPart, defaultPresetPart]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => postAll({ state: { input } }), [input]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => postAll({ state: { worldbooks: worldbooksPart, loreSettings: loreSettingsPart } }), [worldbooksPart, loreSettingsPart]); // eslint-disable-line react-hooks/exhaustive-deps
  // A script whose saved storage was cleared (Chat settings) starts afresh.
  const stored = settings.thScriptStorage;
  const storedBefore = useRef(stored);
  useEffect(() => {
    const was = storedBefore.current;
    storedBefore.current = stored;
    const gone = running.filter((r) => was?.[r.script.id] && !stored?.[r.script.id]);
    if (gone.length) setReloads((rl) => ({ ...rl, ...Object.fromEntries(gone.map((r) => [r.key, (rl[r.key] ?? 0) + 1])) }));
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const r of running) post(r.key, { state: { vars: { ...varsPart, script: scriptVars?.[r.script.id] ?? {} } } });
  }, [varsPart, scriptVars]); // eslint-disable-line react-hooks/exhaustive-deps

  /** SillyTavern's number for a UCCB message, and back. */
  const offset = () => 1;

  /** Changes the chat for a script, without telling scripts you did it. */
  const applyMessages = (change: (m: ChatMessage[]) => ChatMessage[]) => {
    applying.current = true;
    try {
      useChatStore.getState().setMessages(change);
    } finally {
      applying.current = false;
    }
  };

  // What scripts ask for.
  useEffect(() => {
    const handle = async (key: string, script: TavernScript, method: string, a: Record<string, unknown>): Promise<unknown> => {
      const llm = useLlmStore.getState();
      const { preset: p, chat: c } = latest.current;
      const act = latest.current.actions.current;
      const off = offset();
      switch (method) {
        case 'setVars': {
          const vars = record(a.vars);
          if (a.type === 'chat') useChatStore.getState().setVars(vars);
          else if (a.type === 'global') llm.setChatSettings({ thGlobalVars: vars });
          else if (a.type === 'script') llm.setChatSettings({ thScriptVars: { ...llm.chatSettings.thScriptVars, [script.id]: vars } });
          else if (a.type === 'preset') {
            if (!p) throw new Error('No preset is in use.');
            llm.updatePreset(p.id, { extra: { ...p.extra, extensions: withThVars(p.extra?.extensions, vars) } });
          } else if (a.type === 'character') useProjectStore.getState().updateCard((d) => ({ ...d, extensions: withThVars(d.extensions, vars) }), 'tavern-helper-vars');
          else if (a.type === 'message') {
            const i = Number(a.message_id) - off;
            applyMessages((ms) => ms.map((m, j) => (j === i ? { ...m, data: m.swipes.map((_, k) => (k === m.swipe ? vars : m.data?.[k])) } : m)));
          }
          return;
        }
        case 'setChatMessages': {
          const changes = (Array.isArray(a.messages) ? a.messages : []).filter(isObject);
          for (const ch of changes) if (ch.message_id === 0 && typeof ch.message === 'string' && c && c.greeting >= 0) useChatStore.getState().setGreetingEdit(c.greeting, ch.message);
          const byIndex = new Map(changes.map((ch) => [Number(ch.message_id) - off, ch]));
          applyMessages((ms) =>
            ms.map((m, i) => {
              const ch = byIndex.get(i);
              if (!ch) return m;
              const next: ChatMessage = { ...m };
              if (Array.isArray(ch.swipes) && ch.swipes.length) next.swipes = ch.swipes.map(String);
              if (typeof ch.swipe_id === 'number') next.swipe = Math.max(0, Math.min(next.swipes.length - 1, ch.swipe_id));
              next.swipe = Math.min(next.swipe, next.swipes.length - 1);
              if (typeof ch.message === 'string') next.swipes = next.swipes.map((s, k) => (k === next.swipe ? (ch.message as string) : s));
              if (typeof ch.is_hidden === 'boolean') next.hidden = ch.is_hidden || undefined;
              if (Array.isArray(ch.swipes_data)) next.data = ch.swipes_data.map((d) => (isObject(d) ? d : undefined));
              if (isObject(ch.data)) next.data = next.swipes.map((_, k) => (k === next.swipe ? (ch.data as Record<string, unknown>) : next.data?.[k]));
              if (ch.role === 'user' || ch.role === 'assistant' || ch.role === 'system') next.role = ch.role;
              return next;
            }),
          );
          return;
        }
        case 'createChatMessages': {
          const made = (Array.isArray(a.messages) ? a.messages : []).filter(isObject).map((x) => {
            const role = x.role === 'user' || x.role === 'system' ? x.role : 'assistant';
            const m = newMessage(role, typeof x.message === 'string' ? x.message : '');
            if (x.is_hidden === true) m.hidden = true;
            if (isObject(x.data)) m.data = [x.data];
            return m;
          });
          applyMessages((ms) => {
            const at = typeof a.insert_before === 'number' ? Math.max(0, Math.min(ms.length, a.insert_before - off)) : ms.length;
            return [...ms.slice(0, at), ...made, ...ms.slice(at)];
          });
          return;
        }
        case 'deleteChatMessages': {
          const gone = new Set((Array.isArray(a.ids) ? a.ids : []).map((id) => Number(id) - off));
          applyMessages((ms) => ms.filter((_, i) => !gone.has(i)));
          return;
        }
        case 'replacePreset': {
          const target = a.name === 'in_use' ? p : llm.presets.find((x) => x.name === a.name);
          if (!target) throw new Error(a.name === 'in_use' ? 'No preset is in use.' : `There's no preset "${String(a.name)}".`);
          llm.updatePreset(target.id, fromThPreset(a.preset, target));
          return;
        }
        case 'saveStPreset': {
          // SillyTavern's settings for the preset, as getContext() gave them.
          const target = a.name === 'in_use' || a.name === p?.name ? p : llm.presets.find((x) => x.name === a.name);
          if (!target) throw new Error(`There's no preset "${String(a.name)}".`);
          const parsed = parseStPreset(record(a.settings), target.name);
          llm.updatePreset(target.id, { ...parsed, id: target.id, name: target.name, importedAt: target.importedAt });
          return;
        }
        case 'storage': {
          const items = Object.fromEntries(Object.entries(record(a.items)).map(([k, v]) => [k, String(v)]));
          if (JSON.stringify(items).length > STORAGE_MAX) throw new Error(`${script.name}'s saved data is over 1 MB, so it wasn't kept.`);
          llm.setChatSettings({ thScriptStorage: { ...llm.chatSettings.thScriptStorage, [script.id]: items } });
          return;
        }
        case 'stApi':
          return stApi(String(a.path ?? ''), a.body, act, latest.current.names);
        // Lorebooks.
        case 'getWorldbook':
          return thWorldbook(needBook(a.name).book);
        case 'replaceWorldbook': {
          const ref = needBook(a.name);
          saveBook(ref, fromThWorldbook(a.entries, ref.book));
          return;
        }
        case 'createWorldbook': {
          const ref = findBook(a.name);
          if (ref && a.replace !== true) return false;
          if (ref) {
            saveBook(ref, fromThWorldbook(a.entries, { ...ref.book, entries: [] }));
            return true;
          }
          const name = String(a.name ?? '').trim();
          if (!name) throw new Error('A lorebook needs a name.');
          await useLorebookStore.getState().add({ ...fromThWorldbook(a.entries, newLorebook()), name });
          return true;
        }
        case 'deleteWorldbook': {
          const ref = findBook(a.name);
          if (!ref) return false;
          if (ref.kind === 'card') throw new Error("The card's own lorebook can't be deleted by a script.");
          const ok = await confirmDialog({ title: `Delete the lorebook "${String(a.name)}"?`, body: `The script "${script.name}" wants to delete it from your Lorebooks. This can't be undone.`, confirmLabel: 'Delete', danger: true });
          if (ok) await useLorebookStore.getState().remove(ref.id);
          return ok;
        }
        case 'bindChatWorldbook': {
          if (a.name === null || a.name === '') {
            useChatStore.getState().setChatLorebook(undefined);
            return;
          }
          const ref = needBook(a.name);
          if (ref.kind !== 'bank') throw new Error("The card's lorebook is already the character's; a chat's lorebook comes from the Lorebooks bank.");
          useChatStore.getState().setChatLorebook(ref.id);
          return;
        }
        case 'getOrCreateChatWorldbook': {
          const current = useLorebookStore.getState().books.find((b) => b.id === useChatStore.getState().chat?.lorebookId);
          if (current) return bankName(current);
          const name = String(a.name ?? '').trim() || `${latest.current.names.char} chat lorebook`;
          const made = findBook(name)?.kind === 'bank' ? useLorebookStore.getState().books.find((b) => bankName(b) === name)! : await useLorebookStore.getState().add({ ...newLorebook(), name });
          useChatStore.getState().setChatLorebook(made.id);
          return bankName(made);
        }
        case 'bindGlobalWorldbooks': {
          const names = (Array.isArray(a.names) ? a.names : []).map(String);
          const books = useLorebookStore.getState().books;
          const missing = names.filter((n) => !books.some((b) => bankName(b) === n));
          if (missing.length) throw new Error(`Only lorebooks in the Lorebooks bank can be global (not ${missing.map((n) => `"${n}"`).join(', ')}).`);
          llm.setChatSettings({ globalLorebooks: books.filter((b) => names.includes(bankName(b))).map((b) => b.id) });
          return;
        }
        case 'loreSettings': {
          const patch = record(a.patch);
          const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
          llm.setChatSettings({
            ...(n(patch.scan_depth) !== undefined ? { loreScanDepth: n(patch.scan_depth) } : {}),
            ...(n(patch.budget_cap) !== undefined ? { loreTokenBudget: n(patch.budget_cap) } : {}),
            ...(n(patch.max_recursion_steps) !== undefined ? { loreMaxRecursion: n(patch.max_recursion_steps) } : {}),
          });
          if (Array.isArray(patch.selected_global_lorebooks)) await handle(key, script, 'bindGlobalWorldbooks', { names: patch.selected_global_lorebooks });
          return;
        }
        case 'input':
          act?.setInput(String(a.text ?? ''));
          return;
        case 'submit':
          if (String(a.text ?? '').trim()) act?.submit(String(a.text));
          return;
        case 'display': {
          const n = Number(a.message_id);
          const ms = useChatStore.getState().chat?.messages ?? [];
          const id = n === 0 ? 'greeting' : ms[n - off]?.id;
          if (!id) return;
          const chatId = useChatStore.getState().chat?.id;
          setDisplays((d) => {
            const byId = { ...(d.chatId === chatId ? d.byId : {}) };
            if (typeof a.html === 'string') byId[id] = { html: a.html, text: String(a.text ?? '') };
            else delete byId[id];
            return { chatId, byId };
          });
          return;
        }
        case 'overlay':
          setOverlays((o) => ({ ...o, [key]: { rects: (Array.isArray(a.rects) ? a.rects : []).filter((r): r is number[] => Array.isArray(r) && r.length === 4 && r.every((n) => typeof n === 'number' && Number.isFinite(n))).slice(0, 200), grab: a.grab === true } }));
          return;
        case 'createPreset': {
          const name = String(a.name ?? '').trim();
          if (!name) throw new Error('A preset needs a name.');
          const target = name === 'in_use' ? p : llm.presets.find((x) => x.name === name);
          if (target && a.replace !== true) return false;
          if (target) {
            llm.updatePreset(target.id, fromThPreset(a.preset ?? thPreset(newPreset(target.name)), target));
            return true;
          }
          const made = newPreset(name);
          const full = a.preset ? fromThPreset(a.preset, made) : made;
          // Added to the list, not put in use (as in SillyTavern).
          useLlmStore.setState((s) => ({ presets: [...s.presets, full] }));
          return true;
        }
        case 'deletePreset': {
          const target = llm.presets.find((x) => x.name === a.name);
          if (!target) return false;
          if (target.id === p?.id) throw new Error("The preset in use can't be deleted; pick another first.");
          const ok = await confirmDialog({ title: `Delete the preset "${target.name}"?`, body: `The script "${script.name}" wants to delete it from your presets. This can't be undone.`, confirmLabel: 'Delete', danger: true });
          if (ok) llm.removePreset(target.id);
          return ok;
        }
        case 'renamePreset': {
          const target = llm.presets.find((x) => x.name === a.name);
          const newName = String(a.newName ?? '').trim();
          if (!target || !newName || llm.presets.some((x) => x.name === newName)) return false;
          llm.updatePreset(target.id, { name: newName });
          return true;
        }
        case 'loadPreset': {
          const target = llm.presets.find((x) => x.name === a.name);
          if (target) llm.setChatSettings({ presetId: target.id });
          return;
        }
        case 'replaceRegexes': {
          const list = fromThRegexes(a.regexes);
          if (a.kind === 'preset') {
            if (!p) throw new Error('No preset is in use.');
            llm.updatePreset(p.id, { extra: { ...p.extra, extensions: { ...record(p.extra?.extensions), regex_scripts: list } } });
          } else useProjectStore.getState().updateCard((d) => ({ ...d, extensions: { ...d.extensions, regex_scripts: list } }), 'tavern-helper-regex');
          return;
        }
        case 'generate':
          if (!act) throw new Error('The chat is not ready.');
          return act.generate(record(a.config), a.raw === true, script);
        case 'stop':
          act?.stop();
          return;
        case 'slash':
          if (!act) throw new Error('The chat is not ready.');
          await act.slash(String(a.command ?? ''));
          return '';
        case 'toast': {
          const text = String(a.text ?? '').trim();
          if (text) toast(`🧩 ${text.slice(0, 300)}`, a.tone === 'error' || a.tone === 'success' ? a.tone : 'info');
          return;
        }
        case 'buttons':
          setButtons((b) => ({ ...b, [key]: (Array.isArray(a.buttons) ? a.buttons : []).filter(isObject).map((x) => ({ name: String(x.name), visible: x.visible !== false })) }));
          return;
        case 'inject':
          for (const i of (Array.isArray(a.prompts) ? a.prompts : []).filter(isObject))
            injections.current.set(`${key}\u0000${String(i.id)}`, { id: String(i.id), position: i.position === 'none' ? 'none' : 'in_chat', depth: Number(i.depth) || 0, role: i.role === 'user' || i.role === 'assistant' ? i.role : 'system', content: String(i.content ?? ''), once: a.once === true });
          return;
        case 'uninject':
          for (const id of Array.isArray(a.ids) ? a.ids : []) injections.current.delete(`${key}\u0000${String(id)}`);
          return;
        case 'emit':
          postAll({ event: String(a.type), args: Array.isArray(a.args) ? a.args : [] }, key);
          return;
        case 'reload':
          setReloads((r) => ({ ...r, [key]: (r[key] ?? 0) + 1 }));
          return;
        default:
          throw new Error(`${method} isn't supported in UCCB.`);
      }
    };
    const onMessage = async (e: MessageEvent) => {
      const m = e.data as { uccbTh?: number; id?: number; method?: string; args?: unknown; ack?: number; value?: unknown };
      if (!m || m.uccbTh !== 1) return;
      const entry = [...frames].find(([, f]) => f.contentWindow === e.source);
      if (!entry) return;
      const [key, frame] = entry;
      const run = latest.current.running.find((r) => r.key === key);
      if (!run) return;
      if (typeof m.ack === 'number') {
        acks.current.get(m.ack)?.(m.value);
        return;
      }
      if (typeof m.method !== 'string') return;
      const reply = (value?: unknown, error?: string) => typeof m.id === 'number' && frame.contentWindow?.postMessage({ uccbTh: 1, result: m.id, value, error }, '*');
      try {
        reply(await handle(key, run.script, m.method, record(m.args)));
      } catch (err) {
        reply(undefined, (err as Error).message);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // Everything it needs is read from `latest` and the stores when called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Your edits, deletions and swipes, and switching chats, as Tavern
  // Helper's events. (New messages are told by the chat as it adds them.)
  useEffect(
    () =>
      useChatStore.subscribe((s, prev) => {
        if (!latest.current.running.length) return;
        if (s.chat?.id !== prev.chat?.id) {
          if (s.chat) postAll({ event: 'chat_id_changed', args: [s.chat.id] });
          return;
        }
        if (generating.current || applying.current || !s.chat || !prev.chat || s.chat.messages === prev.chat.messages) return;
        const off = 1;
        const ids = new Set(s.chat.messages.map((m) => m.id));
        prev.chat.messages.forEach((m, i) => !ids.has(m.id) && postAll({ event: 'message_deleted', args: [i + off] }));
        const before = new Map(prev.chat.messages.map((m) => [m.id, m]));
        s.chat.messages.forEach((m, i) => {
          const b = before.get(m.id);
          if (!b) return;
          if (b.swipe !== m.swipe) postAll({ event: 'message_swiped', args: [i + off] });
          else if (b.swipes[b.swipe] !== m.swipes[m.swipe]) postAll({ event: 'message_edited', args: [i + off] });
        });
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Tells the scripts something happened (Tavern Helper's events), with
   *  the chat as it is this moment (their copy may not have caught up yet). */
  const emit = (type: string, ...args: unknown[]) => {
    const { card: cd, names: n } = latest.current;
    const c = useChatStore.getState().chat;
    if (c && cd) postAll({ state: { chat: thMessages(c.messages, chatGreeting(cd, c), n) } });
    postAll({ event: type, args });
  };

  /** SillyTavern's number for a message of the chat, by its id. */
  const messageNumber = (id: string) => {
    const ms = useChatStore.getState().chat?.messages ?? [];
    const i = ms.findIndex((m) => m.id === id);
    return i < 0 ? -1 : i + offset();
  };

  /** Sends an event every script may change the data of, in turn, waiting
   *  for each (up to PROMPT_WAIT_MS): what the last one made of it. */
  const awaitEvent = async (type: string, data: unknown, ...rest: unknown[]): Promise<unknown> => {
    for (const r of latest.current.running) {
      const id = ++ackSeq.current;
      const answer = await Promise.race([
        new Promise<unknown>((resolve) => {
          acks.current.set(id, resolve);
          post(r.key, { event: type, args: [data, ...rest], ack: id });
        }),
        new Promise<unknown>((resolve) => setTimeout(() => resolve(undefined), PROMPT_WAIT_MS)),
      ]);
      acks.current.delete(id);
      if (answer !== undefined && answer !== null) data = answer;
    }
    return data;
  };

  /**
   * The prompt as it's about to be sent, through what scripts hear in
   * SillyTavern at this point, in its order: the lorebook entries that
   * fired (WORLD_INFO_ACTIVATED, WORLDINFO_SCAN_DONE), the scripts'
   * injections put in, then the prompt itself (CHAT_COMPLETION_PROMPT_READY),
   * the request (CHAT_COMPLETION_SETTINGS_READY) and its data
   * (GENERATE_AFTER_DATA), each of which scripts can change.
   */
  const beforeSend = async <T extends { role: string; content: unknown }>(messages: T[], ctx: { lore?: ScanResult; request?: Record<string, unknown> } = {}): Promise<T[]> => {
    if (!latest.current.running.length) return messages;
    const card = latest.current.card;
    if (ctx.lore && card) {
      const world = (e: ScanResult['active'][number]['entry']) => entryBook(e) ?? cardBookName(card);
      const fired = ctx.lore.active.map((a) => stWorldEntry(a.entry, a.index, world(a.entry)));
      emit('world_info_activated', fired);
      await awaitEvent('worldinfo_scan_done', {
        state: { current: 0, next: 0, loopCount: 0 },
        new: { all: fired, successful: fired },
        activated: { entries: new Map(fired.map((e) => [`${String(e.world)}.${String(e.uid)}`, e])), text: ctx.lore.active.map((a) => a.entry.content).join('\n') },
        sortedEntries: fired,
        recursionDelay: { availableLevels: [], currentLevel: 0 },
        budget: { current: 0, overflowed: ctx.lore.dropped.length > 0 },
        timedEffects: {},
      });
    }
    const list = [...injections.current.values()];
    for (const [k, i] of injections.current) if (i.once) injections.current.delete(k);
    let out = withInjections(messages, list, (i) => ({ role: i.role, content: i.content }) as unknown as T);
    const valid = (v: unknown) => (Array.isArray(v) ? v.filter((m): m is T => isObject(m) && typeof m.role === 'string') : null);
    out = valid(record(await awaitEvent('chat_completion_prompt_ready', { chat: out, dryRun: false })).chat) ?? out;
    out = valid(record(await awaitEvent('chat_completion_settings_ready', { ...ctx.request, messages: out, stream: true, chat_completion_source: 'custom' })).messages) ?? out;
    out = valid(record(await awaitEvent('generate_after_data', { prompt: out }, false)).prompt) ?? out;
    return out;
  };
  const setGenerating = (on: boolean) => {
    generating.current = on;
    postAll({ state: { busy: on } });
  };

  // The frames themselves, once the runtime's text is here.
  const runtime = useRuntime(running.length > 0);
  // Each covers the window, clipped to what its script shows on it (in a
  // portal, so nothing in the chat's layout moves or clips it).
  const frameNodes =
    runtime !== null && typeof document !== 'undefined'
      ? createPortal(
          running.map((r) => (
            <ScriptFrame
              key={`${r.key}:${reloads[r.key] ?? 0}`}
              script={r.script}
              boot={{ scriptId: r.script.id, scriptName: r.script.name, scriptInfo: r.script.info, buttons: r.script.buttons, storage: settings.thScriptStorage?.[r.script.id] ?? {}, state: snapshot(r.script) }}
              runtime={runtime}
              overlay={overlays[r.key]}
              onFrame={(f) => (f ? frames.set(r.key, f) : frames.delete(r.key))}
            />
          )),
          document.body,
        )
      : null;

  const shownButtons = running.flatMap((r) => (buttons[r.key] ?? r.script.buttons).filter((b) => b.visible).map((b) => ({ key: r.key, script: r.script, name: b.name })));
  const clickButton = (key: string, name: string) => post(key, { event: name, args: [] });

  /** How a script made a message look, while its text is still 	ext. */
  const displayFor = (id: string, text: string) => {
    if (displays.chatId !== chat?.id) return undefined;
    const d = displays.byId[id];
    return d && d.text === text ? d.html : undefined;
  };

  return { all, running, pending, frames: frameNodes, displayFor, buttons: shownButtons, clickButton, emit, beforeSend, setGenerating, messageNumber };
}

/** The runtime's text (public/tavern-helper-runtime.js), fetched once when
 *  a script first needs it. */
let runtimeText: Promise<string> | null = null;
function useRuntime(wanted: boolean): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || text !== null) return;
    runtimeText ??= fetch('/tavern-helper-runtime.js').then((r) => {
      if (!r.ok) throw new Error(`The Tavern Helper runtime didn't load (${r.status}).`);
      return r.text();
    });
    let live = true;
    runtimeText.then(
      (t) => live && setText(t),
      (err: Error) => {
        runtimeText = null;
        toast(err.message, 'error');
      },
    );
    return () => {
      live = false;
    };
  }, [wanted, text]);
  return text;
}

/** Hands the chat's current actions to the scripts (after each render). */
export function ScriptActionsHost({ actionsRef, actions }: { actionsRef: RefObject<ScriptActions | null>; actions: ScriptActions }) {
  useEffect(() => {
    actionsRef.current = actions;
  });
  return null;
}

/** A script's frame: the whole window, see-through, and clipped to the
 *  boxes its script shows (clicks outside them reach the chat), or to
 *  nothing. While you drag in it, it takes the whole window. */
function ScriptFrame({
  script,
  boot,
  runtime,
  overlay,
  onFrame,
}: {
  script: TavernScript;
  boot: Record<string, unknown>;
  runtime: string;
  overlay?: { rects: number[][]; grab: boolean };
  onFrame: (f: HTMLIFrameElement | null) => void;
}) {
  // Built once: later changes go to the script as messages.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const srcdoc = useMemo(() => scriptSrcdoc(script, boot, runtime), []);
  const clip = overlay?.grab ? 'none' : overlay?.rects.length ? `path('${overlay.rects.map(([x, y, w, h]) => `M${x},${y}h${w}v${h}h${-w}Z`).join('')}')` : 'inset(50%)';
  return (
    <iframe
      ref={onFrame}
      title={`Script: ${script.name}`}
      // Its own dialogs (confirm, prompt) and downloads, as in SillyTavern.
      sandbox="allow-scripts allow-modals allow-downloads"
      referrerPolicy="no-referrer"
      // Copy and paste in its panels, as in SillyTavern (the browser may ask before a paste).
      allow="clipboard-read *; clipboard-write *"
      srcDoc={srcdoc}
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100dvh', border: 0, background: 'transparent', colorScheme: 'normal', zIndex: 35, clipPath: clip }}
    />
  );
}

/** Logs a script's request in Recent requests (Settings → Assistant); call the result with how it went. */
export function logScriptRequest(script: TavernScript, entry: Omit<AssistRun, 'id' | 'label' | 'at' | 'text' | 'reasoning' | 'running'>) {
  const id = uuid();
  useAssistLog.getState().add({ ...entry, id, label: `🧩 ${script.name}`, at: Date.now(), text: '', reasoning: '', running: true });
  return (r: { text: string; reasoning: string; error?: string }) => useAssistLog.getState().update(id, { running: false, text: r.text, reasoning: r.reasoning, error: r.error });
}

// ─── Asking first ───────────────────────────────────────────────────────────

/** Says which scripts are waiting for your answer, and asks. */
export function ScriptApprovals({ pending, presetName, cardName }: { pending: Running[]; presetName?: string; cardName: string }) {
  const [open, setOpen] = useState(false);
  if (!pending.length) return null;
  const from = (s: TavernScript) => (s.source === 'preset' ? `the preset "${presetName ?? ''}"` : `${cardName}'s card`);
  const answer = (keys: string[], value: 'run' | 'block') => {
    const s = useLlmStore.getState();
    s.setChatSettings({ scriptApprovals: { ...s.chatSettings.scriptApprovals, ...Object.fromEntries(keys.map((k) => [k, value])) } });
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-violet-700/50 bg-violet-950/40 px-2.5 py-1.5 text-xs text-slate-300">
        <span className="min-w-0 flex-1">
          🧩 {pending.length === 1 ? `A Tavern Helper script (${pending[0].script.name}) from ${from(pending[0].script)} is` : `${pending.length} Tavern Helper scripts are`} waiting to be allowed to run.
        </span>
        <Button size="sm" onClick={() => setOpen(true)}>
          Review…
        </Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Tavern Helper scripts" size="lg">
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-xs text-slate-400">
            Scripts written for SillyTavern&apos;s Tavern Helper extension. Each runs in a sandbox, away from your keys and the rest of UCCB, but once allowed it can read and change this chat (its messages and
            variables), the preset in use and the card&apos;s regex scripts and variables, send messages, ask your chat connection for replies (which costs what a reply costs), show its own buttons and windows over the
            chat, and reach the internet. Only allow scripts you trust. A script that changes asks again.
          </p>
          {pending.map(({ script, key }) => (
            <div key={key} className="flex flex-col gap-1.5 rounded-md border border-slate-700 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-200">{script.name}</span>
                <span className="text-xs text-slate-500">
                  from {from(script)} · {Math.ceil(script.content.length / 1024)} KB
                </span>
                <span className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => answer([key], 'block')}>
                    Don&apos;t run
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => answer([key], 'run')}>
                    Run it
                  </Button>
                </span>
              </div>
              {script.info.trim() && <p className="text-xs whitespace-pre-wrap text-slate-400">{script.info.trim()}</p>}
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-500">Show the code</summary>
                <pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-950/70 p-2 font-mono text-[11px] whitespace-pre-wrap text-slate-300">
                  {script.content.length > 60000 ? `${script.content.slice(0, 60000)}\n… (${Math.ceil(script.content.length / 1024)} KB in all)` : script.content}
                </pre>
              </details>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

/** Scripts' buttons, above the message box (Tavern Helper's script buttons). */
export function ScriptButtons({ buttons, onClick }: { buttons: { key: string; script: TavernScript; name: string }[]; onClick: (key: string, name: string) => void }) {
  if (!buttons.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {buttons.map((b) => (
        <button
          key={`${b.key}:${b.name}`}
          type="button"
          title={`From the script "${b.script.name}"`}
          onClick={() => onClick(b.key, b.name)}
          className="rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-0.5 text-xs text-slate-300 hover:border-violet-500 hover:text-slate-100"
        >
          {b.name}
        </button>
      ))}
    </div>
  );
}
