import { describe, expect, it } from 'vitest';
import { formatChat, hideComments } from '@/lib/chatFormat';

describe('hideComments', () => {
  it('leaves out <!-- comments -->, and the lines they leave empty', () => {
    expect(hideComments('Hello <!-- be terse --> there.')).toBe('Hello  there.');
    expect(hideComments('*waves*\n<!-- Notes for the model:\nkeep it slow -->\n"Hi."')).toBe('*waves*\n"Hi."');
    expect(hideComments('<!-- a -->\n\nText\n\n<!-- b -->\n\nMore')).toBe('Text\n\nMore');
    expect(hideComments('No comments here.')).toBe('No comments here.');
  });

  it('hides one still being written to the end', () => {
    expect(hideComments('Hi. <!-- still wri')).toBe('Hi.');
  });
});

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

  it('shows embedded pictures, markdown or HTML', () => {
    expect(formatChat('Hi ![Edith waving](https://example.com/a.png "title") there')).toEqual([
      'Hi ',
      { kind: 'image', src: 'https://example.com/a.png', alt: 'Edith waving' },
      ' there',
    ]);
    expect(formatChat('<img src="https://example.com/b.webp" alt="b" width="300">')).toEqual([{ kind: 'image', src: 'https://example.com/b.webp', alt: 'b' }]);
    expect(formatChat("<IMG alt='c' src='https://example.com/c.png'/>")).toEqual([{ kind: 'image', src: 'https://example.com/c.png', alt: 'c' }]);
  });

  it('shows pictures inside speech and italics', () => {
    expect(formatChat('*holds up ![](https://example.com/p.png)*')).toEqual([{ kind: 'em', children: ['holds up ', { kind: 'image', src: 'https://example.com/p.png', alt: '' }] }]);
  });

  it('leaves anything but web and inline pictures as text', () => {
    expect(formatChat('![x](javascript:alert(1))')).toEqual(['![x](javascript:alert(1))']);
    expect(formatChat('<img src="file:///etc/passwd">')).toEqual(['<img src="file:///etc/passwd">']);
    expect(formatChat('![x](images/a.png) !not an image')).toEqual(['![x](images/a.png) !not an image']);
  });
});
