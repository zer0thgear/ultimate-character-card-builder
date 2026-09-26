import { NovelAIModel } from '@/types/novelai';
import { T5Tokenizer, T5Vocab } from '@/lib/tokenizers/t5Unigram';
import { QwenTokenizer } from '@/lib/tokenizers/qwenBpe';
import { ClipTokenizer } from '@/lib/tokenizers/clipBpe';

// Prompt token counting that matches NovelAI's own counter: same tokenizer
// per model, same limits, same preprocessing. Vocab files live in
// public/tokenizers/ and load on first use (see the README there).

export type TokenizerKind = 't5' | 'qwen' | 'clip';

export interface TokenBudget {
  kind: TokenizerKind;
  /** Tokens shared by the base prompt and every enabled character's prompt
   *  (and, separately, by the negative prompt and every character's). */
  limit: number;
  /** V3: no shared pool; the limit applies to each `|` prompt-mix part of
   *  a field on its own, so a field's count is its largest part. */
  perPart?: boolean;
}

/** NovelAI's per-model tokenizer and limit. */
export function tokenBudget(model: NovelAIModel): TokenBudget | null {
  if (model.startsWith('nai-diffusion-5-curated')) return { kind: 'qwen', limit: 703 };
  if (model.startsWith('nai-diffusion-5-full')) return { kind: 'qwen', limit: 1471 };
  if (model.startsWith('nai-diffusion-4')) return { kind: 't5', limit: 512 };
  if (model.startsWith('nai-diffusion-3') || model.startsWith('nai-diffusion-furry-3')) {
    return { kind: 'clip', limit: 225, perPart: true };
  }
  return null;
}

export type TokenCounter = (text: string) => number;

// Next's basePath (GitHub Pages serves the app under /<repo>/) isn't applied
// to URLs fetched at runtime, so public files need it added by hand.
const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/tokenizers/${path}`;

async function fetchOk(path: string): Promise<Response> {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error(`Couldn't load ${path} (HTTP ${res.status})`);
  return res;
}

const loaders: Record<TokenizerKind, () => Promise<TokenCounter>> = {
  t5: async () => {
    const tokenizer = new T5Tokenizer((await (await fetchOk('t5-unigram.json')).json()) as T5Vocab);
    return (text) => tokenizer.count(text);
  },
  qwen: async () => {
    const tokenizer = new QwenTokenizer(await (await fetchOk('qwen3.5-merges.txt')).text());
    return (text) => tokenizer.count(text);
  },
  clip: async () => {
    // NovelAI decodes HTML entities with this same library before counting.
    const [{ decode }, merges] = await Promise.all([
      import('html-entities'),
      fetchOk('clip-merges.txt').then((res) => res.text()),
    ]);
    const tokenizer = new ClipTokenizer(merges, decode);
    return (text) => tokenizer.count(text);
  },
};

const loading = new Map<TokenizerKind, Promise<TokenCounter>>();

export function loadTokenCounter(kind: TokenizerKind): Promise<TokenCounter> {
  let promise = loading.get(kind);
  if (!promise) {
    promise = loaders[kind]();
    // Let a failed load (e.g. offline) be retried later.
    promise.catch(() => loading.delete(kind));
    loading.set(kind, promise);
  }
  return promise;
}

/**
 * Token counts for each part of one prompt field, preprocessed as NovelAI
 * does: inside a `||a|b||` random group only the longest option counts, and
 * the prompt is split at single `|` (NovelAI's old prompt-mixing separator,
 * at most six parts) with each part counted on its own.
 */
export function countPromptParts(count: TokenCounter, text: string): number[] {
  const withLongest = text
    .split('||')
    .map((part, i) =>
      i % 2 === 0 ? part : part.split('|').reduce((longest, option) => (longest.length > option.length ? longest : option)),
    )
    .join('');
  const parts = withLongest.split('|');
  const mixed = parts.length > 6 ? [...parts.slice(0, 5), parts.slice(5).join('|')] : parts;
  return mixed.map(count);
}

/** A field's count against its budget: all parts together (V4+), or the
 *  largest part (V3, where each part has its own limit). */
export function countPromptTokens(count: TokenCounter, text: string, budget?: TokenBudget): number {
  const parts = countPromptParts(count, text);
  return budget?.perPart ? Math.max(0, ...parts) : parts.reduce((sum, n) => sum + n, 0);
}
