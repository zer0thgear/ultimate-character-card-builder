import { describe, expect, it } from 'vitest';
import { cardStats } from '@/lib/cardStats';
import type { ChatMessage, ChatSession } from '@/types/project';

// 📊 A card's numbers across its chats.

const day = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();
const words = (text: string) => text.split(' ').filter(Boolean).length;
const msg = (role: ChatMessage['role'], at: number, ...swipes: string[]): ChatMessage => ({ id: `${role}${at}${swipes[0]}`, role, swipes, swipe: swipes.length - 1, createdAt: at });
const chat = (id: string, messages: ChatMessage[], extra: Partial<ChatSession> = {}): ChatSession => ({ id, name: id, greeting: 0, messages, createdAt: day(1, 9), updatedAt: day(1, 9), ...extra });

describe('cardStats', () => {
  const chats = [
    chat('One', [
      msg('user', day(1), 'hello there dragon'),
      { ...msg('assistant', day(1), 'the kettle sings', 'the kettle whistles loudly now'), swipeDates: [day(1), day(3)] },
      msg('system', day(1), 'a note that counts for nothing'),
      msg('user', day(1, 13), 'kettle again'),
    ]),
    chat('Two', [msg('user', day(2), 'tea'), msg('assistant', day(2), 'kettle kettle tea')], { images: [{ id: 'i', after: null, file: 'f.png', width: 1, height: 1, scene: '', characters: [], createdAt: 0 }] }),
    chat('Empty', []),
  ];
  const s = cardStats(chats, words);

  it('adds up messages, sides, tokens and words', () => {
    expect(s.totals).toEqual({ chats: 3, messages: 5, sent: 3, received: 2, tokens: 3 + 3 + 5 + 2 + 1 + 3, words: 3 + 5 + 2 + 1 + 3, versions: 1, continues: 0, pictures: 1 });
  });

  it('knows when: first, last (a reroll counts), days and the busiest', () => {
    expect(s.first).toBe(day(1));
    expect(s.last).toBe(day(3));
    expect(s.daysActive).toBe(2);
    expect(s.busiestDay).toEqual({ day: '2026-10-01', messages: 3 });
  });

  it('measures replies and your messages as they read now', () => {
    expect(s.replies).toEqual({ average: 4, longest: 5 });
    expect(s.yours).toEqual({ average: 2, longest: 3 });
  });

  it("finds each side's favourite words, common ones and {{macros}} aside", () => {
    expect(s.favouriteWords.char).toEqual([{ word: 'kettle', count: 3 }]);
    expect(s.favouriteWords.you).toEqual([]);
    const macro = cardStats([chat('m', [msg('assistant', day(1), '{{user}} {{user}} smiles smiles')])], words);
    expect(macro.favouriteWords.char).toEqual([{ word: 'smiles', count: 2 }]);
  });

  it('lists each chat, newest first, and copes with none', () => {
    expect(s.chats.map((c) => [c.name, c.messages, c.sent, c.received])).toEqual([
      ['One', 3, 2, 1],
      ['Two', 2, 1, 1],
      ['Empty', 0, 0, 0],
    ]);
    const none = cardStats([], words);
    expect(none.totals.messages).toBe(0);
    expect(none.busiestDay).toBeNull();
    expect(none.replies).toEqual({ average: 0, longest: 0 });
  });
});
