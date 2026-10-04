'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { useLlmStore } from '@/store/llmStore';
import { isOpenRouter, priceLabel, type ModelPrice } from '@/lib/modelPricing';
import type { LlmConnection } from '@/types/llm';

// OpenRouter's prices (app/api/llm/pricing), loaded the first time a price
// is shown and kept for the page's life.

const usePrices = create<{ prices: Record<string, ModelPrice> | null; asked: boolean }>(() => ({ prices: null, asked: false }));

function load() {
  if (usePrices.getState().asked) return;
  usePrices.setState({ asked: true });
  fetch('/api/llm/pricing')
    .then((r) => (r.ok ? r.json() : null))
    .then((prices: Record<string, ModelPrice> | null) => usePrices.setState({ prices: prices ?? {} }))
    .catch(() => usePrices.setState({ prices: {} }));
}

/** Prices for OpenRouter models, once loaded (null until then). Loads them
 *  when `wanted` (an OpenRouter connection is on show). */
export function useModelPrices(wanted = true): Record<string, ModelPrice> | null {
  const prices = usePrices((s) => s.prices);
  useEffect(() => {
    if (wanted) load();
  }, [wanted]);
  return prices;
}

/** A price label for `model` on `connection` ("$0.045 in · $0.14 out /1M"),
 *  or '' when it isn't an OpenRouter connection or the price isn't known. */
export function usePriceLabel(connection: LlmConnection | null | undefined, model = connection?.model): string {
  const unit = useLlmStore((s) => s.priceUnit);
  const prices = useModelPrices(isOpenRouter(connection));
  const p = model ? prices?.[model] : undefined;
  return isOpenRouter(connection) && p ? priceLabel(p, unit) : '';
}

/** An OpenRouter model's price as already loaded (loading it for next
 *  time if it isn't), outside a component. */
export function priceNow(connection: LlmConnection | null | undefined): ModelPrice | undefined {
  if (!isOpenRouter(connection)) return undefined;
  load();
  return usePrices.getState().prices?.[connection!.model];
}
