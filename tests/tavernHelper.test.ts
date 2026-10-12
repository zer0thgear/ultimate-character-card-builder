import { describe, expect, it } from 'vitest';
import { cardScripts, fromThPreset, fromThRegexes, messageRange, presetScripts, rawPrompt, scriptKey, scriptSrcdoc, thMessages, thPreset, thRegexes, withInjections } from '@/lib/tavernHelper';
import { parseStPreset } from '@/lib/stPreset';
import { cardRegexScripts } from '@/lib/regexScripts';
import { newMessage } from '@/lib/chatPrompt';

const preset = () =>
  parseStPreset({
    name: 'P',
    temperature: 0.7,
    prompts: [
      { identifier: 'main', name: 'Main Prompt', system_prompt: true, content: 'Write.' },
      { identifier: 'mine', name: 'Mine', content: 'Be brief.', injection_position: 1, injection_depth: 2, injection_order: 50 },
      { identifier: 'spare', name: 'Spare', content: 'Unused.' },
    ],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }, { identifier: 'mine', enabled: false }] }],
    extensions: {
      regex_scripts: [{ scriptName: 'Hide', findRegex: '/x/g', replaceString: '', placement: [2], markdownOnly: true }],
      tavern_helper: {
        scripts: [
          { type: 'script', enabled: true, name: 'One', id: 'a', content: 'eventOn("x", () => {})', info: 'Does a thing', button: { enabled: true, buttons: [{ name: 'Go', visible: true }] } },
          { type: 'script', enabled: false, name: 'Off', id: 'b', content: 'x()' },
          { type: 'folder', enabled: true, name: 'F', id: 'f', scripts: [{ type: 'script', enabled: true, name: 'Two', id: 'c', content: 'y()' }] },
        ],
        variables: { mood: 'calm' },
      },
    },
  });

