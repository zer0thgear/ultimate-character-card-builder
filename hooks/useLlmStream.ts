'use client';

import { useCallback, useRef, useState } from 'react';
import type { LlmConnection, LlmMessage, SamplerParams } from '@/types/llm';
import { streamLlm } from '@/lib/api';
import { requestConnection, textTemplates, useLlmStore } from '@/store/llmStore';
import { messagesToText } from '@/lib/textCompletion';
import { useProjectStore } from '@/store/projectStore';
import { resolvePersona, usePersonaStore } from '@/store/personaStore';
import { presetParams } from '@/lib/stPreset';
import { wrapWithPreset } from '@/lib/assistPreset';
import { useAssistLog } from '@/store/assistLog';
import { useJobStore } from '@/store/jobStore';
import { uuid } from '@/lib/uuid';

/**
 * A writing-assistant request as it will be sent: the assistant's
 * connection, the job's messages wrapped in its SillyTavern preset (if one
 * is set, with prompts on), and the preset's samplers (if on).
 */
export function assistRequest(messages: LlmMessage[], connectionId?: string | null): { connection: LlmConnection | null; messages: LlmMessage[]; params: Partial<SamplerParams>; preset?: string } {
  const { connections, assistConnectionId, assistSettings: a, presets, chatSettings } = useLlmStore.getState();
  const connection = connections.find((c) => c.id === (connectionId ?? assistConnectionId)) ?? null;
  const preset = a.presetId ? presets.find((p) => p.id === a.presetId) : undefined;
  if (!preset || !connection) return { connection, messages, params: {} };
  const me = resolvePersona(usePersonaStore.getState().personas, chatSettings);
  const wrapped = a.prompts
    ? wrapWithPreset(messages, preset, {
        card: useProjectStore.getState().project?.card.data,
        userName: me.name,
        persona: me.description,
        excluded: a.excluded[preset.id] ?? [],
      })
    : messages;
  return { connection, messages: wrapped, params: a.samplers ? presetParams(preset, connection.kind) : {}, preset: preset.name };
}

/** Stop reasons that mean the reply hit its token limit (OpenAI-compatible
 *  and NovelAI say "length", Claude "max_tokens"). */
export const isCutOff = (stopReason?: string) => stopReason === 'length' || stopReason === 'max_tokens';

export interface StreamResult {
  text: string;
  reasoning: string;
  stopReason?: string;
  error?: string;
  /** How long it took, in ms: in all, and to its first token. */
  timing?: { ms: number; firstMs?: number };
  /** Tokens written, as the provider counted them (when it says). */
  outputTokens?: number;
}

