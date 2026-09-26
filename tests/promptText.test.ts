import { describe, expect, it } from 'vitest';
import { joinPromptParts, moveItem, moveItemAmong, normalizePromptPart } from '@/lib/promptText';
import { roundToSizeStep } from '@/lib/requestImage';

describe('normalizePromptPart', () => {
  it('strips surrounding whitespace and stray commas', () => {
    expect(normalizePromptPart('  1girl,  ')).toBe('1girl');
    expect(normalizePromptPart(', ,1girl')).toBe('1girl');
    expect(normalizePromptPart(null)).toBe('');
    expect(normalizePromptPart(undefined)).toBe('');
  });

  it('leaves commas inside the text alone', () => {
    expect(normalizePromptPart('1girl, smile')).toBe('1girl, smile');
  });
});

describe('joinPromptParts', () => {
  it('joins with ", " and drops empties', () => {
    expect(joinPromptParts('1girl', '', null, 'smile')).toBe('1girl, smile');
  });

  it('never produces a double comma, whatever the fragments end with', () => {
    // Tag autocomplete leaves a trailing ", " behind, so this is the common case.
    expect(joinPromptParts('1girl, ', ', smile')).toBe('1girl, smile');
  });

  it('is empty when everything is', () => {
    expect(joinPromptParts('', ' ', ',')).toBe('');
  });
});

describe('moveItem', () => {
  it('swaps with the neighbour', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 'up')).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 'down')).toEqual(['a', 'c', 'b']);
  });

  it('returns the same array at either end', () => {
    const items = ['a', 'b'];
    expect(moveItem(items, 0, 'up')).toBe(items);
    expect(moveItem(items, 1, 'down')).toBe(items);
  });
});

describe('roundToSizeStep', () => {
  it('rounds to the nearest multiple of 64, ties going up', () => {
    // The live Enhance case: 1.5x of 832x1216 is 1248x1824, sent as 1280x1856.
    expect(roundToSizeStep(1248)).toBe(1280);
    expect(roundToSizeStep(1824)).toBe(1856);
    expect(roundToSizeStep(1216)).toBe(1216);
    expect(roundToSizeStep(1000)).toBe(1024);
    expect(roundToSizeStep(1001)).toBe(1024);
    expect(roundToSizeStep(992)).toBe(1024); // exactly halfway
  });

  it('never rounds down to nothing', () => {
    expect(roundToSizeStep(1)).toBe(64);
    expect(roundToSizeStep(0)).toBe(64);
  });
});

describe('moveItemAmong', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join('');
  const hideBD = (x: { id: string }) => x.id !== 'b' && x.id !== 'd';

  it('behaves like a plain swap when nothing is hidden', () => {
    expect(ids(moveItemAmong(items, 'c', 'up', () => true))).toBe('acbde');
    expect(ids(moveItemAmong(items, 'c', 'down', () => true))).toBe('abdce');
  });

  it('steps past hidden items to the next shown one', () => {
    expect(ids(moveItemAmong(items, 'c', 'up', hideBD))).toBe('cabde');
    expect(ids(moveItemAmong(items, 'c', 'down', hideBD))).toBe('abdec');
  });

  it('returns the same array with no shown neighbour, or an unknown id', () => {
    expect(moveItemAmong(items, 'a', 'up', hideBD)).toBe(items);
    expect(moveItemAmong(items, 'b', 'up', (x) => x.id === 'b')).toBe(items);
    expect(moveItemAmong(items, 'zz', 'down', () => true)).toBe(items);
  });
});
