import { describe, expect, it } from 'vitest';
import { notesSnippet } from '@/lib/cardSummary';

describe('notesSnippet', () => {
  it('reads creator notes as plain text', () => {
    expect(notesSnippet('<p>A <b>moody</b> knight.</p><br><img src="x.png"> ![art](a.png) See [my page](https://x.y)!')).toBe('A moody knight. See my page!');
    expect(notesSnippet('**Bold** _and_ `code`\n\n\n# Heading &amp; more')).toBe('Bold and code Heading & more');
    expect(notesSnippet('<style>.x{color:red}</style>Hello')).toBe('Hello');
  });

  it('cuts long notes short, and has nothing for none', () => {
    const long = 'word '.repeat(100);
    const s = notesSnippet(long, 20);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(21);
    expect(notesSnippet(undefined)).toBe('');
    expect(notesSnippet('<p> </p>')).toBe('');
  });
});
