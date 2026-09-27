import { describe, expect, it } from 'vitest';
import { parseStPreset, presetParams, PresetImportError } from '@/lib/stPreset';
import { buildPresetPrompt, squash } from '@/lib/presetPrompt';
import { DEFAULT_CHAT_SETTINGS, newMessage } from '@/lib/chatPrompt';
import { newCard, newEntry, newLorebook } from '@/lib/cardSpec';
import type { ChatMessage } from '@/types/project';

// Shaped like SillyTavern's own export of a chat-completion preset.
const ST_PRESET = {
  temperature: 1.1,
  frequency_penalty: 0,
  presence_penalty: 0.2,
  top_p: 0.95,
  top_k: 40,
  top_a: 0,
  min_p: 0.05,
  repetition_penalty: 1,
  openai_max_context: 200,
  openai_max_tokens: 50,
  wrap_in_quotes: false,
  names_behavior: 0,
  send_if_empty: '[continue]',
  impersonation_prompt: 'Write as {{user}}.',
  new_chat_prompt: '[Start a new Chat]',
  new_example_chat_prompt: '[Example Chat]',
  continue_nudge_prompt: 'Continue: {{lastChatMessage}}',
  wi_format: '[Lore:\n{0}]',
  scenario_format: 'Scenario: {{scenario}}',
  personality_format: "{{char}}'s personality: {{personality}}",
  squash_system_messages: false,
  continue_prefill: false,
  assistant_prefill: 'Sure,',
  seed: -1,
  prompts: [
    { name: 'Main Prompt', system_prompt: true, role: 'system', content: "{{setvar::tone::grim}}Write {{char}}'s next reply.", identifier: 'main' },
    { name: 'Auxiliary Prompt', system_prompt: true, role: 'system', content: '', identifier: 'nsfw' },
    { identifier: 'dialogueExamples', name: 'Chat Examples', system_prompt: true, marker: true },
    { name: 'Post-History Instructions', system_prompt: true, role: 'system', content: 'Keep it {{getvar::tone}}.', identifier: 'jailbreak' },
    { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
    { identifier: 'worldInfoAfter', name: 'World Info (after)', system_prompt: true, marker: true },
    { identifier: 'worldInfoBefore', name: 'World Info (before)', system_prompt: true, marker: true },
    { identifier: 'enhanceDefinitions', role: 'system', name: 'Enhance Definitions', content: 'Be accurate.', system_prompt: true, marker: false },
    { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
    { identifier: 'charPersonality', name: 'Char Personality', system_prompt: true, marker: true },
    { identifier: 'scenario', name: 'Scenario', system_prompt: true, marker: true },
    { identifier: 'personaDescription', name: 'Persona Description', system_prompt: true, marker: true },
    { identifier: 'abc-123', name: 'Style reminder', role: 'user', content: '(Stay terse, {{user}}.)', system_prompt: false, injection_position: 1, injection_depth: 1, forbid_overrides: false },
  ],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] },
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'personaDescription', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'charPersonality', enabled: true },
        { identifier: 'scenario', enabled: true },
        { identifier: 'enhanceDefinitions', enabled: false },
        { identifier: 'nsfw', enabled: true },
        { identifier: 'worldInfoAfter', enabled: true },
        { identifier: 'dialogueExamples', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'jailbreak', enabled: true },
        { identifier: 'abc-123', enabled: true },
      ],
    },
  ],
};

const card = () => {
  const c = newCard().data;
  c.name = 'Ann';
  c.description = '{{char}} is a knight.';
  c.personality = 'brave';
  c.scenario = 'A tavern.';
  c.mes_example = '<START>\n{{char}}: hello';
  c.character_book = {
    ...newLorebook(),
    entries: [
      { ...newEntry(), keys: ['sword'], content: 'Her sword is Dawn.', name: 'Sword', position: 'after_char' },
      { ...newEntry(), keys: ['sword'], content: 'Deep lore.', name: 'Deep', extensions: { position: 4, depth: 0, role: 1 } },
    ],
  };
  return c;
};

const settings = { ...DEFAULT_CHAT_SETTINGS, userName: 'Bob', persona: 'A traveller.' };
const chat = (): ChatMessage[] => [{ ...newMessage('assistant', 'Welcome, {{user}}.'), id: 'greeting' }, newMessage('user', 'Nice sword.')];

