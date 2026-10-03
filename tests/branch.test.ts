import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: {} }));
import { branchOf } from '@/store/chatStore';
import type { ChatSession } from '@/types/project';

const chat = (): ChatSession => ({
  id: 'c1',
  name: 'Chat 1',
  greeting: 2,
  greetingEdits: { 2: 'Mine' },
  personaId: 'p1',
  createdAt: 1,
  updatedAt: 1,
  messages: [
    { id: 'u1', role: 'user', swipes: ['Hi'], swipe: 0, createdAt: 10 },
    { id: 'a1', role: 'assistant', swipes: ['One', 'Two'], swipe: 1, createdAt: 20, swipeDates: [20, 25], reasoning: [undefined, 'Hmm'] },
    { id: 'u2', role: 'user', swipes: ['Later'], swipe: 0, createdAt: 30 },
  ],
  images: [
    { id: 'i0', after: null, file: 'c1-0.png', width: 1, height: 1, scene: 's', characters: [], createdAt: 5 },
    { id: 'i1', after: 'a1', file: 'c1-1.png', width: 1, height: 1, scene: 's', characters: [], createdAt: 26 },
    { id: 'i2', after: 'u2', file: 'c1-2.png', width: 1, height: 1, scene: 's', characters: [], createdAt: 31 },
  ],
});

describe('branching a chat', () => {
  it('keeps the messages up to the one picked, with every version, its pictures, greeting and persona', () => {
    const b = branchOf(chat(), 1, 'c2', 99);
    expect(b).toMatchObject({ id: 'c2', name: 'Chat 1 (branch at #2)', greeting: 2, greetingEdits: { 2: 'Mine' }, personaId: 'p1', createdAt: 99 });
    expect(b.messages.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(b.messages[1]).toMatchObject({ swipes: ['One', 'Two'], swipe: 1, swipeDates: [20, 25], reasoning: [undefined, 'Hmm'] });
    expect(b.images?.map((i) => i.id)).toEqual(['i0', 'i1']);
  });

  it("doesn't share anything with the chat it came from", () => {
    const original = chat();
    const b = branchOf(original, 1, 'c2', 99);
    b.messages[1].swipes.push('Three');
    b.images![0].file = 'c2-x.png';
    expect(original.messages[1].swipes).toEqual(['One', 'Two']);
    expect(original.images![0].file).toBe('c1-0.png');
  });

  it("names a branch of a branch after the chat they came from", () => {
    const b = branchOf({ ...chat(), name: 'Chat 1 (branch at #2)' }, 0, 'c3', 99);
    expect(b.name).toBe('Chat 1 (branch at #1)');
  });
});
