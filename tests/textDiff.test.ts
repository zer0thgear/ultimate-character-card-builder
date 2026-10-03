import { describe, expect, it } from 'vitest';
import { cardChanges, diffText } from '@/lib/textDiff';
import { newCard } from '@/lib/cardSpec';

describe('diffText', () => {
  it('marks the words added and taken out', () => {
    expect(diffText('the quick brown fox', 'the slow brown fox jumps')).toEqual([
      { kind: 'same', text: 'the ' },
      { kind: 'removed', text: 'quick' },
      { kind: 'added', text: 'slow' },
      { kind: 'same', text: ' brown fox' },
      { kind: 'added', text: ' jumps' },
    ]);
    expect(diffText('same', 'same')).toEqual([{ kind: 'same', text: 'same' }]);
    expect(diffText('', 'new')).toEqual([{ kind: 'added', text: 'new' }]);
  });

  it('calls a huge change all replaced rather than taking forever', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join(' ');
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join(' ');
    expect(diffText(a, b).map((p) => p.kind)).toEqual(['removed', 'added']);
  });
});

describe('cardChanges', () => {
  it('lists the fields that differ', () => {
    const a = newCard().data;
    const b = { ...a, name: 'Ann', description: 'New.', alternate_greetings: ['Hi'], tags: ['x'] };
    expect(cardChanges(a, b).map((c) => c.label)).toEqual(['Name', 'Description', 'Alternate greeting #1', 'Tags']);
    expect(cardChanges(a, a)).toEqual([]);
  });
});
