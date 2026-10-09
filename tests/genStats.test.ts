import { describe, expect, it } from 'vitest';
import { formatSeconds, genStats, setAt, tokensPerSecond } from '@/lib/genStats';
import { withoutSwipe } from '@/lib/chatPrompt';
import type { ChatMessage } from '@/types/project';

describe('generation stats', () => {
  it("takes the provider's token count, or estimates one", () => {
    expect(genStats({ ms: 2000.4, firstMs: 350.6 }, 80, () => 1)).toEqual({ ms: 2000, ttft: 351, tokens: 80 });
    expect(genStats({ ms: 1000 }, undefined, () => 25)).toEqual({ ms: 1000, tokens: 25 });
    expect(genStats(undefined, 80, () => 1)).toBeUndefined();
  });

  it('counts tokens a second over the whole reply', () => {
    expect(tokensPerSecond({ ms: 4000, tokens: 100 })).toBe(25);
    expect(tokensPerSecond({ ms: 4000 })).toBeUndefined();
  });

  it('formats seconds, and minutes past a minute', () => {
    expect(formatSeconds(820)).toBe('0.8s');
    expect(formatSeconds(12_340)).toBe('12.3s');
    expect(formatSeconds(125_000)).toBe('2m 05s');
    expect(formatSeconds(119_900)).toBe('1m 59s');
  });

  it("sets one version's stats, and they go with it when it's deleted", () => {
    expect(setAt(undefined, 2, 'x')).toEqual([undefined, undefined, 'x']);
    expect(setAt(['a', 'b'], 0, 'x')).toEqual(['x', 'b']);
    const m: ChatMessage = { id: 'm', role: 'assistant', swipes: ['a', 'b', 'c'], swipe: 2, createdAt: 0, gen: [{ ms: 1 }, { ms: 2 }, { ms: 3 }] };
    expect(withoutSwipe(m, 1).gen).toEqual([{ ms: 1 }, { ms: 3 }]);
  });
});
