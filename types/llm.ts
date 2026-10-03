// LLM connections, shared by the test chat and the writing assistant.
// Every provider is reached through the local proxy (app/api/llm/*), which
// turns its stream into the same events (LlmEvent) for the browser.

export type ProviderKind = 'novelai' | 'openai' | 'anthropic';

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface SamplerParams {
  max_tokens: number;
  /** Context size, in tokens: the test chat's history is trimmed (oldest
   *  first) so the prompt and the reply fit. A preset's own size wins. Never
   *  sent to the model. */
  max_context?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  top_a?: number;
  repetition_penalty?: number;
  seed?: number;
  stop?: string[];
  /** NovelAI: its models' reasoning mode (`enable_thinking`). */
  enable_thinking?: boolean;
  /** NovelAI's unified sampler (`unified_linear` etc.), passed as given. */
  unified_linear?: number;
  unified_quadratic?: number;
  unified_cubic?: number;
  unified_increase_linear_with_entropy?: number;
  /** OpenAI-compatible: how hard a reasoning model thinks. Sent as
   *  `reasoning_effort` (OpenAI and most servers), or `reasoning.effort` to
   *  OpenRouter. NovelAI only has thinking on or off. */
  reasoning_effort?: ReasoningEffort;
  /** Anthropic: adaptive thinking on, and how hard to think. */
  thinking?: boolean;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Anything else, merged into the request body as-is (OpenAI-compatible
   *  and NovelAI only). */
  extra?: Record<string, unknown>;
}

export interface LlmConnection {
  id: string;
  name: string;
  kind: ProviderKind;
  /** OpenAI-compatible only; NovelAI and Anthropic have fixed endpoints. */
  baseUrl: string;
  /** Empty for NovelAI means "use the NovelAI key from Settings". */
  apiKey: string;
  model: string;
  params: SamplerParams;
  /** OpenAI-compatible and NovelAI: send one text prompt laid out by an
   *  instruct template (/completions) instead of chat messages, for local
   *  models (lib/textCompletion.ts). */
  textCompletion?: boolean;
  /** The instruct and context templates it uses (built-in or imported). */
  instructId?: string;
  contextId?: string;
}

/** A picture sent with a message, for vision models: base64, no data: prefix. */
export interface LlmImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Pictures shown with it (user messages), for models that can see. */
  images?: LlmImage[];
}

/** What the proxy sends the browser, one JSON object per line. */
export type LlmEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'done'; stopReason?: string; usage?: { input?: number; output?: number; cacheRead?: number } }
  | { type: 'error'; message: string; status?: number };

/** The request the browser sends the proxy. */
export interface LlmRequest {
  connection: Pick<LlmConnection, 'kind' | 'baseUrl' | 'apiKey' | 'model' | 'params'>;
  messages: LlmMessage[];
  /** The last message is the start of the reply (a prefill) and must stay
   *  last, rather than being answered by a new user turn. */
  prefill?: boolean;
  /** Text completion: this is the whole prompt, sent to /completions
   *  (messages are then only for the record). */
  prompt?: string;
}

export const NOVELAI_TEXT_BASE = 'https://text.novelai.net/oa/v1';

export const DEFAULT_PARAMS: Record<ProviderKind, SamplerParams> = {
  novelai: { max_tokens: 600, temperature: 1, min_p: 0.05, top_p: 0.95 },
  openai: { max_tokens: 800, temperature: 0.9 },
  // Current Claude models reject sampling parameters; adaptive thinking is
  // their quality lever instead.
  anthropic: { max_tokens: 4000, thinking: false, effort: 'medium' },
};