describe('parseStPreset', () => {
  it("reads the global prompt order, samplers and formats", () => {
    const p = parseStPreset(ST_PRESET, 'My Preset.json');
    expect(p.name).toBe('My Preset');
    expect(p.order.map((o) => o.identifier)).toContain('abc-123');
    expect(p.order.find((o) => o.identifier === 'enhanceDefinitions')?.enabled).toBe(false);
    expect(p.samplers).toMatchObject({ temperature: 1.1, top_k: 40, min_p: 0.05, max_tokens: 50 });
    expect(p.samplers.seed).toBeUndefined(); // -1 means random
    expect(p.samplers.repetition_penalty).toBeUndefined(); // 1 is off
    expect(p.prompts.find((x) => x.identifier === 'abc-123')).toMatchObject({ injectionPosition: 1, injectionDepth: 1, role: 'user' });
  });

  it('refuses text-completion presets and other files, saying why', () => {
    expect(() => parseStPreset({ instruct: {}, input_sequence: '' })).toThrow(PresetImportError);
    expect(() => parseStPreset({ hello: 1 })).toThrow(/no prompts/);
  });

  it('maps samplers to what each provider takes', () => {
    const p = parseStPreset({ ...ST_PRESET, reasoning_effort: 'high' });
    expect(presetParams(p, 'openai')).toMatchObject({ temperature: 1.1, top_k: 40, max_tokens: 50 });
    expect(presetParams(p, 'anthropic')).toEqual({ max_tokens: 50, effort: 'high' });
    expect(presetParams(p, 'openai').reasoning_effort).toBe('high');
    expect(presetParams(p, 'novelai').reasoning_effort).toBeUndefined(); // NovelAI has no effort
    expect(presetParams(parseStPreset({ ...ST_PRESET, reasoning_effort: 'auto' }), 'openai').reasoning_effort).toBeUndefined();
    expect(presetParams(parseStPreset({ ...ST_PRESET, reasoning_effort: 'min' }), 'openai').reasoning_effort).toBe('minimal');
  });
});

