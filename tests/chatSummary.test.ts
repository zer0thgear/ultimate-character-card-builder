import { describe, expect, it } from 'vitest';
import { buildChatPrompt, DEFAULT_CHAT_SETTINGS, newMessage } from '@/lib/chatPrompt';
import { buildPresetPrompt } from '@/lib/presetPrompt';
import { parseStPreset } from '@/lib/stPreset';
import { newCard } from '@/lib/cardSpec';
import { DEFAULT_SUMMARY_SETTINGS, newSinceSummary, summaryDue, summaryInjection, summaryInstruction, summarySettings } from '@/lib/chatSummary';
import { branchOf } from '@/store/chatStore';
import type { ChatMessage, ChatSession } from '@/types/project';

const card = () => ({ ...newCard().data, name: 'Mira', description: 'An elf.' });
const msg = (id: string, text = id): ChatMessage => ({ ...newMessage('user', text), id });
const summary = (through: string | null, text = 'They met.') => ({ text, through, updatedAt: 1 });

describe('summaryInstruction', () => {
  it('fills in the target length', () => {
    expect(summaryInstruction(DEFAULT_SUMMARY_SETTINGS)).toContain('Limit the summary to 200 words or less.');
  });

  it("leaves the target's sentence out with no target", () => {
    const text = summaryInstruction({ ...DEFAULT_SUMMARY_SETTINGS, targetWords: 0 });
    expect(text).not.toMatch(/words|Limit/);
    expect(text).toBe(
      'Ignore previous instructions. Summarize the most important facts and events in the story so far. If a summary already exists in your memory, use that as a base and expand with new facts. Your response should include nothing but the summary.',
    );
  });
});

describe('summaryInjection', () => {
  it('puts the summary in the template, where the settings say', () => {
    expect(summaryInjection(summary('a'), DEFAULT_SUMMARY_SETTINGS)).toEqual({ content: '[Summary: They met.]', position: 'after', depth: 2, role: 'system' });
    expect(summaryInjection(summary('a'), { ...DEFAULT_SUMMARY_SETTINGS, template: 'Story: {{summary}}', position: 'depth', depth: 3, role: 'user' })).toEqual({ content: 'Story: They met.', position: 'depth', depth: 3, role: 'user' });
  });

  it("sends nothing with no summary, an empty one, or 'not sent'", () => {
    expect(summaryInjection(undefined, DEFAULT_SUMMARY_SETTINGS)).toBeUndefined();
    expect(summaryInjection(summary('a', '  '), DEFAULT_SUMMARY_SETTINGS)).toBeUndefined();
    expect(summaryInjection(summary('a'), { ...DEFAULT_SUMMARY_SETTINGS, position: 'none' })).toBeUndefined();
  });

  it('keeps unset settings at their defaults', () => {
    expect(summarySettings({ targetWords: 0 })).toEqual({ ...DEFAULT_SUMMARY_SETTINGS, targetWords: 0 });
  });
});

describe('when to summarize', () => {
  const chat = ['a', 'b', 'c', 'd', 'e'].map((id) => msg(id));

  it('counts the messages after the last one summed up', () => {
    expect(newSinceSummary(chat, summary('b')).map((m) => m.id)).toEqual(['c', 'd', 'e']);
    expect(newSinceSummary(chat, undefined)).toHaveLength(5);
    // Its last message deleted: everything is new again.
    expect(newSinceSummary(chat, summary('gone'))).toHaveLength(5);
  });

  it('is due every N messages', () => {
    const s = { ...DEFAULT_SUMMARY_SETTINGS, everyMessages: 3 };
    expect(summaryDue(chat, summary('b'), s)).toBe(true);
    expect(summaryDue(chat, summary('c'), s)).toBe(false);
    expect(summaryDue(chat, undefined, { ...s, everyMessages: 0 })).toBe(false);
  });

  it('is due every N new tokens', () => {
    const long = [msg('a'), msg('b', 'word '.repeat(400))];
    const s = { ...DEFAULT_SUMMARY_SETTINGS, everyMessages: 0, everyTokens: 500 };
    expect(summaryDue(long, summary('a'), s)).toBe(true);
    expect(summaryDue(long, summary('a'), { ...s, everyTokens: 5000 })).toBe(false);
  });
});

describe('the summary in the prompt', () => {
  const settings = { ...DEFAULT_CHAT_SETTINGS, userName: 'Sam' };
  const history = [msg('a', 'Hi'), msg('b', 'Hello'), msg('c', 'Bye')];
  const inject = (position: 'before' | 'after' | 'depth') => ({ summary: { content: '[Summary: S]', position, depth: 1, role: 'system' as const } });

  it('goes after the main prompt by default, or before it', () => {
    expect(buildChatPrompt(card(), history, settings, inject('after')).parts.map((p) => p.label).slice(0, 3)).toEqual(['Main prompt', 'Summary', 'Description']);
    expect(buildChatPrompt(card(), history, settings, inject('before')).parts.map((p) => p.label).slice(0, 2)).toEqual(['Summary', 'Main prompt']);
  });

  it('goes into the chat at a depth', () => {
    const { parts } = buildChatPrompt(card(), history, settings, inject('depth'));
    expect(parts.slice(-3).map((p) => p.label)).toEqual(['Sam', 'Summary (depth 1)', 'Sam']);
  });

  it('goes either side of Main with a preset, or first without Main', () => {
    const preset = parseStPreset({
      prompts: [{ identifier: 'main', content: 'Main.' }, { identifier: 'chatHistory', marker: true }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
    });
    const labels = (p: typeof preset, o: ReturnType<typeof inject>) => buildPresetPrompt(card(), history, settings, p, o).parts.map((x) => x.label);
    expect(labels(preset, inject('after')).slice(0, 2)).toEqual([preset.prompts.find((p) => p.identifier === 'main')!.name, 'Summary']);
    expect(labels(preset, inject('before'))[0]).toBe('Summary');
    const noMain = { ...preset, order: preset.order.map((o) => (o.identifier === 'main' ? { ...o, enabled: false } : o)) };
    expect(labels(noMain, inject('after'))[0]).toBe('Summary');
    expect(labels(preset, inject('depth'))).toContain('Summary (depth 1)');
  });
});

describe('branching', () => {
  const chat = (): ChatSession => ({ id: 'c1', name: 'Chat', greeting: 0, messages: [msg('a'), msg('b'), msg('c')], summary: summary('b'), createdAt: 1, updatedAt: 1 });

  it('keeps the summary only if the branch has all it covers', () => {
    expect(branchOf(chat(), 1, 'c2', 2).summary).toEqual(summary('b'));
    expect(branchOf(chat(), 0, 'c2', 2).summary).toBeUndefined();
  });
});
