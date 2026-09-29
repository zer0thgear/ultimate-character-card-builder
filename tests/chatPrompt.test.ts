import { describe, expect, it } from 'vitest';
import { buildChatPrompt, DEFAULT_CHAT_SETTINGS, newMessage, exampleBlocks } from '@/lib/chatPrompt';
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