/** One streaming completion at a time, with live text and a Stop. */
export function useLlmStream() {
  const [text, setText] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (
    connection: LlmConnection | null,
    messages: LlmMessage[],
    onText?: (full: string) => void,
    /** `prefill`: the last message starts the reply. `params` override the
     *  connection's (a preset's samplers). */
    opts: { prefill?: boolean; params?: Partial<SamplerParams>; onReasoning?: (full: string) => void; prefix?: string; text?: { prompt: string; stop: string[] } } = {},
  ): Promise<StreamResult> => {
    abortRef.current?.abort();
    setText('');
    setReasoning('');
    setError(null);
    if (!connection) {
      const message = 'Add an LLM connection in Settings first.';
      setError(message);
      return { text: '', reasoning: '', error: message };
    }
    if (!connection.model) {
      const message = `Pick a model for the "${connection.name}" connection in Settings.`;
      setError(message);
      return { text: '', reasoning: '', error: message };
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    useJobStore.getState().bump(1);
    const result: StreamResult = { text: '', reasoning: '' };
    const t0 = performance.now();
    let first: number | undefined;
    // A text-completion connection gets one prompt in its instruct
    // template: the chat's own (built from the card), or these messages
    // laid out in it.
    const templates = textTemplates(connection);
    const text = templates ? (opts.text ?? messagesToText(messages, templates.instruct, { prefill: opts.prefill })) : undefined;
    const params = { ...connection.params, ...opts.params };
    if (text?.stop.length) params.stop = [...new Set([...(params.stop ?? []), ...text.stop])];
    try {
      await streamLlm(
        { connection: { ...requestConnection(connection), params }, messages, prefill: opts.prefill, ...(text ? { prompt: text.prompt } : {}) },
        (e) => {
          if ((e.type === 'text' || e.type === 'reasoning') && e.text && first === undefined) first = performance.now() - t0;
          if (e.type === 'text') {
            result.text += e.text;
            setText((opts.prefix ?? '') + result.text);
            onText?.((opts.prefix ?? '') + result.text);
          } else if (e.type === 'reasoning') {
            result.reasoning += e.text;
            setReasoning(result.reasoning);
            opts.onReasoning?.(result.reasoning);
          } else if (e.type === 'done') {
            result.stopReason = e.stopReason;
            if (e.usage?.output) result.outputTokens = e.usage.output;
          } else if (e.type === 'error') {
            result.error = e.message;
            setError(e.message);
          }
        },
        controller.signal,
      );
    } catch (err) {
      result.error = (err as Error).message;
      setError(result.error);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
      useJobStore.getState().bump(-1);
    }
    result.timing = { ms: performance.now() - t0, ...(first !== undefined ? { firstMs: first } : {}) };
    if (opts.prefix) result.text = opts.prefix + result.text;
    return result;
  }, []);

  /** The id of this hook's latest assistant run, in the assist log. */
  const [runId, setRunId] = useState<string | null>(null);
  /** The latest reply stopped at its token limit, so there's more to come. */
  const [cutOff, setCutOff] = useState(false);
  /** The latest assistant request, for continueAssist. */
  const lastAssist = useRef<{ messages: LlmMessage[]; label: string; connectionId?: string | null } | null>(null);

  /** A writing-assistant request (see assistRequest), logged under `label`
   *  so its reasoning and prompt can be looked at. */
  const runAssist = useCallback(
    async (messages: LlmMessage[], onText?: (full: string) => void, label = 'Assistant', opts: { connectionId?: string | null; continueFrom?: string; maxTokens?: number } = {}): Promise<StreamResult & { runId: string }> => {
      if (opts.continueFrom === undefined && opts.maxTokens === undefined) lastAssist.current = { messages, label, connectionId: opts.connectionId };
      setCutOff(false);
      const req = assistRequest(messages, opts.connectionId);
      // A continue: the reply so far goes last, as the start of the model's
      // reply (after any preset prompts), and it writes on from there.
      if (opts.continueFrom !== undefined) req.messages = [...req.messages, { role: 'assistant', content: opts.continueFrom }];
      const id = uuid();
      const log = useAssistLog.getState();
      log.add({
        id,
        label,
        at: Date.now(),
        connection: req.connection?.name ?? '(none)',
        model: req.connection?.model ?? '',
        messages: req.messages,
        params: { ...req.connection?.params, ...req.params },
        preset: req.preset,
        text: '',
        reasoning: '',
        running: true,
      });
      setRunId(id);
      const r = await run(
        req.connection,
        req.messages,
        (full) => {
          useAssistLog.getState().update(id, { text: full });
          onText?.(full);
        },
        { params: opts.maxTokens ? { ...req.params, max_tokens: opts.maxTokens } : req.params, onReasoning: (reasoning) => useAssistLog.getState().update(id, { reasoning }), prefill: opts.continueFrom !== undefined, prefix: opts.continueFrom },
      );
      useAssistLog.getState().update(id, { running: false, text: r.text, reasoning: r.reasoning, error: r.error });
      setCutOff(isCutOff(r.stopReason));
      return { ...r, runId: id };
    },
    [run],
  );

  /** Carries on the latest assistant reply from `soFar` (it, or your edit
   *  of it), for one that stopped short. The result is `soFar` plus what
   *  the model added. */
  const continueAssist = useCallback(
    async (soFar: string) => {
      const last = lastAssist.current;
      if (!last) return null;
      return runAssist(last.messages, undefined, `${last.label} (continued)`, { connectionId: last.connectionId, continueFrom: soFar });
    },
    [runAssist],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    setText('');
    setReasoning('');
    setError(null);
  }, []);

  /** The latest request again, once, with twice the room to reply (for a
   *  reasoning model that thought its whole budget away). */
  const retryWithMoreRoom = useCallback(async () => {
    const last = lastAssist.current;
    if (!last) return null;
    const req = assistRequest(last.messages, last.connectionId);
    const now = req.params.max_tokens ?? req.connection?.params.max_tokens ?? 1024;
    return runAssist(last.messages, undefined, `${last.label} (more room)`, { connectionId: last.connectionId, maxTokens: now * 2 });
  }, [runAssist]);

  return { run, runAssist, continueAssist, retryWithMoreRoom, cutOff, runId, stop, reset, text, reasoning, running, error };
}
