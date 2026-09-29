'use client';

import { useState } from 'react';
import { create } from 'zustand';
import { useProjectStore } from '@/store/projectStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { visionMessages, type VisionJob } from '@/lib/assist';
import { imageForVision } from '@/lib/visionImage';
import { copyText } from '@/lib/clipboard';
import { AutoTextarea, Button, Modal, TokenBadge, confirmDialog, cx, enterSends } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { AssistReasoning } from '@/components/llm/AssistTrace';

// ✨ Write from an image: a vision model looks at a gen (or a kept or
// library image) and writes the character's physical description, a
// greeting set in the pictured moment, or an answer to a question, with
// your guidance. It has its own connection, since the usual assistant (a
// NovelAI text model, say) may not see images.

const useVisionWrite = create<{ image: { blob: Blob; url: string } | null }>(() => ({ image: null }));

/** Opens the dialog on a picture (with a card open). */
export function openVisionWrite(blob: Blob) {
  const prev = useVisionWrite.getState().image;
  if (prev) URL.revokeObjectURL(prev.url);
  useVisionWrite.setState({ image: { blob, url: URL.createObjectURL(blob) } });
}

function closeVisionWrite() {
  const prev = useVisionWrite.getState().image;
  if (prev) URL.revokeObjectURL(prev.url);
  useVisionWrite.setState({ image: null });
}

/** Mounted once (Shell). */
export function VisionWriteHost() {
  const image = useVisionWrite((s) => s.image);
  const hasCard = useProjectStore((s) => !!s.project);
  if (!image || !hasCard) return null;
  return <VisionWriteDialog key={image.url} blob={image.blob} url={image.url} />;
}

const JOBS: { value: VisionJob; label: string; hint: string; placeholder: string }[] = [
  { value: 'appearance', label: '👤 Physical description', hint: 'How the character looks in it, for the description', placeholder: 'Guidance (optional), e.g. "focus on the outfit", "two short paragraphs"' },
  { value: 'greeting', label: '💬 Greeting from the scene', hint: 'A new greeting that opens on this moment', placeholder: 'Guidance (optional), e.g. "she has just noticed {{user}}"' },
  { value: 'ask', label: '❓ Ask about it', hint: 'Anything: a name, a backstory idea, what fits the card', placeholder: 'Your question, e.g. "suggest three names that fit this look"' },
];

