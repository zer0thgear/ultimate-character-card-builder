import { describe, expect, it } from 'vitest';
import { createLinkedTidbit, entryUses, tidbitToLibrary, uniqueLabel, unlinkTidbit } from '@/lib/promptTidbits';
import { resolveRequestPrompts } from '@/lib/wildcards';
import { LibraryTidbit, PromptTidbit } from '@/types/novelai';

const tidbit = (label: string, text: string, over: Partial<PromptTidbit> = {}): PromptTidbit => ({ id: `t-${label}`, label, text, enabled: true, ...over });
const fixed = (id: string, label: string, text: string): LibraryTidbit => ({ id, label, text, kind: 'fixed' });
const random = (id: string, label: string, text: string): LibraryTidbit => ({ id, label, text, kind: 'random' });

describe('prompt tidbits in a request', () => {
  it('adds enabled tidbits after the scene, skipping switched-off ones', () => {
    const out = resolveRequestPrompts(
      { text: 'indoors', tidbits: [tidbit('Light', 'warm lighting'), tidbit('Off', 'rain', { enabled: false })] },
      [],
      { text: '' },
      [],
    );
    expect(out.baseText).toBe('indoors, warm lighting');
  });

  it('uses a linked entry’s current text, not the snapshot', () => {
    const entry = fixed('e1', 'Outfit', 'red dress');
    const linked = createLinkedTidbit(entry);
    const out = resolveRequestPrompts({ text: '', tidbits: [linked] }, [], { text: '' }, [{ ...entry, text: 'blue coat' }]);
    expect(out.baseText).toBe('blue coat');
  });

  it('folds a character’s tidbits into that character', () => {
    const out = resolveRequestPrompts(
      { text: '' },
      [{ id: 'c1', prompt: '1girl', uc: '', ucTidbits: [tidbit('No hat', 'hat')], tidbits: [tidbit('Eyes', 'red eyes')], enabled: true, center: { x: 0.5, y: 0.5 } }],
      { text: '' },
      [],
    );
    expect(out.characters[0].prompt).toBe('1girl, red eyes');
    expect(out.characters[0].uc).toBe('hat');
  });
});

describe('unlinkTidbit', () => {
  it('takes the entry’s current text and drops the link', () => {
    const entry = fixed('e1', 'Outfit', 'red dress');
    const t = unlinkTidbit({ ...createLinkedTidbit(entry), text: 'old' }, [entry]);
    expect(t.sourceId).toBeUndefined();
    expect(t.text).toBe('red dress');
  });

  it('keeps a random entry random by naming it', () => {
    const entry = random('e1', 'Hair', 'blonde\nred');
    expect(unlinkTidbit(createLinkedTidbit(entry), [entry]).text).toBe('__Hair__');
  });

  it('keeps the snapshot when the entry is gone', () => {
    const t = unlinkTidbit(tidbit('Outfit', 'red dress', { sourceId: 'gone' }), []);
    expect(t).toEqual(tidbit('Outfit', 'red dress'));
  });
});

describe('tidbitToLibrary', () => {
  it('makes a fixed entry and links the tidbit to it', () => {
    const { entry, tidbit: t } = tidbitToLibrary(tidbit('Outfit', 'red dress', { enabled: false }));
    expect(entry).toMatchObject({ label: 'Outfit', text: 'red dress', kind: 'fixed' });
    expect(t).toMatchObject({ sourceId: entry.id, enabled: false, text: 'red dress' });
  });
});

describe('uniqueLabel', () => {
  const library = [fixed('a', 'Outfit', ''), fixed('b', 'outfit 2', '')];
  it('numbers a taken label, ignoring case', () => expect(uniqueLabel('outfit', library)).toBe('outfit 3'));
  it('keeps a free one', () => expect(uniqueLabel('Hair', library)).toBe('Hair'));
  it('lets an entry keep its own label', () => expect(uniqueLabel('Outfit', library, 'a')).toBe('Outfit'));
});

describe('entryUses', () => {
  it('counts links and references, in text and in inline tidbits', () => {
    const entry = fixed('e1', 'Outfit', 'red dress');
    const n = entryUses(entry, ['1girl, __outfit__', 'nothing'], [[tidbit('a', '', { sourceId: 'e1' }), tidbit('b', '__Outfit__')], undefined]);
    expect(n).toBe(3);
  });
});
