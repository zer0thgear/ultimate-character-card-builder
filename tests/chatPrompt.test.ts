import { describe, expect, it } from 'vitest';
import { buildChatPrompt, chatGreeting, DEFAULT_CHAT_SETTINGS, newMessage, exampleBlocks, messageLayout } from '@/lib/chatPrompt';
import { newCard, newEntry, newLorebook } from '@/lib/cardSpec';

const card = () => {
  const c = newCard().data;
  c.name = 'Ann';
  c.description = '{{char}} is a knight.';
  c.personality = 'brave';
  c.scenario = 'A tavern.';
  c.mes_example = '<START>\n{{user}}: hi\n{{char}}: hello\n<START>\n{{char}}: bye';
  c.character_book = {
    ...newLorebook(),
    entries: [{ ...newEntry(), keys: ['sword'], content: 'Her sword is named Dawn.', name: 'Sword', position: 'after_char' }],
  };
  return c;
};

describe('buildChatPrompt', () => {
  const settings = { ...DEFAULT_CHAT_SETTINGS, userName: 'Bob', persona: 'A traveller.' };

  it('assembles the card in the usual order with macros expanded', () => {
    const history = [{ ...newMessage('assistant', 'Welcome, {{user}}.'), id: 'greeting' }, newMessage('user', 'Nice sword.')];
    const { parts } = buildChatPrompt(card(), history, settings);
    expect(parts.map((p) => p.label)).toEqual([
      'Main prompt',
      'Description',
      'Personality',
      'Scenario',
      'Lorebook: Sword',
      'Persona',
      'Example dialogue',
      'Greeting',
      'Bob',
    ]);
    expect(parts[1].content).toBe('Ann is a knight.');
    expect(parts[7]).toMatchObject({ role: 'assistant', content: 'Welcome, Bob.' });
  });

  it("uses the card's system prompt and PHI, with {{original}}", () => {
    const c = { ...card(), system_prompt: 'Card rules. {{original}}', post_history_instructions: 'Stay terse.' };
    const { parts } = buildChatPrompt(c, [], { ...settings, mainPrompt: 'Base.' });
    expect(parts[0]).toMatchObject({ label: 'System prompt (card)', content: 'Card rules. Base.' });
    expect(parts[parts.length - 1]).toMatchObject({ label: 'Post-history instructions (card)', content: 'Stay terse.' });
  });

  it('can leave out examples and the lorebook', () => {
    const { parts } = buildChatPrompt(card(), [newMessage('user', 'sword')], { ...settings, includeExamples: false, useLorebook: false });
    expect(parts.some((p) => p.label.startsWith('Lorebook') || p.label === 'Example dialogue')).toBe(false);
  });

  it('splits example dialogue at <START>', () => {
    expect(exampleBlocks(card().mes_example)).toHaveLength(2);
  });
});

describe('🧭 guides', () => {
  it('go last, in the template, and only when given', async () => {
    const { buildChatPrompt, guideText, DEFAULT_CHAT_SETTINGS } = await import('@/lib/chatPrompt');
    const { newCard } = await import('@/lib/cardSpec');
    const card = { ...newCard().data, name: 'Mira', description: 'An elf.' };
    const settings = { ...DEFAULT_CHAT_SETTINGS, userName: 'Sam' };
    const guided = buildChatPrompt(card, [], settings, { guide: 'she hides the letter from {{user}}' });
    expect(guided.messages.at(-1)).toEqual({ role: 'system', content: '[Take the following into special consideration for your next message: she hides the letter from Sam]' });
    expect(buildChatPrompt(card, [], settings, { guide: '  ' }).parts.some((p) => p.label.startsWith('Guide'))).toBe(false);
    expect(guideText('Steer: {{guide}}!', 'x')).toBe('Steer: x!');
    expect(guideText('No slot', 'x')).toBe('No slot\nx');
  });
});

