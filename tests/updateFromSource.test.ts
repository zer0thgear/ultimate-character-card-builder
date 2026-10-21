import { describe, expect, it } from 'vitest';
import { changedFields, sourceLinks } from '@/lib/importLinks';

describe('updating a card from its source', () => {
  it('fetches from Chub or Cardbox first, then other links, then the Chub page its metadata names', () => {
    expect(
      sourceLinks({
        source: ['https://example.com/some-card', 'https://cardbox.moe/characters/a/b', 'not a link', 'https://chub.ai/characters/a/b'],
        extensions: { chub: { full_path: 'a/b' } },
      }),
    ).toEqual(['https://cardbox.moe/characters/a/b', 'https://chub.ai/characters/a/b', 'https://example.com/some-card']);
    // A card saved from Chub as a file: its page, from the metadata.
    expect(sourceLinks({ extensions: { chub: { full_path: 'arachnutron/momoe-e1ff' } } })).toEqual(['https://chub.ai/characters/arachnutron/momoe-e1ff']);
    expect(sourceLinks({ source: [], extensions: { chub: { full_path: 'lorebooks/x/y' } } })).toEqual([]);
    expect(sourceLinks({})).toEqual([]);
  });

  it('says what changed, and nothing when only dates, sources or key order differ', () => {
    const before = { name: 'Ann', description: 'Old.', alternate_greetings: ['Hi'], extensions: { a: 1, b: { c: 2, d: 3 } }, creation_date: 1, source: ['x'], nickname: '' };
    const same = { name: 'Ann', description: 'Old.', alternate_greetings: ['Hi'], extensions: { b: { d: 3, c: 2 }, a: 1 }, creation_date: 2, source: ['x', 'y'] };
    expect(changedFields(before, same)).toEqual([]);
    const after = { ...same, description: 'New.', alternate_greetings: ['Hi', 'Hey'], mes_example: '<START>', character_book: { entries: [] } };
    expect(changedFields(before, after)).toEqual(['description', 'greetings', 'example messages', 'lorebook']);
  });
});
