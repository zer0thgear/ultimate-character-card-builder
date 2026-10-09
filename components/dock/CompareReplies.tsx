'use client';

import { useState } from 'react';
import type { LlmConnection, SamplerParams } from '@/types/llm';
import type { ChatPreset } from '@/lib/stPreset';
import type { BuiltPrompt } from '@/lib/chatPrompt';
import { useLlmStore } from '@/store/llmStore';
import { useLlmStream, type StreamResult } from '@/hooks/useLlmStream';
import { useTextTokens, formatTokens, countTextNow } from '@/lib/textTokens';
import { genStats } from '@/lib/genStats';
import type { GenStats } from '@/types/project';
import { Button, Modal, cx, inputClass } from '@/components/ui';

// ⚖ Compare: the next reply written by two connections (or presets) at
// once, side by side, from the same chat; keep either, or both as swipes.

export interface CompareSide {
  connection: LlmConnection | null;
  preset: ChatPreset | null;
}

export interface KeptReply {
  text: string;
  reasoning?: string;
  model?: string;
  gen?: GenStats;
}

interface SidePick {
  connectionId: string | null;
  presetId: string | null;
}

export function CompareDialog({
  regenerating,
  prepare,
  onKeep,
  onClose,
}: {
  /** The last reply is being redone (kept ones become its swipes), rather
   *  than a new one written. */
  regenerating: boolean;
  /** The prompt and samplers for a side. */
  prepare: (side: CompareSide) => { built: BuiltPrompt; params: Partial<SamplerParams> };
  onKeep: (replies: KeptReply[]) => void;
  onClose: () => void;
}) {
  const { connections, presets, chatConnectionId, chatSettings } = useLlmStore();
  const other = connections.find((c) => c.id !== chatConnectionId)?.id ?? chatConnectionId;
  const [picks, setPicks] = useState<[SidePick, SidePick]>([
    { connectionId: chatConnectionId, presetId: chatSettings.presetId },
    { connectionId: other, presetId: chatSettings.presetId },
  ]);
  const a = useLlmStream();
  const b = useLlmStream();
  const streams = [a, b] as const;
  const [results, setResults] = useState<[(StreamResult & { ms: number; model?: string }) | null, (StreamResult & { ms: number; model?: string }) | null]>([null, null]);
  const [started, setStarted] = useState(false);
  const running = a.running || b.running;

  const sideOf = (p: SidePick): CompareSide => ({
    connection: connections.find((c) => c.id === p.connectionId) ?? null,
    preset: presets.find((x) => x.id === p.presetId) ?? null,
  });
  const write = () => {
    setStarted(true);
    setResults([null, null]);
    picks.forEach((p, i) => {
      const side = sideOf(p);
      const { built, params } = prepare(side);
      const messages = built.prefill !== undefined ? [...built.messages, { role: 'assistant' as const, content: built.prefill }] : built.messages;
      const t0 = performance.now();
      void streams[i]
        .run(side.connection, messages, undefined, { prefill: built.prefill !== undefined, params, text: built.text !== undefined ? { prompt: built.text, stop: built.stop ?? [] } : undefined })
        .then((r) => setResults((rs) => (i === 0 ? [{ ...r, ms: performance.now() - t0, model: side.connection?.model }, rs[1]] : [rs[0], { ...r, ms: performance.now() - t0, model: side.connection?.model }])));
    });
  };
  const stop = () => streams.forEach((s) => s.stop());
  const keep = (which: number[]) => {
    const kept = which.map((i) => results[i]).filter((r): r is NonNullable<typeof r> => !!r && !!r.text.trim());
    if (!kept.length) return;
    onKeep(kept.map((r) => ({ text: r.text, reasoning: r.reasoning || undefined, model: r.model, gen: genStats(r.timing, r.outputTokens, () => countTextNow(r.text)) })));
    onClose();
  };
  const set = (i: number, patch: Partial<SidePick>) => setPicks((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)) as [SidePick, SidePick]);
  const done = (i: number) => !!results[i]?.text.trim();

  return (
    <Modal
      open
      onClose={() => {
        stop();
        onClose();
      }}
      title={regenerating ? '⚖ Compare: the last reply, written two ways' : '⚖ Compare: the next reply, written two ways'}
      size="xl"
      footer={
        <>
          {running ? (
            <Button variant="danger" onClick={stop}>
              ■ Stop
            </Button>
          ) : (
            <Button variant={started ? 'secondary' : 'primary'} onClick={write} disabled={picks.some((p) => !p.connectionId)}>
              {started ? '↻ Write both again' : 'Write both'}
            </Button>
          )}
          <span className="mr-auto" />
          {started && !running && (
            <>
              <Button disabled={!done(0)} onClick={() => keep([0])}>
                Keep A
              </Button>
              <Button disabled={!done(1)} onClick={() => keep([1])}>
                Keep B
              </Button>
              <Button variant="primary" disabled={!done(0) || !done(1)} onClick={() => keep([0, 1])} title={regenerating ? 'Both, as new versions of the last reply' : 'Both, as versions (swipes) of the reply'}>
                Keep both
              </Button>
            </>
          )}
        </>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        Both get the same chat, built for each side&apos;s connection and preset (a text-completion connection uses its instruct template). The one you keep {regenerating ? 'becomes a new version of the last reply' : 'goes into the chat as the reply'}; keep both and they&apos;re its swipes.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {picks.map((p, i) => (
          <Side key={i} label={i ? 'B' : 'A'} pick={p} onPick={(patch) => set(i, patch)} connections={connections} presets={presets} disabled={running} stream={streams[i]} result={results[i]} />
        ))}
      </div>
    </Modal>
  );
}