describe('context size', () => {
  it('trims the oldest messages so the prompt and reply fit, keeping the latest', async () => {
    const { buildChatPrompt, DEFAULT_CHAT_SETTINGS, newMessage } = await import('@/lib/chatPrompt');
    const { newCard } = await import('@/lib/cardSpec');
    const card = { ...newCard().data, name: 'Mira', description: 'An elf.' };
    const chat = Array.from({ length: 40 }, (_, i) => newMessage(i % 2 ? 'assistant' : 'user', `Message ${i}: ${'words '.repeat(60)}`));
    const all = buildChatPrompt(card, chat, DEFAULT_CHAT_SETTINGS, {});
    expect(all.droppedHistory).toBe(0);
    const fit = buildChatPrompt(card, chat, DEFAULT_CHAT_SETTINGS, { maxContext: 2000, maxTokens: 300 });
    expect(fit.droppedHistory).toBeGreaterThan(0);
    const text = fit.messages.map((m) => m.content).join('\n');
    expect(text).toContain('Message 39');
    expect(text).not.toContain('Message 0:');
    const total = fit.messages.reduce((n, m) => n + Math.ceil(m.content.length / 3.5) + 4, 0);
    expect(total + 300).toBeLessThanOrEqual(2000);
  });

  it("uses a preset's own context size over the connection's", async () => {
    const { buildPresetPrompt } = await import('@/lib/presetPrompt');
    const { parseStPreset } = await import('@/lib/stPreset');
    const { DEFAULT_CHAT_SETTINGS, newMessage } = await import('@/lib/chatPrompt');
    const { newCard } = await import('@/lib/cardSpec');
    const card = { ...newCard().data, name: 'Mira' };
    const chat = Array.from({ length: 30 }, (_, i) => newMessage(i % 2 ? 'assistant' : 'user', `M${i} ${'words '.repeat(60)}`));
    const preset = parseStPreset({ prompts: [{ identifier: 'main', content: 'Main.' }], openai_max_context: 100000 });
    expect(buildPresetPrompt(card, chat, DEFAULT_CHAT_SETTINGS, preset, { maxContext: 1500, maxTokens: 100 }).droppedHistory).toBe(0);
    const noSize = { ...preset, maxContext: undefined };
    expect(buildPresetPrompt(card, chat, DEFAULT_CHAT_SETTINGS, noSize, { maxContext: 1500, maxTokens: 100 }).droppedHistory).toBeGreaterThan(0);
  });
});

describe('chatGreeting', () => {
  it("reads the card's greeting live, unless the chat has its own wording of it", () => {
    const card = newCard().data;
    card.first_mes = 'Hello.';
    card.alternate_greetings = ['Hi.', 'Hey.'];
    expect(chatGreeting(card, { greeting: 1 })).toBe('Hi.');
    const chat = { greeting: 1, greetingEdits: { 1: 'Hi there.' } };
    expect(chatGreeting(card, chat)).toBe('Hi there.');
    expect(chatGreeting(card, chat, 2)).toBe('Hey.');
    expect(chatGreeting(card, { greeting: -1, greetingEdits: { [-1]: 'x' } })).toBe('');
  });
});

describe('hidden messages', () => {
  const settings = { ...DEFAULT_CHAT_SETTINGS, userName: 'Bob', persona: '' };
  it('are left out of the prompt and the lorebook scan', () => {
    const history = [newMessage('user', 'Nice sword.'), newMessage('assistant', 'Thanks.'), newMessage('user', 'Bye.')];
    history[0].hidden = true;
    const { parts, lore } = buildChatPrompt(card(), history, settings);
    expect(parts.map((p) => p.content)).not.toContain('Nice sword.');
    expect(parts.map((p) => p.content)).toContain('Bye.');
    expect(lore.active).toHaveLength(0);
  });
});

describe('messageLayout', () => {
  it('puts both portraits on the left by default, as SillyTavern does', () => {
    expect(messageLayout(DEFAULT_CHAT_SETTINGS, 'user')).toEqual({ right: false, flat: false });
    expect(messageLayout(DEFAULT_CHAT_SETTINGS, 'assistant')).toEqual({ right: false, flat: false });
  });

  it('follows each side and the chat style', () => {
    const s = { charSide: 'left', userSide: 'right', chatStyle: 'flat' } as const;
    expect(messageLayout(s, 'user')).toEqual({ right: true, flat: true });
    expect(messageLayout(s, 'assistant')).toEqual({ right: false, flat: true });
    expect(messageLayout({}, 'user')).toEqual({ right: false, flat: false });
  });
});
