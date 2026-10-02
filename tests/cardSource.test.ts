import { describe, expect, it } from 'vitest';
import { webLinks } from '@/components/CardSource';

describe("a card's source links", () => {
  it('opens web links only', () => {
    expect(webLinks(['https://chub.ai/characters/a/b', 'http://example.com/x', 'chub:a/b', 'javascript:alert(1)', 'file:///etc/passwd', ' https://cardbox.moe/characters/a/b '])).toEqual([
      'https://chub.ai/characters/a/b',
      'http://example.com/x',
      'https://cardbox.moe/characters/a/b',
    ]);
    expect(webLinks(undefined)).toEqual([]);
  });
});
