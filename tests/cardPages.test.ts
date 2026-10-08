import { describe, expect, it } from 'vitest';
import { pageOf, pageWith } from '@/lib/cardPages';
import { splitLinks } from '@/lib/importLinks';

const items = Array.from({ length: 7 }, (_, i) => i);

describe('pageOf', () => {
  it('slices a page and counts the pages', () => {
    expect(pageOf(items, 0, 3)).toEqual({ items: [0, 1, 2], page: 0, pages: 3 });
    expect(pageOf(items, 2, 3)).toEqual({ items: [6], page: 2, pages: 3 });
  });
  it('keeps the page in range', () => {
    expect(pageOf(items, 9, 3).page).toBe(2);
    expect(pageOf(items, -1, 3).page).toBe(0);
    expect(pageOf([], 4, 3)).toEqual({ items: [], page: 0, pages: 1 });
  });
  it('shows everything on one page for size 0', () => {
    expect(pageOf(items, 3, 0)).toEqual({ items, page: 0, pages: 1 });
  });
});

describe('pageWith', () => {
  it('finds the page an item is on', () => {
    expect(pageWith(items, (i) => i === 4, 3)).toBe(1);
    expect(pageWith(items, (i) => i === 4, 0)).toBe(0);
    expect(pageWith(items, (i) => i === 42, 3)).toBe(-1);
  });
});

describe('splitLinks', () => {
  it('takes one link per line, skipping blanks and repeats', () => {
    expect(splitLinks(' https://chub.ai/characters/a/b \r\n\nhttps://chub.ai/characters/c/d\nhttps://chub.ai/characters/a/b\n')).toEqual([
      'https://chub.ai/characters/a/b',
      'https://chub.ai/characters/c/d',
    ]);
    expect(splitLinks('   ')).toEqual([]);
  });
});
