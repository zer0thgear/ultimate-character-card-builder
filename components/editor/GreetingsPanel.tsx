'use client';

import { useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useBridgeStore } from '@/store/bridgeStore';
import { useLlmStore } from '@/store/llmStore';
import { SortableList, arrayMove, remapIndex } from '@/components/SortableList';
import { FieldActions, useCardField } from '@/components/editor/fieldTools';
import { AutoTextarea, Button, IconButton, Modal, TokenBadge, confirmDialog, Section, Empty, enterSends } from '@/components/ui';
import { useLlmStream } from '@/hooks/useLlmStream';
import { newGreetingMessages } from '@/lib/assist';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { CutOffNotice } from '@/components/llm/CutOffNotice';
import { AssistReasoning } from '@/components/llm/AssistTrace';
import { ReferenceTray, referenceConnectionId, useReferences } from '@/components/llm/References';
import { withReferences } from '@/lib/references';

// First message, alternate greetings and group-only greetings, with
// reordering and promoting, plus test-chat and illustrate shortcuts per
// greeting.

type ListKey = 'alternate_greetings' | 'group_only_greetings';

const preview = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 110) || 'Empty';

export function GreetingsPanel() {
  const alts = useProjectStore((s) => s.project?.card.data.alternate_greetings ?? []);
  const groups = useProjectStore((s) => s.project?.card.data.group_only_greetings ?? []);
  const [generating, setGenerating] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <FirstMessage />
      <GreetingList
        listKey="alternate_greetings"
        title={`Alternate greetings (${alts.length})`}
        items={alts}
        extraActions={
          <Button size="sm" onClick={() => setGenerating(true)} title="Write a new alternate greeting with the assistant">
            ✨ New
          </Button>
        }
      />
      <GreetingList listKey="group_only_greetings" title={`Group-only greetings (${groups.length})`} items={groups} />
      {generating && <NewGreetingDialog onClose={() => setGenerating(false)} />}
    </div>
  );
}

function GreetingButtons({ index, text }: { index: number; text: string }) {
  const startChat = useBridgeStore((s) => s.startChat);
  const illustrate = useBridgeStore((s) => s.requestIllustration);
  return (
    <>
      {index >= 0 && (
        <IconButton title="Start a test chat with this greeting" onClick={() => startChat(index)}>
          💬
        </IconButton>
      )}
      <IconButton title="Illustrate: turn this scene into an image prompt" disabled={!text.trim()} onClick={() => illustrate(text)}>
        🎨
      </IconButton>
    </>
  );
}

function FirstMessage() {
  const [value, setValue] = useCardField('first_mes');
  return (
    <Section
      title="First message"
      actions={
        <>
          <TokenBadge text={value} className="mr-1" />
          <GreetingButtons index={0} text={value} />
          <FieldActions path="first_mes" />
        </>
      }
    >
      <AutoTextarea value={value} onChange={(e) => setValue(e.target.value)} minRows={8} maxRows={30} placeholder="The opening message, written as {{char}}." />
    </Section>
  );
}

