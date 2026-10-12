'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { CardData } from '@/types/card';
import type { ChatMessage, ChatSession } from '@/types/project';
import type { ChatPreset } from '@/lib/stPreset';
import { chatGreeting, newMessage, type ChatPromptSettings } from '@/lib/chatPrompt';
import {
  cardScripts,
  fromThPreset,
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
import { useProjectStore } from '@/store/projectStore';
import { toast } from '@/store/uiStore';
import { useAssistLog, type AssistRun } from '@/store/assistLog';
import { uuid } from '@/lib/uuid';
import { Button, Modal } from '@/components/ui';

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

export function useTavernScripts({
  card,
  chat,
  preset,
  settings,
  userName,
  actions,
}: {
  card: CardData | null;
  chat: ChatSession | null;
  /** The preset in use (null when none is, or a text-completion connection leaves it out). */
  preset: ChatPreset | null;
  settings: ChatPromptSettings;
  userName: string;
  /** Set by the chat once it's rendered (its actions need what it builds). */
  actions: RefObject<ScriptActions | null>;
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
    () => ({ names, presetName: preset?.name ?? '', presetNames: presetNames ? presetNames.split('\u0000') : [], cardRegexOn: settings.useCardRegex !== false }),
    [names, preset?.name, presetNames, settings.useCardRegex],
  );
  const scriptVars = settings.thScriptVars;
  const snapshot = (script: TavernScript) => ({ chat: chatPart, preset: presetPart, regexes: regexPart, vars: { ...varsPart, script: scriptVars?.[script.id] ?? {} }, ...misc });
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
  useEffect(() => postAll({ state: { preset: presetPart, regexes: regexPart, ...misc } }), [presetPart, regexPart, misc]); // eslint-disable-line react-hooks/exhaustive-deps
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

  /** The prompt as it's about to be sent, with the scripts' injections put
   *  in, then gone over by each script listening for it (Tavern Helper's
   *  CHAT_COMPLETION_PROMPT_READY), in turn. */
  const beforeSend = async <T extends { role: string; content: unknown }>(messages: T[]): Promise<T[]> => {
    if (!latest.current.running.length) return messages;
    const list = [...injections.current.values()];
    for (const [k, i] of injections.current) if (i.once) injections.current.delete(k);
    let out = withInjections(messages, list, (i) => ({ role: i.role, content: i.content }) as unknown as T);
    for (const r of latest.current.running) {
      const id = ++ackSeq.current;
      const answer = await Promise.race([
        new Promise<unknown>((resolve) => {
          acks.current.set(id, resolve);
          post(r.key, { event: 'chat_completion_prompt_ready', args: [{ chat: out, dryRun: false }], ack: id });
        }),
        new Promise<unknown>((resolve) => setTimeout(() => resolve(undefined), PROMPT_WAIT_MS)),
      ]);
      acks.current.delete(id);
      const changed = record(answer).chat;
      if (Array.isArray(changed)) out = changed.filter((m): m is T => isObject(m) && typeof m.role === 'string');
    }
    return out;
  };

  const setGenerating = (on: boolean) => {
    generating.current = on;
    postAll({ state: { busy: on } });
  };

  // The frames themselves, once the runtime's text is here.
  const runtime = useRuntime(running.length > 0);
  const frameNodes = (
    <div aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      {runtime !== null &&
        running.map((r) => (
        <ScriptFrame
          key={`${r.key}:${reloads[r.key] ?? 0}`}
          script={r.script}
          boot={{ scriptId: r.script.id, scriptName: r.script.name, scriptInfo: r.script.info, buttons: r.script.buttons, state: snapshot(r.script) }}
          runtime={runtime}
          onFrame={(f) => (f ? frames.set(r.key, f) : frames.delete(r.key))}
        />
        ))}
    </div>
  );

  const shownButtons = running.flatMap((r) => (buttons[r.key] ?? r.script.buttons).filter((b) => b.visible).map((b) => ({ key: r.key, script: r.script, name: b.name })));
  const clickButton = (key: string, name: string) => post(key, { event: name, args: [] });

  return { all, running, pending, frames: frameNodes, buttons: shownButtons, clickButton, emit, beforeSend, setGenerating, messageNumber };
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

function ScriptFrame({ script, boot, runtime, onFrame }: { script: TavernScript; boot: Record<string, unknown>; runtime: string; onFrame: (f: HTMLIFrameElement | null) => void }) {
  // Built once: later changes go to the script as messages.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const srcdoc = useMemo(() => scriptSrcdoc(script, boot, runtime), []);
  return <iframe ref={onFrame} title={`Script: ${script.name}`} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" srcDoc={srcdoc} style={{ width: 0, height: 0, border: 0 }} />;
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
            variables), the preset in use and the card&apos;s regex scripts and variables, send messages, ask your chat connection for replies (which costs what a reply costs), and reach the internet. Only
            allow scripts you trust. A script that changes asks again.
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
