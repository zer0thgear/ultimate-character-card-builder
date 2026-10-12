import { describe, expect, it } from 'vitest';
import { BRIDGE_SCRIPT, parseSlash } from '@/lib/pageBridge';
import { pageSrcdoc } from '@/lib/chatHtml';

describe('page bridge', () => {
  it('reads the slash commands option bars use, chained with |', () => {
    expect(parseSlash('/setinput Go left')).toEqual({ steps: [{ op: 'setinput', text: 'Go left' }] });
    expect(parseSlash('/send Buy snacks | /trigger')).toEqual({ steps: [{ op: 'send', text: 'Buy snacks' }, { op: 'trigger' }] });
    expect(parseSlash('/send compact=true A \\| B|/trigger await=true')).toEqual({ steps: [{ op: 'send', text: 'A | B' }, { op: 'trigger' }] });
    expect(parseSlash('/echo hi')).toEqual({ steps: [{ op: 'echo', text: 'hi' }] });
  });

  it("refuses what it can't do", () => {
    expect(parseSlash('/send')).toEqual({ error: '/send needs some text.' });
    expect('error' in parseSlash('/sendas name=Bob hi')).toBe(true);
    expect('error' in parseSlash('/send hi | /delmode')).toBe(true);
    expect('error' in parseSlash('hello')).toBe(true);
    expect('error' in parseSlash('')).toBe(true);
  });

  it('starts every page with the bridge, keeping its doctype first', () => {
    const page = pageSrcdoc('<!DOCTYPE html>\n<html><head><title>x</title></head><body>x</body></html>');
    expect(page.startsWith(`<!DOCTYPE html>${BRIDGE_SCRIPT}`)).toBe(true);
    expect(pageSrcdoc('<html><body>x</body></html>').startsWith(`<html>${BRIDGE_SCRIPT}`)).toBe(true);
    expect(pageSrcdoc('<div>x</div>').startsWith(`${BRIDGE_SCRIPT}<div>`)).toBe(true);
  });
});
