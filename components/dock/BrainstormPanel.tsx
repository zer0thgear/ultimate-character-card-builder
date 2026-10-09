'use client';
/* eslint-disable @next/next/no-img-element -- thumbnails are data: and blob: URLs, which next/image can't optimise */

import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useBrainstormStore } from '@/store/brainstormStore';
import { useUiStore } from '@/store/uiStore';
import type { BrainstormThought } from '@/types/project';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { brainstormMessages } from '@/lib/assist';
import type { LlmMessage } from '@/types/llm';
import { AutoTextarea, Button, IconButton, Toggle, confirmDialog, cx, enterSends, inputClass, textDialog } from '@/components/ui';
import { AssistReasoning } from '@/components/llm/AssistTrace';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { copyText } from '@/lib/clipboard';
import { ReferenceTray, referenceConnectionId, useReferences } from '@/components/llm/References';
import { attachReferences, hasPictures, type Reference } from '@/lib/references';
import { usePackStore } from '@/store/packStore';
import { SandboxFrame } from '@/components/extensions/SandboxFrame';

// A free-form chat with the writing assistant about the card: ideas,
// names, backstory, "what would she wear to a funeral". It always sees the
// card as it is right now. Each conversation is saved with the card, to
// come back to (store/brainstormStore.ts). Extension packs
// can add wizards here (their `brainstormWizard` UI), which take the
// panel's place while open.

/** A message, and for a reply, the assist-log run that wrote it; for
 *  yours, what you attached to it. */
type Thought = LlmMessage & { runId?: string; refs?: Reference[] };



export function BrainstormPanel() {
  const project = useProjectStore((s) => s.project);
  const setNotes = useProjectStore((s) => s.setNotes);
  const { session, list, loadFor, open, start, rename, remove, setMessages } = useBrainstormStore();
  const { brainstormLorebook, setBrainstormLorebook } = useUiStore();
  const { assistConnectionId, setAssistConnection } = useLlmStore();
  const { runAssist, runId, stop, running, text } = useLlmStream();
  const [input, setInput] = useState('');
  const attach = useReferences();
  const bottom = useRef<HTMLDivElement>(null);
  const messages = (session?.messages ?? []) as Thought[];
  const projectId = project?.id;
  useEffect(() => {
    if (projectId) void loadFor(projectId);
  }, [projectId, loadFor]);
  const visionThread = messages.some((m) => hasPictures(m.refs));
  const vision = useLlmStore((s) => s.connections.find((c) => c.id === s.visionConnectionId));
  const wizards = usePackStore((s) => s.layer.ui).filter((u) => u.slot === 'brainstormWizard');
  // The wizard showing (pack.ui ids), and every one opened so far: those
  // stay mounted, hidden, so going back to the chat doesn't lose their place.
  const [wizardKey, setWizardKey] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const keyOf = (u: { packId: string; id: string }) => `${u.packId}.${u.id}`;
  const wizard = wizards.find((u) => keyOf(u) === wizardKey);
  const openWizard = (key: string) => {
    setWizardKey(key);
    setOpened((o) => (o.includes(key) ? o : [...o, key]));
  };

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
    setMessages(next as BrainstormThought[]);
    // The reply goes to this session, even if another is opened meanwhile.
    const sid = useBrainstormStore.getState().session?.id;
    setInput('');
    attach.clear();
    const card = useProjectStore.getState().project?.card.data ?? project.card.data;
    // References stay with the message they came with, so later turns
    // still see them (and a thread with pictures keeps to the vision model).
    const r = await runAssist(
      brainstormMessages(card, next.map(({ role, content, refs }) => attachReferences({ role, content }, refs)), { lorebook: brainstormLorebook }),
      undefined,
      '✨ Brainstorm',
      { connectionId: referenceConnectionId(next.flatMap((m) => m.refs ?? [])) },
    );
    if (r.text.trim()) {
      const reply: Thought[] = [...next, { role: 'assistant', content: r.text.trim(), runId: r.runId }];
      if (useBrainstormStore.getState().session?.id === sid) setMessages(reply as BrainstormThought[]);
      else toast('The reply came after you switched sessions, so it was left out.', 'info');
    }
    if (r.error) toast(r.error, 'error');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 px-2 py-1.5">
        {wizard ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setWizardKey(null)} title="Back to the Brainstorm chat (the wizard keeps its place)">
              ← Brainstorm
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm text-slate-300" title={`From the ${wizard.packName} extension`}>
              {wizard.icon ?? '🧙'} {wizard.label}
            </span>
          </>
        ) : (
          <>
            <ConnectionPicker value={assistConnectionId} onChange={setAssistConnection} label="Assistant" className="flex-1" />
            {wizards.map((u) => (
              <Button key={keyOf(u)} size="sm" onClick={() => openWizard(keyOf(u))} title={`${u.label} (from the ${u.packName} extension)`}>
                {u.icon ?? '🧙'} {u.label}
              </Button>
            ))}
          </>
        )}
      </div>
      {!wizard && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-800 px-2 py-1.5">
          <select
            value={session?.id ?? ''}
            onChange={(e) => (e.target.value ? void open(e.target.value) : start())}
            disabled={running}
            className={cx(inputClass, 'h-7 min-w-0 flex-1 py-0 text-xs')}
            title="Your saved Brainstorm sessions for this card"
          >
            {!session && <option value="">New session</option>}
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.messageCount}
              </option>
            ))}
          </select>
          {session && (
            <>
              <IconButton
                title="Rename this session"
                onClick={async () => {
                  const name = await textDialog({ title: 'Rename this session', label: 'Name', initial: session.name, confirmLabel: 'Rename' });
                  if (name?.trim()) rename(name);
                }}
              >
                ✎
              </IconButton>
              <IconButton
                title="Delete this session"
                tone="danger"
                disabled={running}
                onClick={async () => {
                  if (await confirmDialog({ title: `Delete "${session.name}"?`, body: 'This Brainstorm session is deleted for good.', confirmLabel: 'Delete', danger: true })) await remove(session.id);
                }}
              >
                🗑
              </IconButton>
              <Button size="sm" variant="ghost" disabled={running} onClick={start} title="Start a new session (this one stays saved)">
                + New
              </Button>
            </>
          )}
          <Toggle
            checked={brainstormLorebook}
            onChange={setBrainstormLorebook}
            label={<span className="text-xs" title="Send the card's whole lorebook with every message. Off: only entries you attach with 📎 (From this card), which saves tokens">📖 Lorebook</span>}
          />
        </div>
      )}
      {wizards
        .filter((u) => opened.includes(keyOf(u)))
        .map((u) => (
          <div key={keyOf(u)} className="min-h-0 flex-1" hidden={keyOf(u) !== wizardKey}>
            <SandboxFrame ui={u} fill />
          </div>
        ))}
      <div className={cx('flex min-h-0 flex-1 flex-col', wizard && 'hidden')}>
        {visionThread && (
          <p className="flex-shrink-0 border-b border-slate-800 px-3 py-1 text-[11px] text-slate-500">
            This session has pictures in it, so it goes to {vision ? `your vision model (${vision.name})` : 'the assistant model, which needs to see images'}. Start a new one to switch back.
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
                        {r.thumb ? <img src={r.thumb} alt="" className="h-4 w-4 rounded object-cover" /> : r.kind === 'card' ? '🪪' : r.kind === 'text' ? '📄' : '🖼'}
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
    </div>
  );
}
