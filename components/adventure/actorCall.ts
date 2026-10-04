'use client';

import type { ActorId } from '@/types/adventure';
import type { LlmConnection, LlmMessage } from '@/types/llm';
import type { ActorResult } from '@/lib/adventure';
import { streamLlm } from '@/lib/api';
import { estimateTokens } from '@/lib/chatPrompt';
import { messagesToText } from '@/lib/textCompletion';
import { requestConnection, textTemplates, useLlmStore } from '@/store/llmStore';
import { useAssistLog } from '@/store/assistLog';
import { useJobStore } from '@/store/jobStore';
import { priceNow } from '@/hooks/useModelPrices';
import { uuid } from '@/lib/uuid';

// One Adventure-mode model call: the actor's own connection (or the chat's),
// streamed through the proxy, logged where the assistant's requests are (so
// 🔍 shows exactly what each actor was sent), with what it took and cost.

/** The connection an actor uses: its own, else the chat's. */
export function actorConnection(actor: ActorId): LlmConnection | null {
  const { connections, adventureSettings, chatConnectionId } = useLlmStore.getState();
  const own = adventureSettings.connections[actor];
  return connections.find((c) => c.id === own) ?? connections.find((c) => c.id === chatConnectionId) ?? connections[0] ?? null;
}

export async function callActor(actor: ActorId, label: string, messages: LlmMessage[], opts: { onText?: (text: string) => void; signal?: AbortSignal; onRun?: (runId: string) => void } = {}): Promise<ActorResult & { runId: string }> {
  const connection = actorConnection(actor);
  const runId = uuid();
  if (!connection) return { text: '', error: 'Add an LLM connection in Settings first.', runId };
  if (!connection.model) return { text: '', error: `Pick a model for the "${connection.name}" connection in Settings.`, runId };
  const log = useAssistLog.getState();
  log.add({ id: runId, label: `Adventure: ${label}`, at: Date.now(), connection: connection.name, model: connection.model, messages, params: connection.params, text: '', reasoning: '', running: true });
  opts.onRun?.(runId);
  const templates = textTemplates(connection);
  const text = templates ? messagesToText(messages, templates.instruct) : undefined;
  const params = { ...connection.params };
  if (text?.stop.length) params.stop = [...new Set([...(params.stop ?? []), ...text.stop])];
  let out = '';
  let reasoning = '';
  let error: string | undefined;
  let usage: { input?: number; output?: number } | undefined;
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
        } else if (e.type === 'done') usage = e.usage;
        else if (e.type === 'error') error = e.message;
      },
      opts.signal,
    );
  } catch (err) {
    error = (err as Error).name === 'AbortError' ? undefined : (err as Error).message;
  } finally {
    useJobStore.getState().bump(-1);
  }
  useAssistLog.getState().update(runId, { running: false, text: out, reasoning, error });
  const sent = text?.prompt ?? messages.map((m) => m.content).join('\n\n');
  const input = usage?.input ?? estimateTokens(sent);
  const output = usage?.output ?? estimateTokens(out);
  const price = priceNow(connection);
  const dollars = price && price.input >= 0 && price.output >= 0 ? input * price.input + output * price.output : undefined;
  return {
    text: out,
    error,
    runId,
    usage: { actor, runId, connection: connection.name, model: connection.model, input, output, ...(usage?.input === undefined || usage?.output === undefined ? { estimated: true } : {}), ...(dollars !== undefined ? { dollars } : {}) },
  };
}
