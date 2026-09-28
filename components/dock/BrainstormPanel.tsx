'use client';
/* eslint-disable @next/next/no-img-element -- thumbnails are data: and blob: URLs, which next/image can't optimise */

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useProjectStore } from '@/store/projectStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { brainstormMessages } from '@/lib/assist';
import type { LlmMessage } from '@/types/llm';
import { AutoTextarea, Button, IconButton, cx, enterSends } from '@/components/ui';
import { AssistReasoning } from '@/components/llm/AssistTrace';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { copyText } from '@/lib/clipboard';
import { ReferenceTray, referenceConnectionId, useReferences } from '@/components/llm/References';
import { attachReferences, hasPictures, type Reference } from '@/lib/references';

// A free-form chat with the writing assistant about the card: ideas,
// names, backstory, "what would she wear to a funeral". It always sees the
// card as it is right now. Kept per card for the session.

/** A message, and for a reply, the assist-log run that wrote it; for
 *  yours, what you attached to it. */
type Thought = LlmMessage & { runId?: string; refs?: Reference[] };

const useBrainstorm = create<{ threads: Record<string, Thought[]>; set: (id: string, m: Thought[]) => void }>((set) => ({
  threads: {},
  set: (id, m) => set((s) => ({ threads: { ...s.threads, [id]: m } })),
}));


export function BrainstormPanel() {
  const project = useProjectStore((s) => s.project);
  const setNotes = useProjectStore((s) => s.setNotes);
  const { threads, set } = useBrainstorm();
  const { assistConnectionId, setAssistConnection } = useLlmStore();
  const { runAssist, runId, stop, running, text } = useLlmStream();
  const [input, setInput] = useState('');
  const attach = useReferences();
  const bottom = useRef<HTMLDivElement>(null);
  const messages = project ? (threads[project.id] ?? []) : [];
  const visionThread = messages.some((m) => hasPictures(m.refs));
  const vision = useLlmStore((s) => s.connections.find((c) => c.id === s.visionConnectionId));

  useEffect(() => {
    // Braces matter: scrollIntoView returns a promise in newer browsers,
    // and an effect may only return a cleanup function.
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, text]);
  if (!project) return null;

  const send = async () => {
    const q = input.trim();
    if (!q || running) return;
    const next: Thought[] = [...messages, { role: 'user', content: q, ...(attach.refs.length ? { refs: attach.refs } : {}) }];
    set(project.id, next);
    setInput('');
    attach.clear();
    const card = useProjectStore.getState().project?.card.data ?? project.card.data;
    // References stay with the message they came with, so later turns
    // still see them (and a thread with pictures keeps to the vision model).
    const r = await runAssist(
      brainstormMessages(card, next.map(({ role, content, refs }) => attachReferences({ role, content }, refs))),
      undefined,
      '✨ Brainstorm',
      { connectionId: referenceConnectionId(next.flatMap((m) => m.refs ?? [])) },
    );
    if (r.text.trim()) set(project.id, [...next, { role: 'assistant', content: r.text.trim(), runId: r.runId }]);
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
      {visionThread && (
        <p className="flex-shrink-0 border-b border-slate-800 px-3 py-1 text-[11px] text-slate-500">
          This thread has pictures in it, so it goes to {vision ? `your vision model (${vision.name})` : 'the assistant model, which needs to see images'}. Clear to start over.
        </p>
      )}
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
              {m.role === 'assistant' && m.runId && <AssistReasoning runId={m.runId} className="mb-1.5 whitespace-normal" />}
              {m.refs?.length ? (
                <div className="mb-1 flex flex-wrap gap-1 whitespace-normal">
                  {m.refs.map((r) => (
                    <span key={r.id} className="flex items-center gap-1 rounded bg-slate-900/60 px-1 py-0.5 text-[11px] text-slate-400">
                      {r.thumb ? <img src={r.thumb} alt="" className="h-4 w-4 rounded object-cover" /> : r.kind === 'card' ? '🪪' : '🖼'}
                      {r.name}
                    </span>
                  ))}
                </div>
              ) : null}
              {m.content}
              {m.role === 'assistant' && (
                <div className="mt-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 touch:opacity-100">
                  <IconButton title="Copy" onClick={() => void copyText(m.content)}>
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
          {running && (
            <div className="mr-4 rounded-lg bg-slate-900 px-3 py-2 text-sm whitespace-pre-wrap text-slate-300">
              <AssistReasoning runId={runId} className="mb-1.5 whitespace-normal" />
              {text || <span className="animate-pulse">…</span>}
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>
      <div className="flex-shrink-0 border-t border-slate-800 p-2">
        <ReferenceTray refs={attach.refs} onAdd={attach.add} onRemove={attach.remove} className="mb-1.5" />
        <AutoTextarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={attach.onPaste}
          onKeyDown={(e) => {
            if (enterSends(e)) {
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
