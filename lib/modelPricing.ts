import type { LlmConnection } from '@/types/llm';

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