function Side({
  label,
  pick,
  onPick,
  connections,
  presets,
  disabled,
  stream,
  result,
}: {
  label: string;
  pick: SidePick;
  onPick: (patch: Partial<SidePick>) => void;
  connections: LlmConnection[];
  presets: ChatPreset[];
  disabled: boolean;
  stream: ReturnType<typeof useLlmStream>;
  result: (StreamResult & { ms: number }) | null;
}) {
  const text = stream.text;
  const tokens = useTextTokens(text, 400);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-slate-800 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-violet-500/20 px-1.5 text-xs font-semibold text-violet-200">{label}</span>
        <select aria-label={`Connection ${label}`} value={pick.connectionId ?? ''} disabled={disabled} onChange={(e) => onPick({ connectionId: e.target.value || null })} className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs')}>
          {!pick.connectionId && <option value="">SidePick a connection</option>}
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.model || 'no model'}
            </option>
          ))}
        </select>
        <select aria-label={`Preset ${label}`} value={pick.presetId ?? ''} disabled={disabled} onChange={(e) => onPick({ presetId: e.target.value || null })} className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs')}>
          <option value="">No preset</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {stream.reasoning && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">Reasoning</summary>
          <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap">{stream.reasoning}</div>
        </details>
      )}
      <div data-testid={`compare-${label}`} className="max-h-[50vh] min-h-24 overflow-y-auto rounded bg-slate-900 px-2.5 py-2 text-sm leading-relaxed whitespace-pre-wrap text-slate-200">
        {text || (stream.running ? <span className="animate-pulse text-slate-500">…</span> : <span className="text-slate-600">Not written yet.</span>)}
      </div>
      {stream.error && <div className="text-xs text-red-300">{stream.error}</div>}
      {(text || result) && (
        <div className="text-[11px] text-slate-500">
          ~{formatTokens(tokens)} tokens
          {result && ` · ${(result.ms / 1000).toFixed(1)}s`}
          {result?.stopReason && ` · stopped: ${result.stopReason}`}
        </div>
      )}
    </div>
  );
}
