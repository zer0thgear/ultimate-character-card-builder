'use client';

import { create } from 'zustand';
import { useState, createContext, useContext } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { PHONE_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { useLlmStore } from '@/store/llmStore';
import { getPath, setPath, fieldLabel } from '@/lib/cardPath';
import { FIELD_ACTIONS, fieldActionMessages, type FieldAction } from '@/lib/assist';
import { useLlmStream } from '@/hooks/useLlmStream';
import { AutoTextarea, Button, IconButton, Modal, TextField, TokenBadge, cx, enterSends, inputClass } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { CutOffNotice } from '@/components/llm/CutOffNotice';
import { AssistReasoning } from '@/components/llm/AssistTrace';
import { ReferenceTray, referenceConnectionId, useReferences } from '@/components/llm/References';
import { withReferences } from '@/lib/references';

// Every card text field gets the same two helpers: ✨ the writing
// assistant, and ⤢ a full-screen editor for long fields.

/** A card field by path, as [value, setter]. Quick typing in one field is
 *  one undo step. */
export function useCardField(path: string): [string, (v: string) => void] {
  const value = useProjectStore((s) => (s.project ? getPath(s.project.card.data, path) : ''));
  const updateCard = useProjectStore((s) => s.updateCard);
  return [value, (v: string) => updateCard((d) => setPath(d, path, v), path)];
}

const useFieldTools = create<{ assist: string | null; focus: string | null; open: (kind: 'assist' | 'focus', path: string | null) => void }>((set) => ({
  assist: null,
  focus: null,
  open: (kind, path) => set({ [kind]: path } as { assist: string | null } | { focus: string | null }),
}));

export const openAssist = (path: string) => useFieldTools.getState().open('assist', path);

/** Whether the card panels offer the ✨ writing tools: off where they're
 *  shown for reading and light edits (Chat mode's card drawer). */
export const WritingToolsContext = createContext(true);
export const useWritingTools = () => useContext(WritingToolsContext);

export function FieldActions({ path }: { path: string }) {
  const open = useFieldTools((s) => s.open);
  const writing = useWritingTools();
  return (
    <>
      {writing && (
        <IconButton title="Writing assistant" tone="accent" onClick={() => open('assist', path)}>
          ✨
        </IconButton>
      )}
      <IconButton title="Open in a large editor" onClick={() => open('focus', path)}>
        ⤢
      </IconButton>
    </>
  );
}

/** A TextField bound to a card path, with the field actions. */
export function CardTextField({ path, label, hint, placeholder, minRows, maxRows }: { path: string; label: string; hint?: string; placeholder?: string; minRows?: number; maxRows?: number }) {
  const [value, setValue] = useCardField(path);
  return <TextField label={label} hint={hint} value={value} onChange={setValue} placeholder={placeholder} minRows={minRows} maxRows={maxRows} actions={<FieldActions path={path} />} />;
}

export function FieldToolsHost() {
  const { assist, focus, open } = useFieldTools();
  return (
    <>
      {assist && <AssistDialog path={assist} onClose={() => open('assist', null)} />}
      {focus && <FocusEditor path={focus} onClose={() => open('focus', null)} />}
    </>
  );
}

function FocusEditor({ path, onClose }: { path: string; onClose: () => void }) {
  const [value, setValue] = useCardField(path);
  const label = useProjectStore((s) => (s.project ? fieldLabel(s.project.card.data, path) : path));
  return (
    <Modal open onClose={onClose} title={label} size="full" footer={<><TokenBadge text={value} className="mr-auto self-center" /><Button onClick={onClose}>Done</Button></>}>
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={cx(inputClass, 'h-full min-h-[60vh] resize-none text-[15px] leading-relaxed')}
      />
    </Modal>
  );
}

function AssistDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const card = useProjectStore((s) => s.project?.card.data);
  const updateCard = useProjectStore((s) => s.updateCard);
  const { assistConnectionId, setAssistConnection } = useLlmStore();
  const current = card ? getPath(card, path) : '';
  const [action, setAction] = useState<FieldAction>(current.trim() ? 'rewrite' : 'draft');
  const [instruction, setInstruction] = useState('');
  const [edited, setDraft] = useState('');
  const { runAssist, continueAssist, retryWithMoreRoom, cutOff, runId, stop, text, reasoning, running, error } = useLlmStream();
  const refs = useReferences();
  const draft = running ? text : edited;
  const phone = useMediaQuery(PHONE_QUERY);

  if (!card) return null;
  const label = fieldLabel(card, path);
  const go = async () => {
    const r = await runAssist(withReferences(fieldActionMessages(card, path, action, instruction), refs.refs), undefined, `✨ ${label} (${FIELD_ACTIONS.find((a) => a.value === action)?.label ?? action})`, { connectionId: referenceConnectionId(refs.refs) });
    setDraft(r.text.trim());
  };
  const carryOn = async () => {
    const r = await continueAssist(draft);
    if (r) setDraft(r.text);
  };
  const apply = (mode: 'replace' | 'append') => {
    const next = mode === 'replace' ? draft : current.replace(/\s*$/, '') + (action === 'continue' ? '' : '\n\n') + draft;
    updateCard((d) => setPath(d, path, next));
    onClose();
  };

  return (
    <Modal
      open
      onClose={() => {
        stop();
        onClose();
      }}
      title={`✨ ${label}`}
      size="lg"
      footer={
        <>
          <Button className="mr-auto" variant="ghost" onClick={onClose}>
            Discard
          </Button>
          <Button disabled={!draft || running} onClick={() => apply('append')}>
            Append
          </Button>
          <Button variant="primary" disabled={!draft || running} onClick={() => apply(action === 'continue' ? 'append' : 'replace')}>
            {action === 'continue' ? 'Append' : 'Replace field'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          {FIELD_ACTIONS.map((a) => (
            <button
              key={a.value}
              type="button"
              title={a.hint}
              onClick={() => setAction(a.value)}
              className={cx('rounded-md px-2.5 py-1 text-xs', action === a.value ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="flex items-start gap-2">
          <AutoTextarea
            autoFocus
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onPaste={refs.onPaste}
            onKeyDown={(e) => {
              if (enterSends(e)) {
                e.preventDefault();
                if (!running) void go();
              }
            }}
            minRows={1}
            maxRows={8}
            placeholder={action === 'draft' ? 'What should it cover? (optional)' : 'Instruction (optional), e.g. "more playful", "add her fear of water"'}
            className="flex-1"
          />
          {running ? (
            <Button variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={() => void go()}>
                Run
              </Button>
              {draft.trim() && (
                <Button onClick={() => void carryOn()} title="Carry on writing from the end of the text (edit it first if you like)">
                  → Continue
                </Button>
              )}
            </>
          )}
        </div>
        <ReferenceTray refs={refs.refs} onAdd={refs.add} onRemove={refs.remove} />
        <ConnectionPicker value={assistConnectionId} onChange={setAssistConnection} label="Assistant connection" />
        {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
        <CutOffNotice show={cutOff && !running} hasText={!!draft.trim()} reasoning={reasoning} onUseReasoning={() => setDraft(reasoning.trim())} onRetry={() => void retryWithMoreRoom().then((r) => r && setDraft(r.text.trim()))} />
        <AssistReasoning runId={runId} />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Current</span>
            {/* Its own scroll on a wide screen; full length on a phone, where
                the dialog scrolls instead (a scroll inside a scroll eats the
                finger's). */}
            <div className={cx('min-h-24 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-sm whitespace-pre-wrap text-slate-400', !phone && 'max-h-[50vh] overflow-y-auto')}>
              {current || <em>empty</em>}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-xs text-slate-500">
              Suggested {running && <span className="animate-pulse text-violet-300">writing…</span>}
              {draft && <TokenBadge text={draft} />}
            </span>
            <AutoTextarea value={draft} onChange={(e) => setDraft(e.target.value)} minRows={5} maxRows={22} fullOnPhone placeholder="Run to get a suggestion. You can edit it before applying." />
          </div>
        </div>
      </div>
    </Modal>
  );
}