describe('buildPresetPrompt', () => {
  const preset = () => ({ ...parseStPreset(ST_PRESET), maxContext: undefined });

  it('follows the prompt order, fills markers, and injects at depth', () => {
    const b = buildPresetPrompt(card(), chat(), settings, preset());
    expect(b.parts.map((p) => p.label)).toEqual([
      'Main Prompt',
      'Persona Description',
      'Char Description',
      'Char Personality',
      'Scenario',
      'World Info (after): Sword',
      'Example chat',
      'Chat Examples',
      'New chat prompt',
      'Greeting',
      'Style reminder (depth 1)',
      'Bob',
      'Lorebook: Deep (depth 0)',
      'Post-History Instructions',
    ]);
    const content = Object.fromEntries(b.parts.map((p) => [p.label, p.content]));
    expect(content['Main Prompt']).toBe("Write Ann's next reply.");
    expect(content['Char Personality']).toBe("Ann's personality: brave");
    expect(content['World Info (after): Sword']).toBe('[Lore:\nHer sword is Dawn.]');
    // Variables set in an earlier prompt are read by a later one.
    expect(content['Post-History Instructions']).toBe('Keep it grim.');
    expect(b.parts.find((p) => p.label === 'Lorebook: Deep (depth 0)')?.role).toBe('user');
  });

  it("lets the card's system prompt and PHI replace Main and Post-History Instructions, unless forbidden", () => {
    const c = { ...card(), system_prompt: 'Card rules. {{original}}', post_history_instructions: 'Card PHI.' };
    const b = buildPresetPrompt(c, chat(), settings, preset());
    expect(b.parts[0].content).toBe("Card rules. Write Ann's next reply.");
    const forbid = preset();
    forbid.prompts = forbid.prompts.map((p) => (p.identifier === 'main' ? { ...p, forbidOverrides: true } : p));
    expect(buildPresetPrompt(c, chat(), settings, forbid).parts[0].content).toBe("Write Ann's next reply.");
  });

  it('continues with the nudge, or with a prefill when the preset says so', () => {
    const history = [...chat(), newMessage('assistant', 'She draws')];
    const nudge = buildPresetPrompt(card(), history, settings, preset(), { mode: 'continue', continueText: 'She draws' });
    expect(nudge.parts[nudge.parts.length - 1]).toMatchObject({ label: 'Continue nudge', content: 'Continue: She draws' });
    expect(nudge.prefill).toBeUndefined();
    const pre = buildPresetPrompt(card(), history, settings, { ...preset(), continuePrefill: true }, { mode: 'continue', continueText: 'She draws' });
    expect(pre.prefill).toBe('She draws ');
    expect(pre.parts.some((p) => p.content === 'She draws')).toBe(false);
  });

  it('sends the assistant prefill to Claude only, and send-if-empty when the user sent nothing', () => {
    expect(buildPresetPrompt(card(), chat(), settings, preset(), { kind: 'anthropic' }).prefill).toBe('Sure,');
    expect(buildPresetPrompt(card(), chat(), settings, preset(), { kind: 'openai' }).prefill).toBeUndefined();
    const onlyGreeting = chat().slice(0, 1);
    const b = buildPresetPrompt(card(), onlyGreeting, settings, preset(), { emptySend: true });
    expect(b.parts.some((p) => p.role === 'user' && p.content === '[continue]')).toBe(true);
  });

  it('drops the oldest messages to fit the context size', () => {
    const long: ChatMessage[] = [...chat(), ...Array.from({ length: 30 }, (_, i) => newMessage(i % 2 ? 'user' : 'assistant', `Message number ${i} with some words in it.`))];
    const b = buildPresetPrompt(card(), long, settings, { ...preset(), maxContext: 400 });
    expect(b.droppedHistory).toBeGreaterThan(0);
    expect(b.parts.some((p) => p.content.includes('Message number 29'))).toBe(true);
    expect(b.parts.some((p) => p.content.includes('Message number 0 '))).toBe(false);
  });

  it('impersonates with the preset prompt, and squashes system runs when asked', () => {
    const b = buildPresetPrompt(card(), chat(), settings, preset(), { mode: 'impersonate' });
    expect(b.parts[b.parts.length - 1]).toMatchObject({ label: 'Impersonation prompt', content: 'Write as Bob.' });
    expect(squash([{ role: 'system', content: 'a' }, { role: 'system', content: 'b' }, { role: 'user', content: 'c' }])).toEqual([
      { role: 'system', content: 'a\nb' },
      { role: 'user', content: 'c' },
    ]);
  });

  it("puts names in the content when names_behavior is 2", () => {
    const b = buildPresetPrompt(card(), chat(), settings, { ...preset(), namesBehavior: 2 });
    expect(b.parts.find((p) => p.label === 'Bob')?.content).toBe('Bob: Nice sword.');
  });
});

describe('wrapWithPreset (the writing assistant)', () => {
  const task = [
    { role: 'system' as const, content: 'You help write cards.' },
    { role: 'user' as const, content: 'Rewrite the description.' },
  ];

  it("puts the preset's own prompts around the request, skipping placeholders", async () => {
    const { wrapWithPreset, assistablePrompts } = await import('@/lib/assistPreset');
    const p = parseStPreset(ST_PRESET);
    // Enabled, with text: Main (before), Post-History and the in-chat one (after).
    expect(assistablePrompts(p).map((a) => [a.prompt.identifier, a.before])).toEqual([
      ['main', true],
      ['jailbreak', false],
      ['abc-123', false],
    ]);
    const out = wrapWithPreset(task, p, { card: card(), userName: 'Bob', persona: '', excluded: [] });
    expect(out.map((m) => m.content)).toEqual(["Write Ann's next reply.", 'You help write cards.', 'Rewrite the description.', 'Keep it grim.', '(Stay terse, Bob.)']);
  });

  it('leaves out excluded prompts', async () => {
    const { wrapWithPreset } = await import('@/lib/assistPreset');
    const out = wrapWithPreset(task, parseStPreset(ST_PRESET), { card: card(), userName: 'Bob', persona: '', excluded: ['main', 'abc-123'] });
    expect(out.map((m) => m.content)).toEqual(['You help write cards.', 'Rewrite the description.', 'Keep it .']);
  });
});
