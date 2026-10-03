import { describe, expect, it } from 'vitest';
import { chatMatches, splitMatches } from '@/lib/chatSearch';

describe('chat search', () => {
  const messages = [
    { id: 'a', text: 'The Sword of Dawn.' },
    { id: 'b', text: 'A shield.' },
    { id: 'c', text: 'swords, swords everywhere' },
  ];
  it('finds the messages holding the words, any case', () => {
    expect(chatMatches(messages, 'sword')).toEqual(['a', 'c']);
    expect(chatMatches(messages, '  SHIELD ')).toEqual(['b']);
    expect(chatMatches(messages, '')).toEqual([]);
    expect(chatMatches(messages, 'axe')).toEqual([]);
  });
  it('cuts the text at each match', () => {
    expect(splitMatches('swords, Swords', 'sword')).toEqual([
      { text: 'sword', hit: true },
      { text: 's, ', hit: false },
      { text: 'Sword', hit: true },
      { text: 's', hit: false },
    ]);
    expect(splitMatches('nothing', 'x')).toEqual([{ text: 'nothing', hit: false }]);
    expect(splitMatches('aaa', 'a').filter((p) => p.hit)).toHaveLength(3);
  });
});
