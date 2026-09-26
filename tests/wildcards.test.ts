import { describe, expect, it } from 'vitest';
import { analyzeWildcards, randomOptions, referencedEntries, resolveRequestPrompts } from '@/lib/wildcards';
import { CharacterPromptEntry, LibraryTidbit, PromptTidbit } from '@/types/novelai';

const tidbit = (text: string, over: Partial<PromptTidbit> = {}): PromptTidbit => ({
  id: `t-${text}`,
  label: '',
  text,
  enabled: true,
  ...over,
});

const fixed = (id: string, label: string, text: string): LibraryTidbit => ({ id, label, text, kind: 'fixed' });
const random = (id: string, label: string, text: string): LibraryTidbit => ({ id, label, text, kind: 'random' });

const character = (id: string, prompt: string, uc = ''): CharacterPromptEntry => ({
  id,
  prompt,
  uc,
  enabled: true,
  center: { x: 0.5, y: 0.5 },
});

const resolve = (
  baseText: string,
  library: LibraryTidbit[],
  opts: {
    characters?: CharacterPromptEntry[];
    negative?: string;
    negativeTidbits?: PromptTidbit[];
    replay?: Record<string, string[]>;
    force?: Record<string, string>;
  } = {},
) =>
  resolveRequestPrompts(
    { text: baseText },
    opts.characters ?? [],
    { text: opts.negative ?? '', tidbits: opts.negativeTidbits },
    library,
    opts.replay,
    opts.force,
  );

describe('randomOptions', () => {
  it('is one option per line, trimmed, blanks dropped', () => {
    expect(randomOptions(random('a', 'Hair', 'red\n\n  blue,  \n'))).toEqual(['red', 'blue']);
  });
});

describe('resolveRequestPrompts', () => {
  it('leaves archived characters out, even if somehow still enabled', () => {
    const out = resolve('', [], {
      characters: [character('a', '1girl'), { ...character('b', '1boy'), archived: true }],
    });
    expect(out.characters.map((c) => c.id)).toEqual(['a']);
  });

  it('expands a fixed entry in place', () => {
    const library = [fixed('a', 'Style', 'watercolor, soft light')];
    expect(resolve('1girl, __Style__', library).baseText).toBe('1girl, watercolor, soft light');
  });

  it('matches labels ignoring case and surrounding spaces', () => {
    const library = [fixed('a', ' Style ', 'watercolor')];
    expect(resolve('__style__', library).baseText).toBe('watercolor');
  });

  it('leaves an unknown reference as written', () => {
    expect(resolve('1girl, __nope__', []).baseText).toBe('1girl, __nope__');
  });

  it('rolls a random entry and records the pick', () => {
    const library = [random('hair', 'Hair', 'red hair')];
    const out = resolve('1girl, __Hair__', library);
    expect(out.baseText).toBe('1girl, red hair');
    expect(out.picks['base|hair']).toEqual(['red hair']);
  });

  it('records each occurrence separately, and replays them in order', () => {
    const library = [random('hair', 'Hair', 'red\nblue\ngreen')];
    const replayed = resolve('__Hair__ and __Hair__', library, {
      replay: { 'base|hair': ['blue', 'green'] },
    });
    expect(replayed.baseText).toBe('blue and green');
  });

  it('replays a pick even if the option has since been edited away', () => {
    const library = [random('hair', 'Hair', 'red')];
    expect(resolve('__Hair__', library, { replay: { 'base|hair': ['violet'] } }).baseText).toBe('violet');
  });

  it('keys picks per scope, so characters line up on replay', () => {
    const library = [random('hair', 'Hair', 'red')];
    const out = resolve('__Hair__', library, { characters: [character('c1', '__Hair__')] });
    expect(Object.keys(out.picks).sort()).toEqual(['base|hair', 'char:c1|hair']);
  });

  it('lets force pin an entry everywhere, overriding a replay', () => {
    const library = [random('hair', 'Hair', 'red\nblue')];
    const out = resolve('__Hair__', library, {
      characters: [character('c1', '__Hair__')],
      replay: { 'base|hair': ['red'] },
      force: { hair: 'green' },
    });
    expect(out.baseText).toBe('green');
    expect(out.characters[0].prompt).toBe('green');
  });

  it('follows references inside an entry', () => {
    const library = [fixed('a', 'Outer', 'a, __Inner__'), fixed('b', 'Inner', 'b')];
    expect(resolve('__Outer__', library).baseText).toBe('a, b');
  });

  it('stops a self-reference from looping forever', () => {
    const library = [fixed('a', 'Loop', 'x, __Loop__')];
    expect(resolve('__Loop__', library).baseText).toContain('__Loop__');
  });

  describe('tidbits on a negative prompt', () => {
    it('appends the enabled ones, like a base prompt does', () => {
      const out = resolve('1girl', [], {
        negative: 'lowres',
        negativeTidbits: [tidbit('bad hands'), tidbit('watermark', { enabled: false })],
      });
      expect(out.negativePrompt).toBe('lowres, bad hands');
    });

    it('expands references inside them, under the negative’s own scope', () => {
      const library = [random('bad', 'Bad', 'bad hands')];
      const out = resolve('1girl', library, { negative: 'lowres', negativeTidbits: [tidbit('__Bad__')] });
      expect(out.negativePrompt).toBe('lowres, bad hands');
      expect(out.picks['neg|bad']).toEqual(['bad hands']);
    });
  });

  describe('tidbits on a character’s negative', () => {
    it('appends them to that character’s uc only', () => {
      const chars = [
        { ...character('c1', '1girl', 'lowres'), ucTidbits: [tidbit('bad hands')] },
        character('c2', '1boy', 'lowres'),
      ];
      const out = resolve('', [], { characters: chars });
      expect(out.characters[0].uc).toBe('lowres, bad hands');
      expect(out.characters[1].uc).toBe('lowres');
    });

    it('keys their rolls under the character’s uc scope', () => {
      const library = [random('bad', 'Bad', 'bad hands')];
      const chars = [{ ...character('c1', '1girl', ''), ucTidbits: [tidbit('__Bad__')] }];
      const out = resolve('', library, { characters: chars });
      expect(out.picks['charuc:c1|bad']).toEqual(['bad hands']);
    });
  });

  it('drops characters that are off, and resolves the negative prompt', () => {
    const library = [fixed('a', 'Bad', 'bad hands')];
    const out = resolve('1girl', library, {
      characters: [character('c1', 'a'), { ...character('c2', 'b'), enabled: false }],
      negative: '__Bad__',
    });
    expect(out.characters.map((c) => c.id)).toEqual(['c1']);
    expect(out.negativePrompt).toBe('bad hands');
  });
});

