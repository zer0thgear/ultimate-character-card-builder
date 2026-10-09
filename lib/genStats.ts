import type { GenStats } from '@/types/project';

// How long a reply took to write, shown under its portrait as SillyTavern
// shows its message timer and tokens a second, with the wait for the first
// token beside them.

/** A finished generation's stats: its timing, and the tokens it wrote (the
 *  provider's count, or `estimate` of the text it wrote). */
export function genStats(timing: { ms: number; firstMs?: number } | undefined, outputTokens: number | undefined, estimate: () => number): GenStats | undefined {
  if (!timing) return undefined;
  const tokens = outputTokens ?? estimate();
  return { ms: Math.round(timing.ms), ...(timing.firstMs !== undefined ? { ttft: Math.round(timing.firstMs) } : {}), ...(tokens > 0 ? { tokens } : {}) };
}

/** Tokens a second, over the whole generation, as SillyTavern counts it. */
export const tokensPerSecond = (g: GenStats): number | undefined => (g.tokens && g.ms > 0 ? g.tokens / (g.ms / 1000) : undefined);

/** "0.8s", "12.3s", "2m 05s". */
export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.floor(s - m * 60)).padStart(2, '0')}s`;
}

/** Sets item `i` of a per-swipe list (shorter lists are padded). */
export function setAt<T>(list: (T | undefined)[] | undefined, i: number, value: T | undefined): (T | undefined)[] {
  const out = [...(list ?? [])];
  while (out.length < i) out.push(undefined);
  out[i] = value;
  return out;
}
