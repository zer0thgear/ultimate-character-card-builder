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
});
