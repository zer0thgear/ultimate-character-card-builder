'use client';

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useProjectStore } from '@/store/projectStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { cardContext } from '@/lib/assist';
import type { LlmMessage } from '@/types/llm';
import { AutoTextarea, Button, IconButton, cx } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';

// A free-form chat with the writing assistant about the card: ideas,
// names, backstory, "what would she wear to a funeral". It always sees the
// card as it is right now. Kept per card for the session.

const useBrainstorm = create<{ threads: Record<string, LlmMessage[]>; set: (id: string, m: LlmMessage[]) => void }>((set) => ({
  threads: {},
  set: (id, m) => set((s) => ({ threads: { ...s.threads, [id]: m } })),
}));

const SYSTEM = `You are a creative partner helping a creator develop a roleplay character card. You can see the card as it currently is. Brainstorm freely, be specific and concrete, offer options when asked for ideas, and when you write text meant for the card, match its voice and keep {{char}}/{{user}} macros. Be concise unless asked for more.`;

export function BrainstormPanel() {
  const project = useProjectStore((s) => s.project);
  const setNotes = useProjectStore((s) => s.setNotes);
  const { threads, set } = useBrainstorm();
  const { connections, assistConnectionId, setAssistConnection } = useLlmStore();
  const { run, stop, running, text } = useLlmStream();
  const [input, setInput] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const messages = project ? (threads[project.id] ?? []) : [];

  useEffect(() => {
    // Braces matter: scrollIntoView returns a promise in newer browsers,
    // and an effect may only return a cleanup function.
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, text]);
  if (!project) return null;

  const send = async () => {
    const q = input.trim();
    if (!q || running) return;
    const next: LlmMessage[] = [...messages, { role: 'user', content: q }];
    set(project.id, next);
    setInput('');
    const card = useProjectStore.getState().project?.card.data ?? project.card.data;
    const r = await run(connections.find((c) => c.id === assistConnectionId) ?? null, [
      { role: 'system', content: `${SYSTEM}\n\n<card>\n${cardContext(card, undefined, 20000)}\n</card>` },
      ...next,
    ]);
    if (r.text.trim()) set(project.id, [...next, { role: 'assistant', content: r.text.trim() }]);
    if (r.error) toast(r.error, 'error');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 px-2 py-1.5">
        <ConnectionPicker value={assistConnectionId} onChange={setAssistConnection} label="Assistant" className="flex-1" />
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => set(project.id, [])}>
            Clear
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {messages.length === 0 && !running && (
          <div className="flex flex-col gap-2 text-sm text-slate-500">
            <p>Talk the card through with the assistant. It sees the card as it is now.</p>
            {['Give me five ideas for a hidden side to this character', 'What in this card contradicts itself?', 'Suggest three alternate greeting situations', 'What would make the first message more engaging?'].map((s) => (
              <button key={s} type="button" onClick={() => setInput(s)} className="self-start rounded-md bg-slate-900 px-2.5 py-1 text-left text-xs text-slate-300 hover:bg-slate-800">
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div key={i} className={cx('group rounded-lg px-3 py-2 text-sm whitespace-pre-wrap', m.role === 'user' ? 'ml-8 bg-sky-500/10 text-slate-200' : 'mr-4 bg-slate-900 text-slate-300')}>
              {m.content}
              {m.role === 'assistant' && (
                <div className="mt-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                  <IconButton title="Copy" onClick={() => void navigator.clipboard.writeText(m.content)}>
                    ⧉
                  </IconButton>
                  <IconButton
                    title="Add to the card's notes"
                    onClick={() => {
                      const notes = useProjectStore.getState().project?.notes ?? '';
                      setNotes(`${notes.trim()}\n\n${m.content}`.trim());
                      toast('Added to Notes.', 'success');
                    }}
                  >
                    📝
                  </IconButton>
                </div>
              )}
            </div>
          ))}
          {running && <div className="mr-4 rounded-lg bg-slate-900 px-3 py-2 text-sm whitespace-pre-wrap text-slate-300">{text || <span className="animate-pulse">…</span>}</div>}
          <div ref={bottom} />
        </div>
      </div>
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
          maxRows={8}
          placeholder="Ask about the card…"
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
