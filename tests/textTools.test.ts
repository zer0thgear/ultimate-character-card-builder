import { describe, expect, it } from 'vitest';
import { findReplace, purgeAsterisks, nameToMacro, straightenQuotes, tidyWhitespace } from '@/lib/textTools';
import { getPath, setPath, listTextFields } from '@/lib/cardPath';
import { newCard, newEntry, newLorebook } from '@/lib/cardSpec';
import type { FieldGroup } from '@/lib/cardPath';

const ALL: FieldGroup[] = ['character', 'greetings', 'prompts', 'lorebook', 'creator'];

const card = () => {
  const d = newCard().data;
  d.name = 'Ann';
  d.description = 'Ann is *very* tall. Annie is not Ann.';
  d.first_mes = '*waves* Hi! * not this';
  d.alternate_greetings = ['“Hello,” she said. It’s Ann.'];
  d.character_book = { ...newLorebook(), entries: [{ ...newEntry(), content: 'Ann owns a cat.' }] };
  return d;
};

describe('card paths', () => {
  it('reads and writes nested fields without mutating', () => {
    const d = card();
    const next = setPath(d, 'character_book.entries.0.content', 'New.');
    expect(getPath(next, 'character_book.entries.0.content')).toBe('New.');
    expect(getPath(d, 'character_book.entries.0.content')).toBe('Ann owns a cat.');
    expect(getPath(setPath(d, 'alternate_greetings.0', 'x'), 'alternate_greetings.0')).toBe('x');
  });

  it('lists greetings after the first message', () => {
    const paths = listTextFields(card()).map((f) => f.path);
    expect(paths.indexOf('alternate_greetings.0')).toBe(paths.indexOf('first_mes') + 1);
  });
});

describe('text tools', () => {
  it('finds and replaces in chosen groups only, counting per field', () => {
    const r = findReplace(card(), { find: 'ann', replace: 'Bea', regex: false, caseSensitive: false, wholeWord: true, groups: ['character'] });
    if (typeof r === 'string') throw new Error(r);
    expect(r.data.description).toBe('Bea is *very* tall. Annie is not Bea.');
    expect(r.changes).toEqual({ description: 2 });
    expect(r.data.alternate_greetings[0]).toContain('Ann');
  });

  it('supports regex groups in the replacement', () => {
    const r = findReplace(card(), { find: '(\\w+) is', replace: '$1 was', regex: true, caseSensitive: true, wholeWord: false, groups: ['character'] });
    if (typeof r === 'string') throw new Error(r);
    expect(r.data.description).toBe('Ann was *very* tall. Annie was not Ann.');
  });

  it('reports a bad pattern', () => {
    expect(typeof findReplace(card(), { find: '(', replace: '', regex: true, caseSensitive: false, wholeWord: false, groups: ALL })).toBe('string');
  });

  it('purges paired asterisks only', () => {
    const r = purgeAsterisks(card(), ALL);
    expect(r.data.first_mes).toBe('waves Hi! * not this');
    expect(r.data.description).toBe('Ann is very tall. Annie is not Ann.');
  });

  it("swaps the name for {{char}}, leaving longer names alone", () => {
    const r = nameToMacro(card(), ALL);
    expect(r.data.description).toBe('{{char}} is *very* tall. Annie is not {{char}}.');
    expect(r.data.character_book!.entries[0].content).toBe('{{char}} owns a cat.');
  });

  it('straightens quotes and tidies whitespace', () => {
    expect(straightenQuotes(card(), ALL).data.alternate_greetings[0]).toBe('"Hello," she said. It\'s Ann.');
    const d = { ...card(), scenario: '\n\nA  \n\n\n\nB  \n' };
    expect(tidyWhitespace(d, ALL).data.scenario).toBe('A\n\nB');
  });
});