function GreetingList({ listKey, title, items, extraActions }: { listKey: ListKey; title: string; items: string[]; extraActions?: React.ReactNode }) {
  const updateCard = useProjectStore((s) => s.updateCard);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const isAlt = listKey === 'alternate_greetings';

  const setItems = (next: string[]) => updateCard((d) => ({ ...d, [listKey]: next }));
  const toggle = (i: number) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    return n;
  });
  const add = () => {
    setItems([...items, '']);
    setOpen((s) => new Set(s).add(items.length));
  };
  const move = (from: number, to: number) => {
    setItems(arrayMove(items, from, to));
    setOpen((s) => new Set([...s].map((i) => remapIndex(i, from, to))));
  };
  const remove = async (i: number) => {
    if (items[i].trim() && !(await confirmDialog({ title: `Delete ${isAlt ? 'alternate' : 'group'} greeting #${i + 1}?`, body: 'You can undo this with Ctrl+Z (outside a text box) or the undo button.', confirmLabel: 'Delete', danger: true }))) return;
    setItems(items.filter((_, j) => j !== i));
    setOpen((s) => new Set([...s].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
  };
  const duplicate = (i: number) => {
    setItems([...items.slice(0, i + 1), items[i], ...items.slice(i + 1)]);
    setOpen((s) => new Set([...s].map((j) => (j > i ? j + 1 : j))).add(i + 1));
  };
  const promote = async (i: number) => {
    if (!(await confirmDialog({ title: `Make alternate greeting #${i + 1} the first message?`, body: 'The current first message becomes alternate greeting #1.', confirmLabel: 'Swap' }))) return;
    updateCard((d) => {
      const rest = d.alternate_greetings.filter((_, j) => j !== i);
      return { ...d, first_mes: d.alternate_greetings[i], alternate_greetings: d.first_mes.trim() ? [d.first_mes, ...rest] : rest };
    });
    setOpen(new Set());
  };

  return (
    <Section
      title={title}
      actions={
        <>
          {items.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(open.size ? new Set() : new Set(items.map((_, i) => i)))}>
              {open.size ? 'Fold all' : 'Unfold all'}
            </Button>
          )}
          {extraActions}
          <Button size="sm" onClick={add}>
            + Add
          </Button>
        </>
      }
    >
      {items.length === 0 ? (
        <Empty>{isAlt ? 'No alternate greetings yet.' : 'Group-only greetings are used instead of the others when the character is in a group chat.'}</Empty>
      ) : (
        <SortableList count={items.length} onMove={move}>
          {(i, handle) => (
            <div className="rounded-md border border-slate-800 bg-slate-900/60">
              <div className="flex items-center gap-1 px-1 py-1">
                {handle}
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggle(i)}>
                  <span className="text-xs text-slate-500">{open.has(i) ? '▾' : '▸'}</span>
                  <span className="text-xs font-semibold text-slate-300">#{i + 1}</span>
                  {!open.has(i) && <span className="min-w-0 truncate text-xs text-slate-500">{preview(items[i])}</span>}
                </button>
                <TokenBadge text={items[i]} className="mx-1" />
                <span className="flex items-center phone:hidden">
                  <GreetingButtons index={isAlt ? i + 1 : -1} text={items[i]} />
                    {isAlt && (
                      <IconButton title="Make this the first message" onClick={() => void promote(i)}>
                        ⇈
                      </IconButton>
                    )}
                    <IconButton title="Duplicate" onClick={() => duplicate(i)}>
                      ⧉
                    </IconButton>
                    <FieldActions path={`${listKey}.${i}`} />
                </span>
                <IconButton title="Delete" tone="danger" onClick={() => void remove(i)}>
                  🗑
                </IconButton>
              </div>
              {open.has(i) && (
                <div className="px-2 pb-2">
                  <div className="mb-1.5 hidden flex-wrap items-center gap-0.5 phone:flex">
                    <GreetingButtons index={isAlt ? i + 1 : -1} text={items[i]} />
                    {isAlt && (
                      <IconButton title="Make this the first message" onClick={() => void promote(i)}>
                        ⇈
                      </IconButton>
                    )}
                    <IconButton title="Duplicate" onClick={() => duplicate(i)}>
                      ⧉
                    </IconButton>
                    <FieldActions path={`${listKey}.${i}`} />
                  </div>
                  <GreetingText path={`${listKey}.${i}`} />
                </div>
              )}
            </div>
          )}
        </SortableList>
      )}
    </Section>
  );
}

function GreetingText({ path }: { path: string }) {
  const [value, setValue] = useCardField(path);
  return <AutoTextarea autoFocus={!value} value={value} onChange={(e) => setValue(e.target.value)} minRows={6} maxRows={30} />;
}

function NewGreetingDialog({ onClose }: { onClose: () => void }) {
  const card = useProjectStore((s) => s.project?.card.data);
  const updateCard = useProjectStore((s) => s.updateCard);
  const { assistConnectionId, setAssistConnection } = useLlmStore();
  const [instruction, setInstruction] = useState('');
  const { runAssist, continueAssist, retryWithMoreRoom, cutOff, runId, stop, text, reasoning, running, error } = useLlmStream();
  const [draft, setDraft] = useState<string | null>(null);
  const refs = useReferences();
  if (!card) return null;
  const go = async () => {
    setDraft(null);
    const r = await runAssist(withReferences(newGreetingMessages(card, instruction), refs.refs), undefined, '✨ New greeting', { connectionId: referenceConnectionId(refs.refs) });
    setDraft(r.text.trim());
  };
  const shown = draft ?? text;
  const carryOn = async () => {
    const from = shown;
    setDraft(null);
    const r = await continueAssist(from);
    setDraft(r ? r.text : from);
  };
  return (
    <Modal
      open
      onClose={() => {
        stop();
        onClose();
      }}
      title="✨ New alternate greeting"
      size="lg"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            disabled={!shown || running}
            onClick={() => {
              updateCard((d) => ({ ...d, alternate_greetings: [...d.alternate_greetings, shown] }));
              onClose();
            }}
          >
            Add as greeting #{card.alternate_greetings.length + 1}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
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
            placeholder='The situation, e.g. "they meet at a rainy bus stop" (optional)'
            className="flex-1"
          />
          {running ? (
            <Button variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={() => void go()}>
                {shown ? 'Again' : 'Write'}
              </Button>
              {shown.trim() && (
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
        <CutOffNotice show={cutOff && !running} hasText={!!shown.trim()} reasoning={reasoning} onUseReasoning={() => setDraft(reasoning.trim())} onRetry={() => { setDraft(null); void retryWithMoreRoom().then((r) => setDraft(r ? r.text.trim() : null)); }} />
        <AssistReasoning runId={runId} />
        <AutoTextarea value={shown} onChange={(e) => setDraft(e.target.value)} minRows={10} maxRows={28} placeholder="The new greeting appears here. You can edit it before adding." />
      </div>
    </Modal>
  );
}
