import { describe, expect, it } from 'vitest';
import { scanLorebook, matchingKey } from '@/lib/lorebookScan';
import { newEntry, newLorebook } from '@/lib/cardSpec';
import type { LorebookEntry } from '@/types/card';

const entry = (over: Partial<LorebookEntry>): LorebookEntry => ({ ...newEntry(), content: 'x', ...over });
const book = (entries: LorebookEntry[], over = {}) => ({ ...newLorebook(), entries, ...over });

describe('matchingKey', () => {
  it('matches whole words, case-insensitively by default', () => {
    expect(matchingKey(['cat'], 'The Cat sat', entry({}))).toBe('cat');
    expect(matchingKey(['cat'], 'concatenate', entry({}))).toBeNull();
    expect(matchingKey(['Cat'], 'the cat', entry({ case_sensitive: true }))).toBeNull();
  });

  it('takes /regex/ keys', () => {
    expect(matchingKey(['/dra(g|k)on/i'], 'a DRAKON appears', entry({}))).toBe('/dra(g|k)on/i');
  });
});

describe('scanLorebook', () => {
  it('fires on keys in the last scan_depth messages only', () => {
    const b = book([entry({ keys: ['sword'], content: 'Sword lore' })], { scan_depth: 1 });
    expect(scanLorebook(b, ['sword!', 'hello']).active).toHaveLength(0);
    expect(scanLorebook(b, ['hello', 'my sword']).active).toHaveLength(1);
  });

  it('always includes constant entries and never disabled ones', () => {
    const b = book([entry({ constant: true, content: 'Always' }), entry({ keys: ['a'], enabled: false })]);
    expect(scanLorebook(b, ['a']).active.map((a) => a.reason)).toEqual(['constant']);
  });

  it('needs a secondary key for selective entries', () => {
    const b = book([entry({ keys: ['king'], selective: true, secondary_keys: ['crown'] })]);
    expect(scanLorebook(b, ['the king']).active).toHaveLength(0);
    expect(scanLorebook(b, ['the king and his crown']).active[0].reason).toBe('king + crown');
  });

  it('scans fired content when recursive', () => {
    const entries = [entry({ keys: ['a'], content: 'mentions b' }), entry({ keys: ['b'], content: 'B lore' })];
    expect(scanLorebook(book(entries), ['a']).active).toHaveLength(1);
    expect(scanLorebook(book(entries, { recursive_scanning: true }), ['a']).active).toHaveLength(2);
  });

  it('orders by insertion_order and drops low priority past the budget', () => {
    const entries = [
      entry({ keys: ['x'], content: 'a'.repeat(40), insertion_order: 5, priority: 1 }),
      entry({ keys: ['x'], content: 'b'.repeat(40), insertion_order: 1, priority: 9 }),
      entry({ keys: ['x'], content: 'c'.repeat(40), insertion_order: 3, priority: 5 }),
    ];
    const r = scanLorebook(book(entries, { token_budget: 20 }), ['x']);
    expect(r.active.map((a) => a.entry.content[0])).toEqual(['b', 'c']);
    expect(r.dropped.map((a) => a.entry.content[0])).toEqual(['a']);
  });

  it("falls back on the chat's defaults where the lorebook sets none", () => {
    const deep = book([entry({ keys: ['sword'] })]);
    expect(scanLorebook(deep, ['sword', 'a', 'b']).active).toHaveLength(0);
    expect(scanLorebook(deep, ['sword', 'a', 'b'], { defaults: { scanDepth: 3 } }).active).toHaveLength(1);
    // The lorebook's own depth wins.
    expect(scanLorebook({ ...deep, scan_depth: 1 }, ['sword', 'a', 'b'], { defaults: { scanDepth: 3 } }).active).toHaveLength(0);

    const two = [entry({ keys: ['x'], content: 'a'.repeat(40), priority: 2 }), entry({ keys: ['x'], content: 'b'.repeat(40), priority: 1 })];
    expect(scanLorebook(book(two), ['x'], { defaults: { tokenBudget: 0 } }).active).toHaveLength(2);
    expect(scanLorebook(book(two), ['x'], { defaults: { tokenBudget: 15 } }).active).toHaveLength(1);
    expect(scanLorebook(book(two, { token_budget: 100 }), ['x'], { defaults: { tokenBudget: 15 } }).active).toHaveLength(2);

    // A chain a → b → c → d: each recursion step reaches one further.
    const chain = [entry({ keys: ['a'], content: 'b' }), entry({ keys: ['b'], content: 'c' }), entry({ keys: ['c'], content: 'd' }), entry({ keys: ['d'], content: 'end' })];
    const rec = book(chain, { recursive_scanning: true });
    expect(scanLorebook(rec, ['a'], { defaults: { maxRecursion: 2 } }).active).toHaveLength(2);
    expect(scanLorebook(rec, ['a']).active).toHaveLength(4);
  });
});

