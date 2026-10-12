import { describe, expect, it } from 'vitest';
import { cardScripts, fromStWorldFile, fromThPreset, fromThRegexes, fromThWorldbook, messageRange, presetScripts, rawPrompt, scriptKey, scriptSrcdoc, stWorldFile, thMessages, thPreset, thRegexes, thWorldbook, withInjections } from '@/lib/tavernHelper';
import { newEntry, newLorebook } from '@/lib/cardSpec';
import { parseStPreset, toStPreset } from '@/lib/stPreset';
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

  it("keeps a prompt's own fields (its extra, other extensions') through import, scripts and export", () => {
    const p = parseStPreset({
      prompts: [{ identifier: 'tagged', name: 'Tagged', content: 'x', extra: { izumi_layer: 'structure' }, attach_index: 1, attach_side: 'end' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'tagged', enabled: true }] }],
    });
    expect(toStPreset(p).prompts).toEqual(expect.arrayContaining([expect.objectContaining({ identifier: 'tagged', extra: { izumi_layer: 'structure' }, attach_index: 1, attach_side: 'end' })]));
    const th = thPreset(p) as { prompts: Record<string, unknown>[] };
    expect(th.prompts[0].extra).toEqual({ izumi_layer: 'structure' });
    // A script changes the tag; the other fields stay.
    th.prompts[0].extra = { izumi_layer: 'thinking' };
    const back = fromThPreset(th, p);
    expect(back.prompts.find((x) => x.identifier === 'tagged')?.rest).toEqual({ extra: { izumi_layer: 'thinking' }, attach_index: 1, attach_side: 'end' });
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

  it("gives a lorebook as Tavern Helper's worldbook, and takes it back", () => {
    const book = {
      ...newLorebook(),
      name: 'World',
      entries: [
        { ...newEntry(), id: 3, name: 'Sword', comment: 'Sword', keys: ['sword'], secondary_keys: ['blade'], selective: true, content: 'A sword.', insertion_order: 7, extensions: { position: 4, depth: 2, role: 2, selectiveLogic: 3, probability: 40, useProbability: true, sticky: 2, exclude_recursion: true, group: 'arms' } },
        { ...newEntry(), id: 5, name: 'Town', constant: true, content: 'A town.', position: 'after_char' as const },
      ],
    };
    const wb = thWorldbook(book) as Record<string, Record<string, unknown>>[];
    expect(wb[0]).toMatchObject({
      uid: 3,
      name: 'Sword',
      strategy: { type: 'selective', keys: ['sword'], keys_secondary: { logic: 'and_all', keys: ['blade'] }, scan_depth: 'same_as_global' },
      position: { type: 'at_depth', role: 'assistant', depth: 2, order: 7 },
      probability: 40,
      recursion: { prevent_incoming: true, prevent_outgoing: false, delay_until: null },
      effect: { sticky: 2, cooldown: null, delay: null },
    });
    expect(wb[1]).toMatchObject({ uid: 5, strategy: { type: 'constant' }, position: { type: 'after_character_definition' } });

    // A script changes one entry (only what it names), drops the other, adds one.
    const back = fromThWorldbook([{ uid: 3, content: 'A sharp sword.', position: { depth: 1 } }, { name: 'New', strategy: { keys: ['new'] }, content: 'Fresh.' }], book);
    expect(back.entries).toHaveLength(2);
    expect(back.entries[0]).toMatchObject({ id: 3, name: 'Sword', content: 'A sharp sword.', keys: ['sword'], extensions: { position: 4, depth: 1, role: 2, selectiveLogic: 3, probability: 40, group: 'arms' } });
    expect(back.entries[1]).toMatchObject({ id: 6, name: 'New', keys: ['new'], content: 'Fresh.', enabled: true });
  });

  it("gives a lorebook as SillyTavern's world file, and takes it back", () => {
    const book = { ...newLorebook(), entries: [{ ...newEntry(), id: 0, name: 'A', keys: ['a'], content: 'Aa', extensions: { position: 1, probability: 100 } }] };
    const file = stWorldFile(book, 'W') as { entries: Record<string, Record<string, unknown>> };
    expect(file.entries['0']).toMatchObject({ uid: 0, key: ['a'], comment: 'A', content: 'Aa', position: 1, disable: false, world: 'W' });
    file.entries['0'].content = 'Changed';
    file.entries['0'].disable = true;
    const back = fromStWorldFile(file, book);
    expect(back.entries[0]).toMatchObject({ id: 0, content: 'Changed', enabled: false, keys: ['a'], position: 'after_char' });
  });

  it("keeps a script's text from closing its own <script>", () => {
    const s = { ...presetScripts(preset())[0], content: 'const x = "</script><b>";' };
    const doc = scriptSrcdoc(s, { a: '</script>' }, '/rt.js');
    expect(doc).toContain('const x = "<\\/script><b>";');
    expect(doc).toContain('\\u003c/script>');
    expect(doc.indexOf('/rt.js')).toBeLessThan(doc.indexOf('const x'));
    // SillyTavern's page parts come before the runtime, which finds them.
    expect(doc.indexOf('id="send_textarea"')).toBeLessThan(doc.indexOf('/rt.js'));
    expect(doc).toContain('<div id="uccb-st" hidden>');
  });
});
