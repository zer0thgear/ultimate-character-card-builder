import { describe, expect, it } from 'vitest';
import { searchLibrary, modelCode, type LibraryItem } from '@/lib/librarySearch';

let n = 0;
const item = (over: Partial<LibraryItem>): LibraryItem => ({
  id: String(n++),
  root: 0,
  rel: 'a.png',
  folder: '',
  name: 'a.png',
  size: 1,
  mtime: 1,
  width: 1,
  height: 1,
  info: {},
  ...over,
});

const items = [
  item({
    name: 'one.png',
    folder: 'elves',
    info: { prompt: '1girl, white hair, smile', model: 'NovelAI Diffusion V4.5 Full', seed: 42, characters: [{ prompt: 'elf, green eyes', uc: '' }] },
  }),
  item({ name: 'two.png', info: { prompt: '1boy, black hair', model: 'NovelAI Diffusion V3', seed: 7 } }),
  item({ name: 'stray.png', info: {} }),
];

const names = (q: string) => searchLibrary(items, q).map((i) => i.name);

describe('searchLibrary', () => {
  it('requires every term and reads | as or', () => {
    expect(names('white hair, smile')).toEqual(['one.png']);
    expect(names('white hair | black hair')).toEqual(['one.png', 'two.png']);
  });

  it('keeps images without the field when a term is negated', () => {
    expect(names('-white hair')).toEqual(['two.png', 'stray.png']);
    expect(names('-model:v3')).toEqual(['one.png', 'stray.png']);
  });

  it('searches fields', () => {
    expect(names('char:elf')).toEqual(['one.png']);
    expect(names('elf')).toEqual(['one.png']);
    expect(names('seed:7')).toEqual(['two.png']);
    expect(names('model:v4.5')).toEqual(['one.png']);
    expect(names('folder:elv')).toEqual(['one.png']);
    expect(names('chars:1+')).toEqual(['one.png']);
  });

  it('knows model codes', () => {
    expect(modelCode('NovelAI Diffusion V4.5 Curated')).toBe('v4.5');
  });
});
