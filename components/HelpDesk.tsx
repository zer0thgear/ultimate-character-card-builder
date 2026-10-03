'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLlmStore } from '@/store/llmStore';
import { useHelperStore } from '@/store/helperStore';
import { toast } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { api } from '@/lib/api';
import { CUSTOM_PERSONALITY, HELPER_PERSONALITIES, helperMessages, personalityById, type HelpDocs } from '@/lib/helpDesk';
import { AutoTextarea, Button, IconButton, cx, enterSends, inputClass } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { copyText } from '@/lib/clipboard';

// The home screen's helper: ask it how UCCB works, in the voice of your
// choice. It answers from the app's own docs (lib/helpDesk.ts).

let docsOnce: Promise<HelpDocs> | null = null;
const loadDocs = () => (docsOnce ??= api.helpDocs().catch((err) => ((docsOnce = null), Promise.reject(err))));

const SUGGESTIONS = [
  'Which macros can I use?',
  'What does the ✨ button on a field do?',
  'How do I set up an LLM connection?',
  'How do I import a card from Chub?',
  'Can I use my SillyTavern presets?',
  'How do lorebook entries get triggered?',
];

/** **bold**, *italics* and `code`, the Markdown the helper's replies lean on. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g);
  return (
    <>
      {parts.map((p, i): ReactNode => {
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={i} className="font-semibold text-slate-100">{p.slice(2, -2)}</strong>;
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={i} className="rounded bg-slate-800 px-1 text-[0.9em]">{p.slice(1, -1)}</code>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

export function HelpDesk() {
  const { personality, setPersonality, custom, setCustom, connectionId, setConnectionId, messages, setMessages } = useHelperStore();
  const connections = useLlmStore((s) => s.connections);
  const fallbackId = useLlmStore((s) => s.assistConnectionId ?? s.chatConnectionId);
  const { run, stop, running, text, reasoning } = useLlmStream();
  const [input, setInput] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const preset = personalityById(personality);
  const isCustom = personality === CUSTOM_PERSONALITY;
  const usedId = [connectionId, fallbackId].find((id) => id && connections.some((c) => c.id === id)) ?? connections[0]?.id ?? null;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, text]);

  const send = async (asked = input) => {
    const q = asked.trim();
    if (!q || running) return;
    const next = [...messages, { role: 'user' as const, content: q }];
    setMessages(next);
    setInput('');
    let docs: HelpDocs;
    try {
      docs = await loadDocs();
    } catch (err) {
      toast(`Couldn't read the app's docs: ${(err as Error).message}`, 'error');
      return;
    }
    const voice = isCustom ? custom : (preset ?? HELPER_PERSONALITIES[0]).prompt;
    const connection = connections.find((c) => c.id === usedId) ?? null;
    const r = await run(connection, helperMessages(docs, next, voice));
    if (r.text.trim()) setMessages([...next, { role: 'assistant', content: r.text.trim() }]);
    if (r.error) toast(r.error, 'error');
  };

  const greeting = isCustom ? (custom.trim() ? "(Your own helper. Say hello, or ask away.)" : 'Describe the personality you want above, then ask away.') : preset?.greeting;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-shrink-0 flex-col gap-1.5 border-b border-slate-800 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Personality
            <select value={personality} onChange={(e) => setPersonality(e.target.value)} className={cx(inputClass, 'w-auto py-1 text-xs')}>
              {HELPER_PERSONALITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value={CUSTOM_PERSONALITY}>Your own…</option>
            </select>
          </label>
          <ConnectionPicker value={usedId} onChange={(id) => setConnectionId(id)} label="Connection" className="min-w-48 flex-1" />
          {messages.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setMessages([])} disabled={running}>
              Clear
            </Button>
          )}
        </div>
        {isCustom ? (
          <AutoTextarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            minRows={2}
            maxRows={6}
            placeholder="How it talks, e.g. “A grumpy pirate who calls every card a treasure map and every button a cannon.”"
          />
        ) : (
          preset && <p className="text-[11px] text-slate-500">{preset.blurb} The answers come from UCCB&apos;s own guide.</p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
          {greeting && (
            <div className="mr-8 rounded-lg bg-slate-900 px-3 py-2 text-sm whitespace-pre-wrap text-slate-300">
              {greeting}
            </div>
          )}
          {messages.length === 0 && !running && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-md bg-slate-900 px-2.5 py-1 text-left text-xs text-slate-300 hover:bg-slate-800">
                  {s}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cx('group rounded-lg px-3 py-2 text-sm whitespace-pre-wrap', m.role === 'user' ? 'ml-8 bg-sky-500/10 text-slate-200' : 'mr-8 bg-slate-900 text-slate-300')}>
              <Rich text={m.content} />
              {m.role === 'assistant' && (
                <div className="mt-1 flex justify-end opacity-0 group-hover:opacity-100 touch:opacity-100">
                  <IconButton title="Copy" onClick={() => void copyText(m.content)}>
                    ⧉
                  </IconButton>
                </div>
              )}
            </div>
          ))}
          {running && (
            <div className="mr-8 rounded-lg bg-slate-900 px-3 py-2 text-sm whitespace-pre-wrap text-slate-300">
              {text ? <Rich text={text} /> : <span className="animate-pulse text-slate-500">{reasoning ? 'Thinking…' : '…'}</span>}
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl flex-shrink-0 border-t border-slate-800 p-2">
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
          maxRows={8}
          placeholder="Ask how something in UCCB works…"
        />
        <div className="mt-1.5 flex justify-end">
          {running ? (
            <Button size="sm" variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" disabled={!input.trim()} onClick={() => void send()}>
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