describe('Tavern Helper scripts', () => {
  it('reads the switched-on scripts of a preset and a card', () => {
    expect(presetScripts(preset()).map((s) => [s.name, s.source, s.buttons])).toEqual([
      ['One', 'preset', [{ name: 'Go', visible: true }]],
      ['Two', 'preset', []],
    ]);
    // A card's older form.
    expect(cardScripts({ TavernHelper_scripts: [{ name: 'Old', id: 'o', content: 'z()', buttons: [{ name: 'B', visible: false }] }] })).toMatchObject([{ name: 'Old', source: 'card', buttons: [{ name: 'B', visible: false }] }]);
  });

  it('asks again when a script changes', () => {
    const s = presetScripts(preset())[0];
    expect(scriptKey(s)).toBe(scriptKey({ ...s }));
    expect(scriptKey(s)).not.toBe(scriptKey({ ...s, content: s.content + ' ' }));
  });

  it('numbers the chat as SillyTavern does, the greeting first', () => {
    const m = newMessage('user', 'Hi');
    m.data = [{ hp: 3 }];
    const list = thMessages([m, { ...newMessage('assistant', 'A'), swipes: ['A', 'B'], swipe: 1 }], 'Hello!', { char: 'Ann', user: 'Bo' });
    expect(list.map((x) => [x.message_id, x.name, x.role, x.message])).toEqual([
      [0, 'Ann', 'assistant', 'Hello!'],
      [1, 'Bo', 'user', 'Hi'],
      [2, 'Ann', 'assistant', 'B'],
    ]);
    expect(list[1].data).toEqual({ hp: 3 });
    expect(thMessages([m], null, { char: 'Ann', user: 'Bo' })[0].message_id).toBe(0);
  });

  it('reads message ranges', () => {
    expect(messageRange(-1, 5)).toEqual([5, 5]);
    expect(messageRange('0-2', 5)).toEqual([0, 2]);
    expect(messageRange('2--1', 5)).toEqual([2, 5]);
    expect(messageRange('9', 5)).toBeNull();
    expect(messageRange('x', 5)).toBeNull();
  });

  it('gives the preset in Tavern Helper\'s shape, and takes it back', () => {
    const p = preset();
    const th = thPreset(p) as { settings: Record<string, unknown>; prompts: Record<string, unknown>[]; prompts_unused: Record<string, unknown>[]; extensions: Record<string, unknown> };
    expect(th.settings.temperature).toBe(0.7);
    expect(th.prompts.map((x) => [x.id, x.enabled])).toEqual([
      ['main', true],
      ['chatHistory', true],
      ['mine', false],
    ]);
    expect(th.prompts[2].position).toEqual({ type: 'in_chat', depth: 2, order: 50 });
    expect(th.prompts[1]).not.toHaveProperty('content');
    expect(th.prompts_unused.some((x) => x.id === 'spare')).toBe(true);

    // A script switches a prompt on, changes its text and the temperature.
    th.prompts[2].enabled = true;
    th.prompts[2].content = 'Be very brief.';
    th.settings.temperature = 1.1;
    const back = fromThPreset(th, p);
    expect(back.id).toBe(p.id);
    expect(back.name).toBe('P');
    expect(back.samplers.temperature).toBe(1.1);
    expect(back.order.find((o) => o.identifier === 'mine')?.enabled).toBe(true);
    expect(back.prompts.find((x) => x.identifier === 'mine')).toMatchObject({ content: 'Be very brief.', injectionPosition: 1, injectionDepth: 2 });
    expect(back.prompts.some((x) => x.identifier === 'spare')).toBe(true);
    expect((back.extra?.extensions as { tavern_helper: { variables: unknown } }).tavern_helper.variables).toEqual({ mood: 'calm' });
  });

  it('gives regex scripts in Tavern Helper\'s shape, and takes them back', () => {
    const raw = [
      { scriptName: 'Show', findRegex: '/a/g', replaceString: 'b', placement: [1, 2], markdownOnly: true },
      { scriptName: 'Send', findRegex: '/c/g', replaceString: '', placement: [2], promptOnly: true, minDepth: 2 },
      { scriptName: 'Both', findRegex: '/d/g', replaceString: '', placement: [5] },
    ];
    const th = thRegexes(raw, 'character');
    expect(th.map((r) => r.destination)).toEqual([
      { display: true, prompt: false },
      { display: false, prompt: true },
      { display: true, prompt: true },
    ]);
    const back = cardRegexScripts({ extensions: { regex_scripts: fromThRegexes(th) } });
    expect(back.map((s) => [s.scriptName, s.placement, s.markdownOnly, s.promptOnly, s.minDepth ?? null])).toEqual([
      ['Show', [1, 2], true, false, null],
      ['Send', [2], false, true, 2],
      ['Both', [5], false, false, null],
    ]);
  });

  it('puts injections in at their depths', () => {
    const msgs = ['a', 'b', 'c'].map((content) => ({ role: 'user', content }));
    const out = withInjections(msgs, [
      { id: '1', position: 'in_chat', depth: 0, role: 'system', content: 'end' },
      { id: '2', position: 'in_chat', depth: 2, role: 'system', content: 'two up' },
      { id: '3', position: 'none', depth: 0, role: 'system', content: 'not sent' },
    ], (i) => ({ role: i.role, content: i.content }));
    expect(out.map((m) => m.content)).toEqual(['a', 'two up', 'b', 'c', 'end']);
  });

  it("lays out generateRaw's prompt", () => {
    const out = rawPrompt([{ role: 'system', content: 'Rules.' }, 'char_description', 'chat_history', 'user_input', 'scenario'], { char_description: 'Ann.', scenario: '', history: [{ role: 'user', content: 'Hi' }], userInput: 'Go' });
    expect(out).toEqual([
      { role: 'system', content: 'Rules.' },
      { role: 'system', content: 'Ann.' },
      { role: 'user', content: 'Hi' },
      { role: 'user', content: 'Go' },
    ]);
  });

  it("keeps a script's text from closing its own <script>", () => {
    const s = { ...presetScripts(preset())[0], content: 'const x = "</script><b>";' };
    const doc = scriptSrcdoc(s, { a: '</script>' }, '/rt.js');
    expect(doc).toContain('const x = "<\\/script><b>";');
    expect(doc).toContain('\\u003c/script>');
    expect(doc.indexOf('/rt.js')).toBeLessThan(doc.indexOf('const x'));
  });
});