function VisionWriteDialog({ blob, url }: { blob: Blob; url: string }) {
  const card = useProjectStore((s) => s.project?.card.data);
  const updateCard = useProjectStore((s) => s.updateCard);
  const setNotes = useProjectStore((s) => s.setNotes);
  const { connections, assistConnectionId, visionConnectionId, setVisionConnection } = useLlmStore();
  const connectionId = visionConnectionId ?? assistConnectionId;
  const connection = connections.find((c) => c.id === connectionId);
  const [job, setJob] = useState<VisionJob>('appearance');
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const { runAssist, runId, stop, text, running, error } = useLlmStream();
  if (!card) return null;
  const shown = draft ?? text;
  const blind = connection?.kind === 'novelai';
  const needsQuestion = job === 'ask' && !instruction.trim();

  const go = async () => {
    setDraft(null);
    let image;
    try {
      image = await imageForVision(blob);
    } catch {
      return toast("Couldn't read that picture.", 'error');
    }
    const label = `✨ From an image: ${JOBS.find((j) => j.value === job)?.label.replace(/^\S+\s/, '').toLowerCase()}`;
    const r = await runAssist(visionMessages(card, job, instruction, [image]), undefined, label, { connectionId });
    setDraft(r.text.trim());
  };

  const close = () => {
    stop();
    closeVisionWrite();
  };
  const done = (message: string) => {
    toast(message, 'success');
    closeVisionWrite();
  };

  const actions =
    job === 'appearance' ? (
      <>
        <Button
          disabled={!shown || running}
          onClick={async () => {
            if (card.description.trim() && !(await confirmDialog({ title: 'Replace the description?', body: 'The whole description is replaced with this. Append keeps what is there.', confirmLabel: 'Replace', danger: true }))) return;
            updateCard((d) => ({ ...d, description: shown }), 'description');
            done('Description replaced.');
          }}
        >
          Replace description
        </Button>
        <Button
          variant="primary"
          disabled={!shown || running}
          onClick={() => {
            updateCard((d) => ({ ...d, description: d.description.trim() ? `${d.description.replace(/\s*$/, '')}\n\n${shown}` : shown }), 'description');
            done('Added to the description.');
          }}
        >
          Append to description
        </Button>
      </>
    ) : job === 'greeting' ? (
      <>
        {!card.first_mes.trim() && (
          <Button
            disabled={!shown || running}
            onClick={() => {
              updateCard((d) => ({ ...d, first_mes: shown }), 'first_mes');
              done('Set as the first message.');
            }}
          >
            Use as first message
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!shown || running}
          onClick={() => {
            updateCard((d) => ({ ...d, alternate_greetings: [...d.alternate_greetings, shown] }));
            done(`Added as greeting #${card.alternate_greetings.length + 1}.`);
          }}
        >
          Add as greeting #{card.alternate_greetings.length + 1}
        </Button>
      </>
    ) : (
      <>
        <Button disabled={!shown} onClick={() => void copyText(shown).then(() => toast('Copied.', 'success'))}>
          Copy
        </Button>
        <Button
          variant="primary"
          disabled={!shown || running}
          onClick={() => {
            const notes = useProjectStore.getState().project?.notes ?? '';
            setNotes(`${notes.trim()}\n\n${shown}`.trim());
            done('Added to Notes.');
          }}
        >
          Add to notes
        </Button>
      </>
    );

  return (
    <Modal
      open
      onClose={close}
      title="✨ Write from this image"
      size="xl"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={close}>
            Close
          </Button>
          {actions}
        </>
      }
    >
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="checker flex flex-shrink-0 items-center justify-center self-start rounded-md md:w-56">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="max-h-72 rounded-md object-contain md:max-h-[60vh]" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-1">
            {JOBS.map((j) => (
              <button
                key={j.value}
                type="button"
                title={j.hint}
                onClick={() => setJob(j.value)}
                className={cx('rounded-md px-2.5 py-1 text-xs', job === j.value ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}
              >
                {j.label}
              </button>
            ))}
          </div>
          <div className="flex items-start gap-2">
            <AutoTextarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
              if (enterSends(e)) {
                e.preventDefault();
                if (!running && !blind && !needsQuestion) void go();
              }
            }}
              minRows={1}
              maxRows={8}
              placeholder={JOBS.find((j) => j.value === job)?.placeholder}
              className="flex-1"
            />
            {running ? (
              <Button variant="danger" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button variant="primary" disabled={blind || needsQuestion} onClick={() => void go()} title={needsQuestion ? 'Type your question first' : undefined}>
                {shown ? 'Again' : 'Write'}
              </Button>
            )}
          </div>
          <ConnectionPicker value={connectionId} onChange={setVisionConnection} label="Vision model" />
          {blind ? (
            <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              NovelAI&apos;s text models can&apos;t see images. Pick a connection with a vision model: Claude, or an OpenAI-compatible one (OpenRouter and the like) with GPT-4o or later, Gemini, Qwen-VL, Llama 3.2 Vision…
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">Needs a model that can see images. One that can&apos;t usually refuses the request (you&apos;ll see why here), though a few servers quietly ignore the picture and guess.</p>
          )}
          {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
          <AssistReasoning runId={runId} />
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{running ? <span className="animate-pulse text-violet-300">writing…</span> : 'Result'}</span>
            {shown && <TokenBadge text={shown} />}
          </div>
          <AutoTextarea value={shown} onChange={(e) => setDraft(e.target.value)} minRows={8} maxRows={24} placeholder="What it writes appears here. You can edit it before using it." />
        </div>
      </div>
    </Modal>
  );
}
