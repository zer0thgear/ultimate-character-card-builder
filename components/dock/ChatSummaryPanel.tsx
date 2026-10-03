'use client';

import { useRef, useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { messageText, type BuildOptions, type BuiltPrompt } from '@/lib/chatPrompt';
import { DEFAULT_SUMMARY_SETTINGS, newSinceSummary, summaryDue, summaryInstruction, summarySettings, type SummaryPosition, type SummarySettings } from '@/lib/chatSummary';
import type { LlmConnection, SamplerParams } from '@/types/llm';
import type { ChatMessage } from '@/types/project';
import { AutoTextarea, Button, IconButton, NumberInput, Select, TokenBadge, cx, inputClass } from '@/components/ui';

// 📜 The chat's summary: written by the model on request, or on its own
// every so many messages, and sent with every prompt after.

export interface SummaryRequest {
  /** The chat's prompt for these messages (as ChatPanel builds it). */
  build: (messages: ChatMessage[], opts?: BuildOptions) => BuiltPrompt;
  connection: LlmConnection | null;
  params: Partial<SamplerParams>;
}

/** Writes the open chat's summary, with its own stream beside the chat's. */
export function useChatSummary() {
  const { run, stop, running, text } = useLlmStream();
  const busy = useRef(false);
  const stopped = useRef(false);

  const summarize = async ({ build, connection, params }: SummaryRequest) => {
    const chat = useChatStore.getState().chat;
    if (!chat || busy.current) return;
    const messages = chat.messages;
    const last = messages[messages.length - 1];
    if (!last) return toast('Nothing to summarize yet.', 'error');
    busy.current = true;
    stopped.current = false;
    try {
      const s = summarySettings(useLlmStore.getState().chatSettings.summary);
      // The chat's own prompt, the summary so far in it, then the ask.
      const built = build(messages);
      const r = await run(connection, [...built.messages, { role: 'system', content: summaryInstruction(s) }], undefined, { params });
      if (r.error) return toast(r.error, 'error');
      const written = r.text.trim();
      // A stopped summary is half a summary: the old one stays.
      if (!written || stopped.current || useChatStore.getState().chat?.id !== chat.id) return;
      useChatStore.getState().setSummary({ text: written, through: last.id, updatedAt: Date.now() });
    } finally {
      busy.current = false;
    }
  };

  /** Summarizes if enough is new since the last summary. */
  const summarizeIfDue = async (req: SummaryRequest) => {
    const chat = useChatStore.getState().chat;
    if (!chat || busy.current) return;
    if (summaryDue(chat.messages, chat.summary, summarySettings(useLlmStore.getState().chatSettings.summary))) await summarize(req);
  };

  const stopSummary = () => {
    stopped.current = true;
    stop();
  };

  return { summarize, summarizeIfDue, stop: stopSummary, running, text };
}

const POSITIONS: { value: SummaryPosition; label: string }[] = [
  { value: 'before', label: 'Before the main prompt' },
  { value: 'after', label: 'After the main prompt' },
  { value: 'depth', label: 'In the chat, at a depth' },
  { value: 'none', label: 'Not sent' },
];

export function ChatSummaryPanel({ summarizer, request, onClose }: { summarizer: ReturnType<typeof useChatSummary>; request: () => SummaryRequest; onClose: () => void }) {
  const chat = useChatStore((st) => st.chat);
  const setSummary = useChatStore((st) => st.setSummary);
  const { chatSettings, setChatSettings } = useLlmStore();
  const s = summarySettings(chatSettings.summary);
  const set = (patch: Partial<SummarySettings>) => setChatSettings({ summary: { ...chatSettings.summary, ...patch } });
  const [showPrompt, setShowPrompt] = useState(false);
  if (!chat) return null;

  const summary = chat.summary;
  const fresh = newSinceSummary(chat.messages, summary).filter((m) => messageText(m).trim()).length;
  const through = summary?.through ? chat.messages.findIndex((m) => m.id === summary.through) : -1;
  const shown = summarizer.running ? summarizer.text : (summary?.text ?? '');

  return (
    <div className="flex max-h-[55%] flex-shrink-0 flex-col gap-2 overflow-y-auto border-b border-slate-800 bg-slate-950 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Summary</span>
        <IconButton title="Close" onClick={onClose}>
          ✕
        </IconButton>
      </div>
      <AutoTextarea
        value={shown}
        readOnly={summarizer.running}
        onChange={(e) => setSummary({ text: e.target.value, through: summary?.through ?? null, updatedAt: Date.now() })}
        minRows={3}
        maxRows={12}
        placeholder="No summary yet. Write one, or have the model write it."
        className="text-sm"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {summarizer.running ? (
          <Button size="sm" variant="danger" onClick={summarizer.stop}>
            ■ Stop
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void summarizer.summarize(request())} disabled={!chat.messages.length} title="Ask the model to sum up the chat so far, building on this summary">
            📜 Summarize now
          </Button>
        )}
        {summary && !summarizer.running && (
          <Button size="sm" onClick={() => setSummary(undefined)}>
            Clear
          </Button>
        )}
        {shown && <TokenBadge text={shown} />}
        <span>
          {summary ? (through >= 0 ? `Covers up to #${through + 1}` : 'Covers the start') : 'Covers nothing yet'}
          {fresh ? ` · ${fresh} new message${fresh === 1 ? '' : 's'} since` : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 phone:grid-cols-1">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Target length (words)
          <NumberInput value={s.targetWords || undefined} onChange={(v) => set({ targetWords: v ?? 0 })} min={0} step={50} allowEmpty placeholder="no target" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Where it goes
          <Select value={s.position} onChange={(v) => set({ position: v })} options={POSITIONS} className="text-xs" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400" title="Summarize on its own once this many messages are new since the last summary">
          Auto: every N messages
          <NumberInput value={s.everyMessages || undefined} onChange={(v) => set({ everyMessages: v ?? 0 })} min={0} step={1} allowEmpty placeholder="off" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400" title="Summarize on its own once the new messages come to this many tokens">
          Auto: every N new tokens
          <NumberInput value={s.everyTokens || undefined} onChange={(v) => set({ everyTokens: v ?? 0 })} min={0} step={500} allowEmpty placeholder="off" />
        </label>
        {s.position === 'depth' && (
          <>
            <label className="flex flex-col gap-1 text-xs text-slate-400" title="Messages from the end of the chat: 0 goes after the last one">
              Depth
              <NumberInput value={s.depth} onChange={(v) => set({ depth: v ?? DEFAULT_SUMMARY_SETTINGS.depth })} min={0} step={1} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              As
              <Select
                value={s.role}
                onChange={(v) => set({ role: v })}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'user', label: 'User' },
                  { value: 'assistant', label: 'Assistant' },
                ]}
                className="text-xs"
              />
            </label>
          </>
        )}
      </div>

      <button type="button" className="self-start text-xs text-violet-300 hover:underline" onClick={() => setShowPrompt(!showPrompt)}>
        {showPrompt ? '▾' : '▸'} Prompt and template
      </button>
      {showPrompt && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            <span>
              What the model is asked <span className="text-slate-500">({'{{words}}'} is the target; with none, its sentence is left out)</span>
            </span>
            <AutoTextarea value={s.prompt} onChange={(e) => set({ prompt: e.target.value })} minRows={2} maxRows={8} className="text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            <span>
              How it&apos;s sent <span className="text-slate-500">({'{{summary}}'} is the summary)</span>
            </span>
            <input value={s.template} onChange={(e) => set({ template: e.target.value })} className={cx(inputClass, 'text-xs')} />
          </label>
          <Button size="sm" className="self-start" onClick={() => set({ prompt: DEFAULT_SUMMARY_SETTINGS.prompt, template: DEFAULT_SUMMARY_SETTINGS.template })}>
            Reset to SillyTavern&apos;s
          </Button>
        </div>
      )}
    </div>
  );
}
