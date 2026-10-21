import { describe, expect, it } from 'vitest';
import { EMPTY_TAG_DATA, cleanTagData, newTag, type AppTagData } from '@/lib/appTags';
import { authorTagName, authorsIn, cardAuthor, tagCardsByAuthor } from '@/lib/authorTags';

let n = 0;
const makeId = () => `t${++n}`;
const names = (d: AppTagData, card: string) => (d.map[card] ?? []).map((id) => d.tags.find((t) => t.id === id)?.name);

describe('author tags', () => {
  it("reads a card's author, from its Chub path when the field is blank", () => {
    expect(cardAuthor({ creator: ' zer0gear ' })).toBe('zer0gear');
    expect(cardAuthor({ creator: '', extensions: { chub: { full_path: 'arachnutron/momoe-e1ff' } } })).toBe('arachnutron');
    expect(cardAuthor({ creator: 'Anonymous' })).toBe('');
    expect(cardAuthor({ creator: '', extensions: {} })).toBe('');
  });

  it('sends aliased names to one tag', () => {
    const aliases = { ZER0THGEAR: 'zer0gear', oldname: 'Favourites' };
    expect(authorTagName('zer0thgear', aliases)).toBe('zer0gear');
    expect(authorTagName('OldName', aliases)).toBe('Favourites');
    expect(authorTagName('someone', aliases)).toBe('someone');
  });

  it('tags cards by author, reusing tags by name and keeping one author tag a card', () => {
    const base: AppTagData = { ...EMPTY_TAG_DATA, tags: [newTag('Arachnutron', [], 'mine')] };
    const cards = [
      { id: 'a', author: 'arachnutron' },
      { id: 'b', author: 'zer0gear' },
      { id: 'c', author: 'zer0thgear' },
      { id: 'd', author: '' },
    ];
    const first = tagCardsByAuthor(base, cards, {}, makeId);
    expect(first.changed).toBe(3);
    // The tag you made by hand is used; new ones are marked as author tags.
    expect(names(first.data, 'a')).toEqual(['Arachnutron']);
    expect(first.data.tags.filter((t) => t.author).map((t) => t.name)).toEqual(['zer0gear', 'zer0thgear']);
    expect(first.data.map.d).toBeUndefined();

    // An alias moves zer0thgear's card to zer0gear's tag, taking the old one off.
    const second = tagCardsByAuthor(first.data, cards, { zer0thgear: 'zer0gear' }, makeId);
    expect(second.changed).toBe(1);
    expect(names(second.data, 'c')).toEqual(['zer0gear']);
    // zer0thgear's tag, now on no card, goes; one you'd coloured would stay.
    expect(second.data.tags.map((t) => t.name)).toEqual(['Arachnutron', 'zer0gear']);
    const coloured = { ...first.data, tags: first.data.tags.map((t) => (t.name === 'zer0thgear' ? { ...t, color: '#f00' } : t)) };
    expect(tagCardsByAuthor(coloured, cards, { zer0thgear: 'zer0gear' }, makeId).data.tags.map((t) => t.name)).toContain('zer0thgear');
    // Running again changes nothing.
    expect(tagCardsByAuthor(second.data, cards, { zer0thgear: 'zer0gear' }, makeId).changed).toBe(0);
  });

  it("leaves a card's other tags alone", () => {
    const d: AppTagData = { ...EMPTY_TAG_DATA, tags: [newTag('Fantasy', [], 'f')], map: { a: ['f'] } };
    expect(names(tagCardsByAuthor(d, [{ id: 'a', author: 'x' }], {}, makeId).data, 'a')).toEqual(['Fantasy', 'x']);
  });

  it('counts authors, any case as one', () => {
    expect(authorsIn([{ author: 'Ann' }, { author: 'ann' }, { author: 'Bob' }, { author: '' }])).toEqual([
      { author: 'Ann', cards: 2 },
      { author: 'Bob', cards: 1 },
    ]);
  });

  it('keeps the settings and the marks when saved', () => {
    const saved = cleanTagData({ tags: [{ id: 'x', name: 'x', author: true }], authors: { on: true, aliases: { a: 'b', blank: ' ', bad: 3 } } });
    expect(saved.tags[0].author).toBe(true);
    expect(saved.authors).toEqual({ on: true, aliases: { a: 'b' } });
    expect(cleanTagData({}).authors).toEqual({ on: false, aliases: {} });
  });
});
