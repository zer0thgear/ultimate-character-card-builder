import 'server-only';
import type { ModelPrice } from '@/lib/modelPricing';

// OpenRouter's public model list (no key needed) has every model's price, in
// dollars per token. Fetched when first asked for and kept for a few hours;
// only the prices go to the browser, not the whole ~750 KB list.

const URL = 'https://openrouter.ai/api/v1/models';
const KEEP_MS = 6 * 3600_000;

let cached: { at: number; prices: Record<string, ModelPrice> } | null = null;
let pending: Promise<Record<string, ModelPrice>> | null = null;

const num = (v: unknown) => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export async function openRouterPrices(): Promise<Record<string, ModelPrice>> {
  if (cached && Date.now() - cached.at < KEEP_MS) return cached.prices;
  pending ??= (async () => {
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`OpenRouter answered ${res.status}`);
      const json = (await res.json()) as { data?: { id: string; pricing?: Record<string, unknown> }[] };
      const prices: Record<string, ModelPrice> = {};
      for (const m of json.data ?? []) {
        const input = num(m.pricing?.prompt);
        const output = num(m.pricing?.completion);
        if (input === undefined || output === undefined) continue;
        prices[m.id] = { input, output, ...(num(m.pricing?.input_cache_read) !== undefined ? { cacheRead: num(m.pricing?.input_cache_read) } : {}) };
      }
      cached = { at: Date.now(), prices };
      return prices;
    } finally {
      pending = null;
    }
  })();
  return pending;
}
