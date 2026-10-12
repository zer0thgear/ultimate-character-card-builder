import type { LlmConnection } from '@/types/llm';
import type { GenCost } from '@/types/project';

// Model prices for OpenRouter connections, shown per million tokens or per
// thousand (Settings → LLM connections). OpenRouter quotes dollars per
// token; a negative price means it varies (its routers pick the model).

export interface ModelPrice {
  /** Dollars per input (prompt) token. */
  input: number;
  /** Dollars per output (completion) token. */
  output: number;
  /** Dollars per cached input token, where the model caches. */
  cacheRead?: number;
  /** The model's context length, in tokens. */
  context?: number;
}

/**
 * The most one request can cost, as SillyTavern works it out for metered
 * connections: a full context of input and a full-length reply. The context
 * is the connection's size, or the model's own if that's smaller or there's
 * none set; the reply's tokens come out of it. Null when the price varies
 * or there's no context size to go on.
 */
export function maxRequestCost(price: ModelPrice, opts: { contextSize?: number; maxTokens: number }): { cost: number; context: number; input: number; output: number } | null {
  if (price.input < 0 || price.output < 0) return null;
  const sizes = [opts.contextSize, price.context].filter((n): n is number => typeof n === 'number' && n > 0);
  if (!sizes.length) return null;
  const context = Math.min(...sizes);
  const output = Math.min(opts.maxTokens, context);
  const input = Math.max(0, context - output);
  return { cost: input * price.input + output * price.output, context, input, output };
}

/** A dollar amount at a readable precision: "$0.0061", "$1.24", "free". */
export function formatDollars(d: number): string {
  if (d === 0) return 'free';
  if (d >= 0.1) return `$${d.toFixed(2)}`;
  if (d < 0.0001) return '<$0.0001';
  return `$${d.toLocaleString('en-US', { maximumSignificantDigits: 2, maximumFractionDigits: 6 })}`;
}

export type PriceUnit = '1M' | '1K';

export const isOpenRouter = (c: Pick<LlmConnection, 'kind' | 'baseUrl'> | null | undefined) => !!c && c.kind === 'openai' && /openrouter\.ai/i.test(c.baseUrl);

/** One price, per `unit` tokens: "$0.045", "$1.20", "free", "varies". */
export function formatPrice(perToken: number, unit: PriceUnit): string {
  if (perToken < 0) return 'varies';
  if (perToken === 0) return 'free';
  const v = perToken * (unit === '1M' ? 1e6 : 1e3);
  if (v >= 1) return `$${v.toFixed(2)}`;
  // Two significant figures, never in exponent form.
  return `$${v.toLocaleString('en-US', { maximumSignificantDigits: 2, maximumFractionDigits: 12 })}`;
}

/** "$0.045 in · $0.14 out /1M", or "free" when both are. */
export function priceLabel(p: ModelPrice, unit: PriceUnit): string {
  if (p.input === 0 && p.output === 0) return 'free';
  if (p.input < 0 || p.output < 0) return 'price varies';
  return `${formatPrice(p.input, unit)} in · ${formatPrice(p.output, unit)} out /${unit}`;
}

/**
 * What a request cost: the provider's own figure when it gives one
 * (OpenRouter does), else its tokens at the model's prices (counted by the
 * provider, or `estimate`d). Undefined when neither is known, or the price
 * varies.
 */
export function requestCost(
  usage: { input?: number; output?: number; cost?: number } | undefined,
  price: ModelPrice | undefined,
  estimate: { input: () => number; output: () => number },
): GenCost | undefined {
  const exact = typeof usage?.cost === 'number' && usage.cost >= 0;
  if (!exact && (!price || price.input < 0 || price.output < 0)) return undefined;
  const input = usage?.input ?? estimate.input();
  const output = usage?.output ?? estimate.output();
  if (exact) return { dollars: usage!.cost!, input, output };
  return { dollars: input * price!.input + output * price!.output, input, output, estimated: true };
}

/** "$0.0061 (3,412 in · 1,108 out)", with "about" when it's worked out here. */
export function costLine(c: GenCost): string {
  return `${c.estimated ? 'about ' : ''}${formatDollars(c.dollars)} (${c.input.toLocaleString('en-US')} tokens in · ${c.output.toLocaleString('en-US')} out)`;
}
