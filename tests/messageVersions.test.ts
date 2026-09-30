import { describe, expect, it } from 'vitest';
import { swipeDate, withoutSwipe } from '@/lib/chatPrompt';
import type { ChatMessage } from '@/types/project';

const reply = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a',
  role: 'assistant',
  swipes: ['one', 'two', 'three'],
  swipe: 1,
  createdAt: 100,
  swipeDates: [100, 200, 300],
  reasoning: ['r1', 'r2', 'r3'],
  ...over,
});

describe("a reply's versions", () => {
  it('removes one, with its reasoning and time, the next taking its place', () => {
    const m = withoutSwipe(reply(), 1);
    expect(m.swipes).toEqual(['one', 'three']);
    expect(m.reasoning).toEqual(['r1', 'r3']);
    expect(m.swipeDates).toEqual([100, 300]);
    expect(m.swipe).toBe(1);
    expect(swipeDate(m)).toBe(300);
  });

  it('keeps the one showing when another goes, and the last when the last goes', () => {
    expect(withoutSwipe(reply({ swipe: 2 }), 0)).toMatchObject({ swipes: ['two', 'three'], swipe: 1 });
    expect(withoutSwipe(reply({ swipe: 2 }), 2)).toMatchObject({ swipes: ['one', 'two'], swipe: 1 });
  });

  it("leaves a message with one version alone, and keeps an older message's first time", () => {
    const single = reply({ swipes: ['only'], swipe: 0, swipeDates: undefined, reasoning: undefined });
    expect(withoutSwipe(single, 0)).toBe(single);
    const old = withoutSwipe(reply({ swipeDates: undefined, swipe: 2 }), 2);
    expect(swipeDate(old, 0)).toBe(100);
  });
});
