import { describe, expect, it } from 'vitest';
import { parseChatFile, parseSendDate, ChatImportError } from '@/lib/chatImport';
import { chatToStJsonl } from '@/lib/chatExport';
import { newMessage } from '@/lib/chatPrompt';
import { newCard } from '@/lib/cardSpec';
import type { ChatSession } from '@/types/project';

const card = () => {
  const c = newCard().data;
  c.name = 'Ann';
  c.first_mes = 'Hi {{user}}, I am {{char}}.';
  c.alternate_greetings = ['Hey {{user}}.'];
  return c;
};

describe('parseSendDate', () => {
  it("reads SillyTavern's times, ISO dates and numbers", () => {
    expect(new Date(parseSendDate('September 26, 2026 2:51pm')!).getHours()).toBe(14);
    expect(new Date(parseSendDate('September 26, 2026 12:05am')!).getHours()).toBe(0);
    expect(parseSendDate('2026-09-26T10:00:00.000Z')).toBe(Date.parse('2026-09-26T10:00:00.000Z'));
    expect(parseSendDate(1_700_000_000)).toBe(1_700_000_000_000);
    expect(parseSendDate('nonsense')).toBeUndefined();
  });
});

describe('parseChatFile', () => {
  it('round-trips a chat UCCB exported', () => {
    const user = newMessage('user', 'Hello Ann');
    const reply = { ...newMessage('assistant', 'one', 'gpt-x'), swipes: ['one', 'two'], swipe: 1, reasoning: [undefined, 'thought'] };
    const chat: ChatSession = { id: 'c', name: 'C', greeting: 1, messages: [user, reply], createdAt: Date.UTC(2026, 0, 1), updatedAt: 0, authorsNote: { prompt: 'Be brief', position: 'chat', depth: 2, frequency: 1, role: 'system' } };
    const back = parseChatFile(chatToStJsonl(chat, card(), 'Bo'), card(), 'Bo', 'Ann - 2026.jsonl');
    expect(back.greeting).toBe(1);
    expect(back.greetingEdits).toBeUndefined();
    expect(back.messages.map((m) => [m.role, m.swipes, m.swipe])).toEqual([
      ['user', ['Hello Ann'], 0],
      ['assistant', ['one', 'two'], 1],
    ]);
    expect(back.messages[1].reasoning?.[1]).toBe('thought');
    expect(back.messages[1].model).toBe('gpt-x');
    expect(back.authorsNote).toMatchObject({ prompt: 'Be brief', depth: 2, position: 'chat' });
    expect(back.name).toBe('Ann - 2026 (imported)');
  });

  it("keeps a greeting the card doesn't have as this chat's wording", () => {
    const file = [
      JSON.stringify({ user_name: 'Bo', character_name: 'Ann', create_date: '2026-09-26@14h51m03s', chat_metadata: {} }),
      JSON.stringify({ name: 'Ann', is_user: false, mes: 'A different hello.', send_date: 'September 26, 2026 2:51pm' }),
      JSON.stringify({ name: 'Bo', is_user: true, mes: 'hi', send_date: 'September 26, 2026 2:52pm' }),
      JSON.stringify({ name: 'System', is_user: false, is_system: true, mes: 'A notice' }),
    ].join('\n');
    const chat = parseChatFile(file, card(), 'Bo');
    expect(chat.greeting).toBe(0);
    expect(chat.greetingEdits).toEqual({ 0: 'A different hello.' });
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'system']);
    expect(new Date(chat.createdAt).getHours()).toBe(14);
  });

  it('reads a JSON list of role/content messages', () => {
    const chat = parseChatFile(JSON.stringify([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), card(), 'Bo');
    expect(chat.greeting).toBe(-1);
    expect(chat.messages.map((m) => m.swipes[0])).toEqual(['a', 'b']);
  });

  it("says when a file isn't a chat", () => {
    expect(() => parseChatFile('not json\nat all', card(), 'Bo')).toThrow(ChatImportError);
    expect(() => parseChatFile(JSON.stringify({ user_name: 'x' }), card(), 'Bo')).toThrow(/no messages/);
  });
});
