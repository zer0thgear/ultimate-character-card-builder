'use client';

import { useMemo } from 'react';
import { useAssistLog, useAssistRun, type AssistRun } from '@/store/assistLog';
import type { LlmMessage } from '@/types/llm';
import { Button, IconButton, Modal, TokenBadge, cx } from '@/components/ui';
import { copyText } from '@/lib/clipboard';
import { formatTokens, useTextTokens } from '@/lib/textTokens';

// What the writing assistant was asked and what it thought: each surface
// shows its latest run's reasoning inline (AssistReasoning) or behind a 🔍
// (AssistTraceButton), and the inspector shows the whole request.

export const inspectAssistRun = (id: string) => useAssistLog.getState().inspect(id);

/** The run's reasoning, folded, live while it streams; with a link to the
 *  full prompt. Nothing until the surface has run. */
export function AssistReasoning({ runId, className }: { runId: string | null; className?: string }) {
  const run = useAssistRun(runId);
  if (!run) return null;
  return (
    <div className={cx('flex flex-col gap-1 text-xs text-slate-400', className)}>
      {run.reasoning && (
        <details className="rounded-md bg-slate-950 px-3 py-2" open={run.running && !run.text}>
          <summary className="cursor-pointer">
            Reasoning{run.running && !run.text && <span className="ml-1.5 animate-pulse text-violet-300">thinking…</span>}
          </summary>
          <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap">{run.reasoning}</div>
        </details>
      )}
      <button type="button" className="self-start text-[11px] text-slate-500 hover:text-slate-300" onClick={() => inspectAssistRun(run.id)}>
        🔍 Prompt{run.reasoning ? ' and reasoning' : ''} · {run.model || run.connection}
      </button>
    </div>
  );
}

/** A 🔍 for surfaces with no room for the reasoning (the tag buttons). */
export function AssistTraceButton({ runId }: { runId: string | null }) {
  const run = useAssistRun(runId);
  if (!run) return null;
  return (
    <IconButton title={`See what was asked${run.reasoning ? ' and the reasoning' : ''}`} onClick={() => inspectAssistRun(run.id)}>
      {run.reasoning ? '🧠' : '🔍'}
    </IconButton>
  );
}

/** A list of messages with their roles and token counts. */
export function MessageList({ messages }: { messages: LlmMessage[] }) {
  return (
    <div className="flex flex-col gap-2">
      {messages.map((m, i) => (
        <div key={i} className="rounded-md border border-slate-800">
          <div className="flex items-center gap-2 border-b border-slate-800 px-2.5 py-1 text-xs">
            <span className={cx('rounded px-1.5 text-[10px] uppercase', m.role === 'system' ? 'bg-violet-500/15 text-violet-300' : m.role === 'user' ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300')}>{m.role}</span>
            <TokenBadge text={m.content} className="ml-auto" />
          </div>
          <div className="max-h-64 overflow-y-auto px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-slate-400">{m.content}</div>
        </div>
      ))}
    </div>
  );
}

/** Mounted once (Shell): the run someone asked to see. */
export function AssistInspectorHost() {
  const id = useAssistLog((s) => s.inspecting);
  const run = useAssistRun(id);
  if (!run) return null;
  return <AssistInspector run={run} onClose={() => useAssistLog.getState().inspect(null)} />;
}

function AssistInspector({ run, onClose }: { run: AssistRun; onClose: () => void }) {
  const all = useMemo(() => run.messages.map((m) => m.content).join('\n\n'), [run.messages]);
  const total = useTextTokens(all, 0);
  const effort = run.params.effort ?? run.params.reasoning_effort;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${run.label} · ~${formatTokens(total)} tokens`}
      size="lg"
      footer={<Button onClick={() => void copyText(JSON.stringify(run.messages, null, 2))}>Copy prompt as JSON</Button>}
    >
      <div className="flex flex-col gap-3">
        <div className="text-xs text-slate-400">
          {run.connection}
          {run.model && ` · ${run.model}`}
          {run.preset && ` · preset "${run.preset}"`}
          {effort && ` · effort ${effort}`}
          {(run.params.thinking || run.params.enable_thinking) && ' · thinking on'}
          {' · '}
          {new Date(run.at).toLocaleTimeString()}
          {run.running && <span className="ml-1.5 animate-pulse text-violet-300">running…</span>}
        </div>
        {run.error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{run.error}</div>}
        {run.reasoning && (
          <details open className="rounded-md bg-slate-950 px-3 py-2 text-xs text-slate-400">
            <summary className="cursor-pointer">Reasoning</summary>
            <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap">{run.reasoning}</div>
          </details>
        )}
        {run.text && (
          <details className="rounded-md bg-slate-950 px-3 py-2 text-xs text-slate-400">
            <summary className="cursor-pointer">Reply</summary>
            <div className="mt-2 max-h-72 overflow-y-auto text-sm whitespace-pre-wrap text-slate-300">{run.text}</div>
          </details>
        )}
        <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Sent</div>
        <MessageList messages={run.messages} />
      </div>
    </Modal>
  );
}
