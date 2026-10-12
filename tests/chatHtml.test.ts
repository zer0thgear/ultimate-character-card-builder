import { describe, expect, it } from 'vitest';
import { hasHtml, messageHtml, pageSrcdoc, splitHtmlPages } from '@/lib/chatHtml';

describe('HTML in chat messages', () => {
  it('tells HTML from the tags the plain formatter shows', () => {
    expect(hasHtml('*waves* "hi"')).toBe(false);
    expect(hasHtml('<img src="https://x/a.png"> <hr>')).toBe(false);
    expect(hasHtml('a <details><summary>x</summary>y</details>')).toBe(true);
    expect(hasHtml('2 < 3 and 4 > 1')).toBe(false);
  });

  it('formats the text between tags, never inside them', () => {
    const html = messageHtml('<div class="box" title="a *b* c">*She waves.* "Hi!"</div>');
    expect(html).toBe('<div class="box" title="a *b* c"><em>She waves.</em> <q>"Hi!"</q></div>');
  });

  it('keeps styles, leaves out scripts and the layout between tags', () => {
    const html = messageHtml('<style>.x{color:red}</style>\n<div class="x">\n  <details>\n    <summary>Plan</summary>\nThink.\n  </details>\n</div>\n<script>alert(1)</script>');
    expect(html).toBe('<style>.x{color:red}</style><div class="x"><details><summary>Plan</summary>Think.</details></div>');
  });

  it('keeps line breaks beside inline tags', () => {
    expect(messageHtml('One.\n<span>Two.</span>\nThree.')).toBe('One.\n<span>Two.</span>\nThree.');
  });

  it('shows tags in code as text', () => {
    expect(messageHtml('<b>x</b> `<i>`')).toBe('<b>x</b> <code>&lt;i&gt;</code>');
  });

  it('doesn\'t run a link into the tag after it', () => {
    expect(messageHtml('<p>https://example.com</p>')).toBe('<p><a href="https://example.com">https://example.com</a></p>');
  });

  it('splits out code blocks holding a whole page', () => {
    const page = '<!DOCTYPE html>\n<html><body><p>hi</p></body></html>';
    const parts = splitHtmlPages(`Before.\n\`\`\`\n${page}\n\`\`\`\nAfter.\n\`\`\`js\nlet x = '<b>';\n\`\`\``);
    expect(parts).toEqual([
      { kind: 'text', text: 'Before.\n' },
      { kind: 'page', html: page },
      { kind: 'text', text: "\nAfter.\n```js\nlet x = '<b>';\n```" },
    ]);
    // Still being written: shown as code until it's closed.
    expect(splitHtmlPages('```\n<html><body>')).toEqual([{ kind: 'text', text: '```\n<html><body>' }]);
  });

  it('adds a height report to a page', () => {
    expect(pageSrcdoc('<html><body>x</body></html>')).toMatch(/x<script>[\s\S]*uccbHtml[\s\S]*<\/script><\/body><\/html>$/);
    expect(pageSrcdoc('<div>x</div>')).toMatch(/<div>x<\/div><script>[\s\S]*uccbHtml[\s\S]*<\/script>$/);
  });
});
