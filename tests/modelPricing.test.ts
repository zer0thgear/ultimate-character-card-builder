import { describe, expect, it } from 'vitest';
import { formatPrice, isOpenRouter, priceLabel } from '@/lib/modelPricing';

describe('model prices', () => {
  it('shows OpenRouter per-token prices per 1M or per 1K tokens', () => {
    // GLM-5.3 Flash: $0.045 in, $0.14 out per million.
    expect(priceLabel({ input: 0.000000045, output: 0.00000014 }, '1M')).toBe('$0.045 in · $0.14 out /1M');
    expect(priceLabel({ input: 0.000000045, output: 0.00000014 }, '1K')).toBe('$0.000045 in · $0.00014 out /1K');
    expect(priceLabel({ input: 0.0000012, output: 0.000004 }, '1M')).toBe('$1.20 in · $4.00 out /1M');
  });

  it('says free and varies instead of odd numbers', () => {
    expect(priceLabel({ input: 0, output: 0 }, '1M')).toBe('free');
    expect(priceLabel({ input: -1, output: -1 }, '1M')).toBe('price varies');
    expect(formatPrice(0, '1K')).toBe('free');
  });

  it('never uses exponent notation', () => {
    expect(formatPrice(0.00000000001, '1K')).toBe('$0.00000001');
  });

  it('knows an OpenRouter connection by its base URL', () => {
    expect(isOpenRouter({ kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1' })).toBe(true);
    expect(isOpenRouter({ kind: 'openai', baseUrl: 'http://localhost:5001/v1' })).toBe(false);
    expect(isOpenRouter({ kind: 'novelai', baseUrl: '' })).toBe(false);
  });
});

describe('the most a request can cost', () => {
  it('is a full context of input plus a full-length reply', async () => {
    const { maxRequestCost, formatDollars } = await import('@/lib/modelPricing');
    // GLM-5.3 Flash-ish: $0.15 in, $0.50 out per 1M, 128k context.
    const price = { input: 0.15e-6, output: 0.5e-6, context: 131072 };
    const r = maxRequestCost(price, { contextSize: 32768, maxTokens: 4000 })!;
    expect(r).toMatchObject({ context: 32768, input: 28768, output: 4000 });
    expect(r.cost).toBeCloseTo(28768 * 0.15e-6 + 4000 * 0.5e-6, 12);
    expect(formatDollars(r.cost)).toBe('$0.0063');
  });
  it("uses the model's context when none is set, or when it's smaller", async () => {
    const { maxRequestCost } = await import('@/lib/modelPricing');
    const price = { input: 1e-6, output: 2e-6, context: 8192 };
    expect(maxRequestCost(price, { maxTokens: 1000 })?.context).toBe(8192);
    expect(maxRequestCost(price, { contextSize: 100000, maxTokens: 1000 })?.context).toBe(8192);
    expect(maxRequestCost({ input: 1e-6, output: 2e-6 }, { maxTokens: 1000 })).toBeNull();
    expect(maxRequestCost({ input: -1, output: -1, context: 8192 }, { maxTokens: 1000 })).toBeNull();
  });
  it('reads well at every size', async () => {
    const { formatDollars } = await import('@/lib/modelPricing');
    expect(formatDollars(0)).toBe('free');
    expect(formatDollars(1.234)).toBe('$1.23');
    expect(formatDollars(0.00003)).toBe('<$0.0001');
    expect(formatDollars(0.045)).toBe('$0.045');
    expect(formatDollars(0.198)).toBe('$0.20');
  });
});
