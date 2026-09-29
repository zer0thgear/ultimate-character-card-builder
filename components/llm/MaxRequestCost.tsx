'use client';

import { formatDollars, maxRequestCost, type ModelPrice } from '@/lib/modelPricing';

/**
 * The most one request can cost on a metered model, as SillyTavern shows it:
 * a full context of input plus a full-length reply. Nothing when it can't
 * be worked out (a price that varies, or no context size known).
 */
export function MaxRequestCost({ price, contextSize, maxTokens, className }: { price: ModelPrice | undefined; contextSize?: number; maxTokens: number; className?: string }) {
  if (!price) return null;
  const m = maxRequestCost(price, { contextSize, maxTokens });
  if (!m) return null;
  const from = contextSize && (!price.context || contextSize <= price.context) ? 'the context size set here' : "the model's own context length";
  return (
    <span
      className={className ?? 'text-[11px] text-slate-400'}
      title={`${m.input.toLocaleString()} tokens of prompt (${from}, less the reply) plus a ${m.output.toLocaleString()}-token reply. Most requests cost far less: a short chat or a small card doesn't fill the context.`}
    >
      Most one request can cost: <span className="text-emerald-300/80">{formatDollars(m.cost)}</span> ({m.context.toLocaleString()}-token context, {m.output.toLocaleString()}-token reply)
    </span>
  );
}
