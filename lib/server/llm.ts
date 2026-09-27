import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { LlmEvent, LlmRequest, SamplerParams } from '@/types/llm';
import { NOVELAI_TEXT_BASE } from '@/types/llm';
import { VISION_HINT, sseData, toAnthropic, toOpenAiMessage } from '@/lib/llmShape';

// The providers behind /api/llm/chat, each turned into the same stream of
// LlmEvents. Keys arrive with each request from the browser (which keeps
// them in data/settings.json) and are only ever sent to the provider itself.

const trimSlash = (s: string) => s.replace(/\/+$/, '');

function baseUrlFor(req: LlmRequest): string {
  if (req.connection.kind === 'novelai') return NOVELAI_TEXT_BASE;
  const base = trimSlash(req.connection.baseUrl.trim());
  if (!base) throw new Error('This connection has no base URL.');
  return base;
}

/** The sampler fields an OpenAI-compatible body takes. Unset ones are left
 *  out so each server uses its own defaults. */
function openAiParams(kind: 'novelai' | 'openai', p: SamplerParams, baseUrl: string) {
  const body: Record<string, unknown> = { max_tokens: p.max_tokens };
  const copy = ['temperature', 'top_p', 'top_k', 'min_p', 'top_a', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'seed'] as const;
  for (const k of copy) if (typeof p[k] === 'number') body[k] = p[k];
  if (p.stop?.length) body.stop = p.stop;
  if (kind === 'openai' && p.reasoning_effort) {
    if (/openrouter\.ai/i.test(baseUrl)) body.reasoning = { effort: p.reasoning_effort };
    else body.reasoning_effort = p.reasoning_effort;
  }
  if (kind === 'novelai') {
    if (p.enable_thinking !== undefined) body.enable_thinking = p.enable_thinking;
    const unified = ['unified_linear', 'unified_quadratic', 'unified_cubic', 'unified_increase_linear_with_entropy'] as const;
    for (const k of unified) if (typeof p[k] === 'number') body[k] = p[k];
  }
  return { ...body, ...(p.extra ?? {}) };
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return j.error?.message ?? j.message ?? j.error ?? text;
  } catch {
    return text || res.statusText;
  }
}

async function* openAiStream(req: LlmRequest, signal: AbortSignal): AsyncGenerator<LlmEvent> {
  const kind = req.connection.kind === 'novelai' ? 'novelai' : 'openai';
  const base = baseUrlFor(req);
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(req.connection.apiKey ? { Authorization: `Bearer ${req.connection.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: req.connection.model,
      messages: req.messages.map(toOpenAiMessage),
      stream: true,
      ...openAiParams(kind, req.connection.params, base),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    yield { type: 'error', status: res.status, message: withVisionHint(req, `${res.status}: ${await errorText(res)}`) };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason: string | undefined;
  let usage: { input?: number; output?: number } | undefined;
  // Some servers put reasoning inline between <think> tags instead of in
  // its own field; split it out so it's shown apart from the reply.
  let inThink = false;
  let sawContent = false;
  const splitThink = function* (text: string): Generator<LlmEvent> {
    let rest = text;
    while (rest) {
      if (inThink) {
        const end = rest.indexOf('</think>');
        if (end < 0) {
          yield { type: 'reasoning', text: rest };
          return;
        }
        if (end > 0) yield { type: 'reasoning', text: rest.slice(0, end) };
        inThink = false;
        rest = rest.slice(end + 8).replace(/^\s+/, '');
      } else {
        const start = !sawContent ? rest.indexOf('<think>') : -1;
        if (start === 0 || (start > 0 && !rest.slice(0, start).trim())) {
          inThink = true;
          rest = rest.slice(start + 7);
          continue;
        }
        if (rest.trim()) sawContent = true;
        yield { type: 'text', text: rest };
        return;
      }
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = sseData(line);
      if (!data || data === '[DONE]') continue;
      let json: {
        choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string } | string;
      };
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) {
        yield { type: 'error', message: typeof json.error === 'string' ? json.error : json.error.message ?? 'Stream error' };
        return;
      }
      const choice = json.choices?.[0];
      const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
      if (reasoning) yield { type: 'reasoning', text: reasoning };
      if (choice?.delta?.content) yield* splitThink(choice.delta.content);
      if (choice?.finish_reason) stopReason = choice.finish_reason;
      if (json.usage) usage = { input: json.usage.prompt_tokens, output: json.usage.completion_tokens };
    }
  }
  yield { type: 'done', stopReason, usage };
}

async function* anthropicStream(req: LlmRequest, signal: AbortSignal): AsyncGenerator<LlmEvent> {
  const client = new Anthropic({ apiKey: req.connection.apiKey });
  const { system, messages } = toAnthropic(req.messages, { prefill: req.prefill });
  const p = req.connection.params;
  // Only what's set is sent: current models reject temperature/top_p/top_k,
  // so they're opt-in for the older models that take them.
  const sampling: Record<string, unknown> = {};
  for (const k of ['temperature', 'top_p', 'top_k'] as const) if (typeof p[k] === 'number') sampling[k] = p[k];
  const stream = client.messages.stream(
    {
      model: req.connection.model,
      max_tokens: p.max_tokens,
      // The card and lorebook sit at the front of every turn of a test
      // chat, so caching them saves most of each request.
      cache_control: { type: 'ephemeral' },
      ...(system ? { system } : {}),
      messages,
      ...(p.stop?.length ? { stop_sequences: p.stop } : {}),
      ...(p.thinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
      ...(p.effort ? { output_config: { effort: p.effort } } : {}),
      ...sampling,
    } as Anthropic.MessageStreamParams,
    { signal },
  );
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text };
        else if (event.delta.type === 'thinking_delta') yield { type: 'reasoning', text: event.delta.thinking };
      }
    }
    const final = await stream.finalMessage();
    yield {
      type: 'done',
      stopReason: final.stop_reason ?? undefined,
      usage: { input: final.usage.input_tokens, output: final.usage.output_tokens, cacheRead: final.usage.cache_read_input_tokens ?? undefined },
    };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      const message = `${err.status ?? ''} ${err.message}`.trim();
      yield { type: 'error', status: err.status, message: err.status === 400 ? withVisionHint(req, message) : message };
    } else throw err;
  }
}

const hasImages = (req: LlmRequest) => req.messages.some((m) => m.images?.length);

/** A provider's error, with the vision hint after it when pictures went. */
function withVisionHint(req: LlmRequest, message: string): string {
  if (!hasImages(req)) return message;
  return `${message.trim()}${/[.!?]$/.test(message.trim()) ? '' : '.'} ${VISION_HINT}`;
}

export function streamChat(req: LlmRequest, signal: AbortSignal): AsyncGenerator<LlmEvent> {
  // NovelAI's chat API takes text only (its messages' content is a string).
  if (req.connection.kind === 'novelai' && hasImages(req)) {
    return (async function* (): AsyncGenerator<LlmEvent> {
      yield { type: 'error', message: "NovelAI's text models can't see images, so this wasn't sent. Pick a vision model (an OpenAI-compatible or Claude connection) for it." };
    })();
  }
  return req.connection.kind === 'anthropic' ? anthropicStream(req, signal) : openAiStream(req, signal);
}

/** Model ids the connection offers, for its model picker. */
export async function listModels(conn: LlmRequest['connection']): Promise<string[]> {
  if (conn.kind === 'anthropic') {
    const client = new Anthropic({ apiKey: conn.apiKey });
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  }
  const res = await fetch(`${baseUrlFor({ connection: conn, messages: [] })}/models`, {
    headers: conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status}: ${await errorText(res)}`);
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).sort();
}
