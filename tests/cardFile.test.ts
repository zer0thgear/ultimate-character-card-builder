import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { cardCharx, cardPng, importCardFile, importLorebookFile } from '@/lib/cardFile';
import { newCard, newEntry, newLorebook, normalizeCard, toV2, backfillEntryNames, hasMismatchedEntryNames } from '@/lib/cardSpec';
import { buildChunk, readTextChunks, replaceTextChunks, utf8ToBase64 } from '@/lib/png';

/** A 1×1 RGBA PNG, optionally carrying text chunks. */
function tinyPng(text: { keyword: string; text: string }[] = []): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, 1);
  v.setUint32(4, 1);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, buildChunk('IHDR', ihdr), buildChunk('IDAT', new Uint8Array(idat)), buildChunk('IEND', new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return text.length ? replaceTextChunks(png, text) : png;
}

const sample = () => {
  const card = newCard();
  card.data.name = 'Aurélie ✨';
  card.data.description = 'A knight. 日本語 too.';
  card.data.first_mes = 'Hello {{user}}';
  card.data.alternate_greetings = ['Alt one'];
  card.data.group_only_greetings = ['Group hi'];
  card.data.tags = ['fantasy', 'knight'];
  card.data.extensions = { depth_prompt: { prompt: 'x', depth: 4 } };
  card.data.character_book = {
    ...newLorebook(),
    entries: [{ ...newEntry(), keys: ['castle'], content: 'The castle is old.', name: 'Castle', comment: 'Castle' }],
  };
  return card;
};

describe('card PNG export and import', () => {
  it('round-trips a card through a PNG, unicode and extensions intact', async () => {
    const card = sample();
    const png = cardPng(card, tinyPng());
    const back = await importCardFile('x.png', png);
    expect(back.source).toBe('ccv3');
    expect(back.card.data.name).toBe('Aurélie ✨');
    expect(back.card.data.description).toBe('A knight. 日本語 too.');
    expect(back.card.data.extensions).toEqual(card.data.extensions);
    expect(back.card.data.character_book?.entries[0].keys).toEqual(['castle']);
    expect(back.card.data.creation_date).toBeTypeOf('number');
  });

  it('writes both chara (V2) and ccv3 (V3) chunks, and strips the old text', () => {
    const png = cardPng(sample(), tinyPng([{ keyword: 'Comment', text: '{"prompt":"secret"}' }, { keyword: 'chara', text: 'old' }]));
    expect(readTextChunks(png).map((c) => c.keyword).sort()).toEqual(['ccv3', 'chara']);
  });

  it('keeps generation metadata when asked', () => {
    const png = cardPng(sample(), tinyPng([{ keyword: 'Comment', text: '{}' }]), { keepMetadata: true });
    expect(readTextChunks(png).map((c) => c.keyword).sort()).toEqual(['Comment', 'ccv3', 'chara']);
  });

  it('falls back to the chara chunk when there is no ccv3', async () => {
    const png = tinyPng([{ keyword: 'chara', text: utf8ToBase64(JSON.stringify(toV2(sample()))) }]);
    const back = await importCardFile('x.png', png);
    expect(back.source).toBe('chara');
    expect(back.card.data.name).toBe('Aurélie ✨');
    // V2 has no group greetings; they come back empty rather than missing.
    expect(back.card.data.group_only_greetings).toEqual([]);
    expect(readTextChunks(back.avatar!.bytes)).toEqual([]);
  });

  it('rejects a PNG with no card in it', async () => {
    await expect(importCardFile('x.png', tinyPng())).rejects.toThrow(/no character card/);
  });
});

describe('V2 export', () => {
  it('leaves out V3-only fields and repeats V1 fields at the top level', () => {
    const v2 = toV2(sample()) as { spec: string; name: string; data: Record<string, unknown> };
    expect(v2.spec).toBe('chara_card_v2');
    expect(v2.name).toBe('Aurélie ✨');
    expect(v2.data.group_only_greetings).toBeUndefined();
    expect((v2.data.character_book as { entries: Record<string, unknown>[] }).entries[0].use_regex).toBeUndefined();
  });
});

describe('normalizeCard', () => {
  it('reads a V1 card', () => {
    const c = normalizeCard({ name: 'Old', description: 'd', first_mes: 'hi', mes_example: '', personality: '', scenario: '' });
    expect(c?.data.name).toBe('Old');
    expect(c?.data.alternate_greetings).toEqual([]);
  });

  it('prefers data over top-level duplicates, and turns string tags into a list', () => {
    const c = normalizeCard({ spec: 'chara_card_v2', name: 'Top', data: { name: 'Inner', tags: 'a, b,,c' } });
    expect(c?.data.name).toBe('Inner');
    expect(c?.data.tags).toEqual(['a', 'b', 'c']);
  });

  it('keeps unknown fields', () => {
    const c = normalizeCard({ spec: 'chara_card_v3', data: { name: 'X', custom_thing: 42 } });
    expect(c?.data.custom_thing).toBe(42);
  });

  it('is not fooled by a lorebook file', () => {
    expect(normalizeCard({ spec: 'lorebook_v3', data: { entries: [] } })).toBeNull();
  });
});

describe('lorebook files', () => {
  it('imports a standalone lorebook_v3', async () => {
    const file = JSON.stringify({ spec: 'lorebook_v3', data: { name: 'World', entries: [{ keys: ['a'], content: 'A' }] } });
    const book = await importLorebookFile('w.json', new TextEncoder().encode(file));
    expect(book.name).toBe('World');
    expect(book.entries[0].enabled).toBe(true);
  });

  it('imports the SillyTavern world format', async () => {
    const file = JSON.stringify({
      entries: { 0: { uid: 0, key: ['sword'], keysecondary: [], comment: 'Sword', content: 'Sharp.', order: 50, position: 1, disable: false } },
    });
    const book = await importLorebookFile('w.json', new TextEncoder().encode(file));
    expect(book.entries[0]).toMatchObject({ keys: ['sword'], name: 'Sword', comment: 'Sword', insertion_order: 50, position: 'after_char' });
  });

  it('backfills mismatched names and comments', () => {
    const book = { ...newLorebook(), entries: [{ ...newEntry(), name: 'A', comment: '' }, { ...newEntry(), name: '', comment: 'B' }] };
    expect(hasMismatchedEntryNames(book)).toBe(true);
    const fixed = backfillEntryNames(book);
    expect(fixed.entries.map((e) => [e.name, e.comment])).toEqual([['A', 'A'], ['B', 'B']]);
    expect(hasMismatchedEntryNames(fixed)).toBe(false);
  });
});

describe('CHARX', () => {
  it('round-trips the card and its main icon', async () => {
    const avatar = tinyPng();
    const zip = await cardCharx(sample(), { bytes: avatar, ext: 'png' });
    const back = await importCardFile('x.charx', zip);
    expect(back.source).toBe('charx');
    expect(back.card.data.name).toBe('Aurélie ✨');
    expect(back.avatar?.bytes).toEqual(avatar);
    expect(Object.keys((await JSZip.loadAsync(zip)).files)).toContain('assets/icon/images/main.png');
  });
});