describe("SillyTavern's entry rules", () => {
  const st = (over: Partial<LorebookEntry>, ext: Record<string, unknown>) => entry({ ...over, extensions: { selectiveLogic: 0, ...ext } });

  it('applies secondary-key logic', () => {
    const sec = { keys: ['king'], selective: true, secondary_keys: ['crown', 'throne'] };
    const fires = (logic: number, text: string) => scanLorebook(book([st(sec, { selectiveLogic: logic })]), [text]).active.length === 1;
    // AND ANY
    expect(fires(0, 'king crown')).toBe(true);
    expect(fires(0, 'king')).toBe(false);
    // NOT ALL
    expect(fires(1, 'king crown')).toBe(true);
    expect(fires(1, 'king crown throne')).toBe(false);
    // NOT ANY
    expect(fires(2, 'king')).toBe(true);
    expect(fires(2, 'king throne')).toBe(false);
    // AND ALL
    expect(fires(3, 'king crown throne')).toBe(true);
    expect(fires(3, 'king crown')).toBe(false);
  });

  it('honours whole words, case and the entry scan depth', () => {
    expect(scanLorebook(book([st({ keys: ['cat'] }, { match_whole_words: false })]), ['concatenate']).active).toHaveLength(1);
    expect(scanLorebook(book([st({ keys: ['Cat'] }, { case_sensitive: true })]), ['cat']).active).toHaveLength(0);
    expect(scanLorebook(book([st({ keys: ['sword'] }, { scan_depth: 3 })]), ['sword', 'a', 'b']).active).toHaveLength(1);
  });

  it('rolls the trigger %', () => {
    const b = book([st({ keys: ['x'] }, { probability: 30, useProbability: true })]);
    expect(scanLorebook(b, ['x'], { random: () => 0.2 }).active).toHaveLength(1);
    const miss = scanLorebook(b, ['x'], { random: () => 0.5 });
    expect(miss.active).toHaveLength(0);
    expect(miss.skipped?.[0].reason).toMatch(/30% roll failed/);
    // useProbability off: always.
    expect(scanLorebook(book([st({ keys: ['x'] }, { probability: 30, useProbability: false })]), ['x'], { random: () => 0.9 }).active).toHaveLength(1);
  });

  it('keeps one entry per inclusion group', () => {
    const a = st({ keys: ['x'], content: 'A', insertion_order: 1 }, { group: 'mood' });
    const b = st({ keys: ['x'], content: 'B', insertion_order: 2 }, { group: 'mood', group_weight: 300 });
    expect(scanLorebook(book([a, b]), ['x'], { random: () => 0.1 }).active.map((r) => r.entry.content)).toEqual(['A']);
    expect(scanLorebook(book([a, b]), ['x'], { random: () => 0.9 }).active.map((r) => r.entry.content)).toEqual(['B']);
    const over = st({ keys: ['x'], content: 'O', insertion_order: 0 }, { group: 'mood', group_override: true });
    expect(scanLorebook(book([a, b, over]), ['x'], { random: () => 0.9 }).active.map((r) => r.entry.content)).toEqual(['O']);
    // Scoring keeps the entry with the most matching keys.
    const s1 = st({ keys: ['x'], content: 'one' }, { group: 'g', use_group_scoring: true });
    const s2 = st({ keys: ['x', 'y'], content: 'two' }, { group: 'g', use_group_scoring: true });
    expect(scanLorebook(book([s1, s2]), ['x y'], { random: () => 0 }).active.map((r) => r.entry.content)).toEqual(['two']);
  });

  it('follows the recursion switches', () => {
    const chain = (ext: Record<string, unknown>, ext2: Record<string, unknown> = {}) =>
      scanLorebook(book([st({ keys: ['a'], content: 'b' }, ext), st({ keys: ['b'], content: 'B' }, ext2)], { recursive_scanning: true }), ['a']).active.length;
    expect(chain({})).toBe(2);
    expect(chain({ prevent_recursion: true })).toBe(1);
    expect(chain({}, { exclude_recursion: true })).toBe(1);
    // Delayed until recursion: only fires from another entry's content.
    const delayed = book([st({ keys: ['a'], content: 'x' }, { delay_until_recursion: true })], { recursive_scanning: true });
    expect(scanLorebook(delayed, ['a']).active).toHaveLength(0);
  });

  it('waits out a delay', () => {
    const b = book([st({ keys: ['x'] }, { delay: 3 })]);
    expect(scanLorebook(b, ['g', 'x']).active).toHaveLength(0);
    expect(scanLorebook(b, ['g', 'a', 'x']).active).toHaveLength(1);
  });

  it('keeps sticky entries in and cools entries down, replaying the chat', () => {
    // greeting, user, reply, user, reply, user: replies at 2 and 4.
    const chat = ['hi', 'x', 'r', 'nothing', 'r', 'still nothing'];
    const sticky = book([st({ keys: ['x'] }, { sticky: 3 })], { scan_depth: 1 });
    // Fired at length 2 (the first reply), stays until length 5.
    expect(scanLorebook(sticky, chat.slice(0, 4), { generatedAt: [2] }).active[0]?.reason).toBe('sticky');
    expect(scanLorebook(sticky, chat, { generatedAt: [2, 4] }).active).toHaveLength(0);

    const cool = book([st({ keys: ['x'] }, { cooldown: 3 })], { scan_depth: 1 });
    const again = ['hi', 'x', 'r', 'x'];
    const r = scanLorebook(cool, again, { generatedAt: [2] });
    expect(r.active).toHaveLength(0);
    expect(r.skipped?.[0].reason).toMatch(/cooling down/);
    expect(scanLorebook(cool, [...again, 'r', 'x'], { generatedAt: [2, 4] }).active).toHaveLength(1);
  });

  it('lets entries that ignore the budget past it', () => {
    const big = st({ keys: ['x'], content: 'a'.repeat(400), priority: 0 }, { ignore_budget: true });
    const small = st({ keys: ['x'], content: 'b'.repeat(40), priority: 9 }, {});
    const r = scanLorebook(book([big, small], { token_budget: 20 }), ['x']);
    // It still counts, as in SillyTavern, so it can crowd others out.
    expect(r.active.map((a) => a.entry.content[0])).toEqual(['a']);
    expect(r.dropped.map((a) => a.entry.content[0])).toEqual(['b']);
  });
});
