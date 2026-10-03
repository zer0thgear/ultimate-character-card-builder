import { describe, expect, it } from 'vitest';
import { REGEX_PLACEMENT, cardRegexScripts, runRegexScript, runRegexScripts, type RegexScript } from '@/lib/regexScripts';
import { buildChatPrompt, DEFAULT_CHAT_SETTINGS, newMessage, shownText } from '@/lib/chatPrompt';
import { newCard, newEntry, newLorebook } from '@/lib/cardSpec';

const script = (over: Partial<RegexScript>): RegexScript => ({
  scriptName: 's',
  findRegex: '',
  replaceString: '',
  trimStrings: [],
  placement: [REGEX_PLACEMENT.aiOutput],
  disabled: false,
  markdownOnly: false,
  promptOnly: false,
  substituteRegex: 0,
  ...over,
});
const id = (t: string) => t;

describe('regex scripts', () => {
  it('reads them from the card, filling gaps', () => {
    const s = cardRegexScripts({ extensions: { regex_scripts: [{ scriptName: 'Hide', findRegex: '/x/g', placement: [2] }, 'junk'] } });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ scriptName: 'Hide', replaceString: '', disabled: false, markdownOnly: false });
  });

  it('replaces with {{match}}, groups (trimmed) and macros', () => {
    const macros = (t: string) => t.replace(/\{\{char\}\}/g, 'Ann');
    expect(runRegexScript(script({ findRegex: '/(\\w+)!/g', replaceString: '[{{match}}|$1|{{char}}]' }), 'hi! yo!', macros)).toBe('[hi!|hi|Ann] [yo!|yo|Ann]');
    expect(runRegexScript(script({ findRegex: '/<b>(.*?)<\\/b>/', replaceString: '$1', trimStrings: ['*'] }), '<b>*bold*</b>', id)).toBe('bold');
    expect(runRegexScript(script({ findRegex: '/(?<who>\\w+) waves/', replaceString: '$<who> nods' }), 'Ann waves', id)).toBe('Ann nods');
  });

  it('fills macros into the pattern when asked', () => {
    const macros = (t: string) => t.replace('{{char}}', 'A.n');
    expect(runRegexScript(script({ findRegex: '/{{char}}/g', replaceString: 'X', substituteRegex: 1 }), 'Ann A.n', macros)).toBe('X X');
    expect(runRegexScript(script({ findRegex: '/{{char}}/g', replaceString: 'X', substituteRegex: 2 }), 'Ann A.n', macros)).toBe('Ann X');
  });

  it('keeps to its placement, target and depth', () => {
    const run = (s: RegexScript, target: 'display' | 'prompt', depth?: number, placement: 1 | 2 = 2) => runRegexScripts([s], 'secret', { placement, target, depth, macros: id });
    const s = script({ findRegex: '/secret/', replaceString: '***' });
    expect(run(s, 'display')).toBe('***');
    expect(run(s, 'display', undefined, 1)).toBe('secret');
    expect(run({ ...s, markdownOnly: true }, 'prompt')).toBe('secret');
    expect(run({ ...s, promptOnly: true }, 'display')).toBe('secret');
    expect(run({ ...s, maxDepth: 1 }, 'prompt', 2)).toBe('secret');
    expect(run({ ...s, minDepth: 1 }, 'prompt', 0)).toBe('secret');
    expect(run({ ...s, minDepth: 1 }, 'prompt', 1)).toBe('***');
    expect(run({ ...s, disabled: true }, 'display')).toBe('secret');
  });

  it('change what the chat shows and what the model is sent', () => {
    const card = newCard().data;
    card.name = 'Ann';
    card.extensions = {
      regex_scripts: [
        { scriptName: 'Hide stats', findRegex: '/\\[stats\\][\\s\\S]*?\\[\\/stats\\]/g', replaceString: '', placement: [2], markdownOnly: true },
        { scriptName: 'Old stats out', findRegex: '/\\[stats\\][\\s\\S]*?\\[\\/stats\\]/g', replaceString: '', placement: [2], promptOnly: true, minDepth: 1 },
        { scriptName: 'Lore', findRegex: '/Ann/g', replaceString: '{{char}} the brave', placement: [5], promptOnly: true },
      ],
    };
    card.character_book = { ...newLorebook(), entries: [{ ...newEntry(), keys: ['sword'], content: 'Ann has a sword.' }] };
    const reply = 'Hello. [stats]HP 10[/stats]';
    expect(shownText(card, reply, 'assistant', 0, DEFAULT_CHAT_SETTINGS).trim()).toBe('Hello.');
    expect(shownText(card, reply, 'assistant', 0, { ...DEFAULT_CHAT_SETTINGS, useCardRegex: false })).toBe(reply);

    const history = [newMessage('user', 'sword?'), newMessage('assistant', reply), newMessage('user', 'and the sword?'), newMessage('assistant', reply)];
    const sent = buildChatPrompt(card, history.slice(0, 3), DEFAULT_CHAT_SETTINGS).parts;
    // The older reply loses its stats; the lore is rewritten.
    expect(sent.find((p) => p.role === 'assistant')?.content).toBe('Hello.');
    expect(sent.some((p) => p.content === 'Ann the brave has a sword.')).toBe(true);
    const last = buildChatPrompt(card, history.slice(0, 2), DEFAULT_CHAT_SETTINGS).parts;
    expect(last.find((p) => p.role === 'assistant')?.content).toBe(reply);
  });
});
