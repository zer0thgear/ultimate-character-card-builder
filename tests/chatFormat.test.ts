import { describe, expect, it } from 'vitest';
import { formatChat } from '@/lib/chatFormat';

describe('formatChat', () => {
  it('styles actions, bold and speech', () => {
    expect(formatChat('*waves* "Hi!" **really**')).toEqual([
      { kind: 'em', children: ['waves'] },
      ' ',
      { kind: 'quote', children: ['"Hi!"'] },
      ' ',
      { kind: 'strong', children: ['really'] },
    ]);
  });

  it('renders italics inside speech', () => {
    expect(formatChat('"We really, *really* owe you one."')).toEqual([
      { kind: 'quote', children: ['"We really, ', { kind: 'em', children: ['really'] }, ' owe you one."'] },
    ]);
  });

  it('renders speech inside italics', () => {
    expect(formatChat('*she whispers "hello" and leaves*')).toEqual([
      { kind: 'em', children: ['she whispers ', { kind: 'quote', children: ['"hello"'] }, ' and leaves'] },
    ]);
  });

  it('handles curly quotes and underscores, but not snake_case', () => {
    expect(formatChat('“Yes,” she said. _Sure._ my_var')).toEqual([
      { kind: 'quote', children: ['“Yes,”'] },
      ' she said. ',
      { kind: 'em', children: ['Sure.'] },
      ' my_var',
    ]);
  });

  it("doesn't span lines or pair a lone marker", () => {
    expect(formatChat('a *b\nc* d')).toEqual(['a *b\nc* d']);
    expect(formatChat('5 * 3 = 15 "unclosed')).toEqual(['5 * 3 = 15 "unclosed']);
  });
});
