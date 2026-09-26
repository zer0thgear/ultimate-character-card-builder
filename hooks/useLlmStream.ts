'use client';

import { useCallback, useRef, useState } from 'react';
import type { LlmConnection, LlmMessage, SamplerParams } from '@/types/llm';
import { streamLlm } from '@/lib/api';
import { requestConnection } from '@/store/llmStore';

export interface StreamResult {
  text: string;
  reasoning: string;
  stopReason?: string;
  error?: string;
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
    opts: { prefill?: boolean; params?: Partial<SamplerParams> } = {},
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
    const result: StreamResult = { text: '', reasoning: '' };
    try {
      await streamLlm(
        { connection: { ...requestConnection(connection), params: { ...connection.params, ...opts.params } }, messages, prefill: opts.prefill },
        (e) => {
          if (e.type === 'text') {
            result.text += e.text;
            setText(result.text);
            onText?.(result.text);
          } else if (e.type === 'reasoning') {
            result.reasoning += e.text;
            setReasoning(result.reasoning);
          } else if (e.type === 'done') {
            result.stopReason = e.stopReason;
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
    }
    return result;
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    setText('');
    setReasoning('');
    setError(null);
  }, []);

  return { run, stop, reset, text, reasoning, running, error };
}
