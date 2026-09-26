'use client';

import { useEffect, useState } from 'react';

// Token counts for card fields. Every model counts a little differently,
// so this is an estimate: GPT's o200k tokenizer, which lands close to
// most current models for English prose. Loaded on first use (~2 MB).

type Counter = (text: string) => number;
let counter: Counter | null = null;
let loading: Promise<Counter> | null = null;

export function loadTextCounter(): Promise<Counter> {
  if (counter) return Promise.resolve(counter);
  loading ??= import('gpt-tokenizer').then((m) => {
    counter = (text: string) => (text ? m.countTokens(text) : 0);
    return counter;
  });
  return loading;
}

/** Estimated tokens in `text`, updated a moment after it stops changing.
 *  Falls back to ~4 characters a token while the tokenizer loads. */
export function useTextTokens(text: string, delay = 250): number {
  const [n, setN] = useState(() => (counter ? counter(text) : Math.ceil(text.length / 4)));
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      loadTextCounter().then((count) => !cancelled && setN(count(text)));
    }, counter ? delay : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, delay]);
  return n;
}

export const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
