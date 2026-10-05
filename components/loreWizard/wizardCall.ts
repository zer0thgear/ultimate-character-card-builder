'use client';

import type { LlmConnection, LlmMessage } from '@/types/llm';
import { streamLlm } from '@/lib/api';
import { messagesToText } from '@/lib/textCompletion';
import { requestConnection, textTemplates, useLlmStore } from '@/store/llmStore';
import { useLoreWizardStore } from '@/store/loreWizardStore';
import { useAssistLog } from '@/store/assistLog';
import { useJobStore } from '@/store/jobStore';
import { uuid } from '@/lib/uuid';

// One lorebook-wizard call: the Planner's or the Writer's own connection
// (else the writing assistant's), streamed through the proxy and logged
// where the assistant's requests are, so 🔍 shows what each was sent.

export type WizardRole = 'planner' | 'writer';

/** The connection a role uses: its own, else the assistant's. */
export function wizardConnection(role: WizardRole): LlmConnection | null {
  const { connections, assistConnectionId } = useLlmStore.getState();
  const w = useLoreWizardStore.getState();
  const own = role === 'planner' ? w.plannerConnectionId : w.writerConnectionId;
  return connections.find((c) => c.id === own) ?? connections.find((c) => c.id === assistConnectionId) ?? connections[0] ?? null;
}

export async function wizardCall(role: WizardRole, label: string, messages: LlmMessage[], opts: { onText?: (text: string) => void; signal?: AbortSignal; onRun?: (runId: string) => void } = {}): Promise<{ text: string; error?: string; aborted?: boolean; runId: string }> {
  const connection = wizardConnection(role);
  const runId = uuid();
  if (!connection) return { text: '', error: 'Add an LLM connection in Settings first.', runId };
  if (!connection.model) return { text: '', error: `Pick a model for the "${connection.name}" connection in Settings.`, runId };
  useAssistLog.getState().add({ id: runId, label: `🧙 Lorebook wizard: ${label}`, at: Date.now(), connection: connection.name, model: connection.model, messages, params: connection.params, text: '', reasoning: '', running: true });
  opts.onRun?.(runId);
  const templates = textTemplates(connection);
  const text = templates ? messagesToText(messages, templates.instruct) : undefined;
  const params = { ...connection.params };
  if (text?.stop.length) params.stop = [...new Set([...(params.stop ?? []), ...text.stop])];
  let out = '';
  let reasoning = '';
  let error: string | undefined;
  let aborted = false;
  useJobStore.getState().bump(1);
  try {
    await streamLlm(
      { connection: { ...requestConnection(connection), params }, messages, ...(text ? { prompt: text.prompt } : {}) },
      (e) => {
        if (e.type === 'text') {
          out += e.text;
          opts.onText?.(out);
          useAssistLog.getState().update(runId, { text: out });
        } else if (e.type === 'reasoning') {
          reasoning += e.text;
          useAssistLog.getState().update(runId, { reasoning });
        } else if (e.type === 'error') error = e.message;
      },
      opts.signal,
    );
  } catch (err) {
    if ((err as Error).name === 'AbortError') aborted = true;
    else error = (err as Error).message;
  } finally {
    useJobStore.getState().bump(-1);
  }
  if (opts.signal?.aborted) aborted = true;
  useAssistLog.getState().update(runId, { running: false, text: out, reasoning, error });
  return { text: out, error, aborted, runId };
}