describe('analyzeWildcards', () => {
  it('reports unknown references as written', () => {
    const out = analyzeWildcards([{ text: '1girl, __typo__' }], [], { text: '' }, []);
    expect(out.unknown).toEqual(['__typo__']);
    expect(out.usesRandom).toBe(false);
  });

  it('finds random entries reachable through other entries', () => {
    const library = [fixed('a', 'Outer', '__Hair__'), random('hair', 'Hair', 'red\nblue')];
    const out = analyzeWildcards([{ text: '__Outer__' }], [], { text: '' }, library);
    expect(out.usesRandom).toBe(true);
    expect(out.randomEntries.map((e) => e.id)).toEqual(['hair']);
  });

  it('follows every option, not just one roll', () => {
    const library = [random('a', 'Pick', '__Red__\n__Blue__'), fixed('r', 'Red', 'red'), random('b', 'Blue', 'navy\nsky')];
    const out = analyzeWildcards([{ text: '__Pick__' }], [], { text: '' }, library);
    expect(out.randomEntries.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('looks in character prompts, their UC and the negative prompt', () => {
    const library = [random('hair', 'Hair', 'red')];
    const fromCharacter = analyzeWildcards([{ text: '' }], [character('c1', '__Hair__')], { text: '' }, library);
    const fromUc = analyzeWildcards([{ text: '' }], [character('c1', '', '__Hair__')], { text: '' }, library);
    const fromNegative = analyzeWildcards([{ text: '' }], [], { text: '__Hair__' }, library);
    for (const out of [fromCharacter, fromUc, fromNegative]) expect(out.usesRandom).toBe(true);
  });
});

describe('analyzeWildcards and the new tidbit lists', () => {
  const library = [random('hair', 'Hair', 'red')];

  it('looks in a negative prompt’s tidbits', () => {
    const out = analyzeWildcards([{ text: '' }], [], { text: '', tidbits: [tidbit('__Hair__')] }, library);
    expect(out.usesRandom).toBe(true);
  });

  it('looks in a character’s negative tidbits', () => {
    const chars = [{ ...character('c1', '', ''), ucTidbits: [tidbit('__Hair__')] }];
    const out = analyzeWildcards([{ text: '' }], chars, { text: '' }, library);
    expect(out.usesRandom).toBe(true);
  });

  it('reports an unknown reference in them too', () => {
    const out = analyzeWildcards([{ text: '' }], [], { text: '', tidbits: [tidbit('__typo__')] }, []);
    expect(out.unknown).toEqual(['__typo__']);
  });
});

describe('referencedEntries', () => {
  it('collects what an export needs, following references', () => {
    const library = [fixed('a', 'Outer', '__Inner__'), fixed('b', 'Inner', 'b'), fixed('c', 'Unused', 'c')];
    expect(referencedEntries(['__Outer__'], [], library).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('includes entries linked as tidbits', () => {
    const library = [fixed('a', 'Linked', 'a')];
    expect(referencedEntries([], ['a'], library).map((e) => e.id)).toEqual(['a']);
  });
});
