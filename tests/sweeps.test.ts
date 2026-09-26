import { describe, expect, it } from 'vitest';
import { axisInfo, parseNumberList, parseTagList, sweepCells, toAxis, NUMERIC_LIMITS } from '@/lib/sweeps';

describe('parseTagList', () => {
  it('splits on top-level commas', () => {
    expect(parseTagList('smile, wink, blush')).toEqual(['smile', 'wink', 'blush']);
  });

  it('keeps brace, bracket and paren groups whole', () => {
    expect(parseTagList('{open mouth, teeth}, [blush], (a, b)')).toEqual(['{open mouth, teeth}', '[blush]', '(a, b)']);
  });

  it('keeps a weighted group whole', () => {
    expect(parseTagList('1.3::looking at viewer, wink::, smile')).toEqual([
      '1.3::looking at viewer, wink::',
      'smile',
    ]);
  });

  it('handles the mixed example from the docs', () => {
    expect(parseTagList('smile, {open mouth, teeth}, 1.3::looking at viewer, wink::')).toEqual([
      'smile',
      '{open mouth, teeth}',
      '1.3::looking at viewer, wink::',
    ]);
  });

  it('handles negative and decimal weights', () => {
    expect(parseTagList('-2::upscaled, blurry::, smile')).toEqual(['-2::upscaled, blurry::', 'smile']);
    expect(parseTagList('.5::a, b::')).toEqual(['.5::a, b::']);
  });

  it('leaves a bare :: alone, since it opens no group', () => {
    expect(parseTagList('text:: hello, smile')).toEqual(['text:: hello', 'smile']);
  });

  it('nests groups', () => {
    expect(parseTagList('{a, [b, c]}, d')).toEqual(['{a, [b, c]}', 'd']);
  });

  it('trims, drops empties and removes duplicates', () => {
    expect(parseTagList('  smile ,, smile , wink ')).toEqual(['smile', 'wink']);
    expect(parseTagList('   ')).toEqual([]);
  });
});

describe('parseNumberList', () => {
  it('splits on commas or spaces and deduplicates', () => {
    expect(parseNumberList('5, 6 7 6', NUMERIC_LIMITS.cfg)).toEqual({ values: ['5', '6', '7'], invalid: [] });
  });

  it('reports what did not parse or was out of range', () => {
    expect(parseNumberList('5, abc, 99', NUMERIC_LIMITS.cfg)).toEqual({ values: ['5'], invalid: ['abc', '99'] });
  });

  it('rejects fractions where the value must be a whole number', () => {
    expect(parseNumberList('28, 28.5', NUMERIC_LIMITS.steps).invalid).toEqual(['28.5']);
    expect(parseNumberList('7.5', NUMERIC_LIMITS.cfg).values).toEqual(['7.5']);
  });

  it('normalises how numbers are written', () => {
    expect(parseNumberList('5.0, 05', NUMERIC_LIMITS.cfg).values).toEqual(['5']);
  });
});

describe('toAxis', () => {
  it('builds a numeric axis', () => {
    expect(toAxis({ key: 'cfg', text: '4, 5, 6', picked: [] }).axis).toEqual({ kind: 'cfg', values: ['4', '5', '6'] });
  });

  it('refuses an empty or invalid list, with a reason', () => {
    expect(toAxis({ key: 'cfg', text: '', picked: [] }).problem).toBe('Enter at least one value');
    expect(toAxis({ key: 'steps', text: '60', picked: [] }).problem).toContain('1–50');
  });

  it('puts the (none) baseline first on a tags axis when asked', () => {
    expect(toAxis({ key: 'tags', text: 'smile, wink', picked: [], baseline: true }).axis).toEqual({
      kind: 'tags',
      values: ['', 'smile', 'wink'],
    });
    expect(toAxis({ key: 'tags', text: 'smile', picked: [], baseline: false }).axis).toEqual({
      kind: 'tags',
      values: ['smile'],
    });
  });

  it('needs at least one chip for the picked kinds', () => {
    expect(toAxis({ key: 'sampler', text: '', picked: [] }).problem).toBe('Pick at least one');
  });

  it('carries the library entry id on a wildcard axis', () => {
    expect(toAxis({ key: 'wildcard:abc', text: '', picked: ['red', 'blue'] }).axis).toEqual({
      kind: 'wildcard',
      entryId: 'abc',
      values: ['red', 'blue'],
    });
  });

  it('gives no axis at all for "none"', () => {
    expect(toAxis({ key: 'none', text: '', picked: [] })).toEqual({});
  });
});

describe('sweepCells', () => {
  const cfg = { kind: 'cfg' as const, values: ['4', '5'] };
  const steps = { kind: 'steps' as const, values: ['20', '28', '36'] };

  it('runs X inside Y, row by row', () => {
    const cells = sweepCells(cfg, steps);
    expect(cells).toHaveLength(6);
    expect(cells.map((c) => [c.xIndex, c.yIndex])).toEqual([
      [0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2],
    ]);
    expect(cells[3]).toMatchObject({ scale: 5, steps: 28 });
  });

  it('leaves yIndex unset for a single axis', () => {
    expect(sweepCells(cfg).map((c) => c.yIndex)).toEqual([undefined, undefined]);
  });

  it('combines tags from both axes', () => {
    const cells = sweepCells({ kind: 'tags', values: ['', 'smile'] }, { kind: 'tags', values: ['wink'] });
    expect(cells.map((c) => c.tags)).toEqual(['wink', 'smile, wink']);
  });

  it('pins a wildcard entry per cell', () => {
    const cells = sweepCells({ kind: 'wildcard', entryId: 'hair', values: ['red', 'blue'] });
    expect(cells.map((c) => c.force)).toEqual([{ hair: 'red' }, { hair: 'blue' }]);
  });
});

describe('axisInfo', () => {
  it('names the axis and labels an empty tags value as (none)', () => {
    expect(axisInfo({ kind: 'tags', values: ['', 'smile'] }, [])).toEqual({
      name: 'Tags',
      values: ['(none)', 'smile'],
    });
  });

  it('names a wildcard axis after its library entry', () => {
    const library = [{ id: 'hair', label: ' Hair colour ', text: 'red\nblue', kind: 'random' as const }];
    expect(axisInfo({ kind: 'wildcard', entryId: 'hair', values: ['red'] }, library).name).toBe('Hair colour');
    expect(axisInfo({ kind: 'wildcard', entryId: 'gone', values: ['red'] }, library).name).toBe('Wildcard');
  });
});
