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
