import { describe, expect, it } from 'vitest';
import { chatFileName, chatToStJsonl, chatToText, stCreateDate, stSendDate } from '@/lib/chatExport';
import { newCard } from '@/lib/cardSpec';
import type { ChatSession } from '@/types/project';

const at = new Date(2026, 8, 26, 14, 5, 9).getTime();

const card = () => {
  const c = newCard().data;
  c.name = 'Ann';
  c.first_mes = 'Halt, {{user}}!';
  c.alternate_greetings = ['Welcome back, {{user}}.'];
  return c;
};

const chat = (): ChatSession => ({
  id: 'c1',
  name: 'Test',
  greeting: 1,
  createdAt: at,
  updatedAt: at,
  messages: [
    { id: 'u1', role: 'user', swipes: ['Hi {{char}}.'], swipe: 0, createdAt: at },
    { id: 'a1', role: 'assistant', swipes: ['First.', 'Second.'], swipe: 1, createdAt: at, model: 'glm', reasoning: [undefined, 'Hmm.'] },
  ],
});

describe('SillyTavern chat export', () => {
  it('formats dates the way SillyTavern writes them', () => {
    expect(stSendDate(new Date(at))).toBe('September 26, 2026 2:05pm');
    expect(stSendDate(new Date(2026, 0, 1, 0, 7))).toBe('January 1, 2026 12:07am');
    expect(stCreateDate(new Date(at))).toBe('2026-09-26@14h05m09s');
  });

  it('writes a metadata line, the greeting with every greeting as swipes, then the messages', () => {
    const lines = chatToStJsonl(chat(), card(), 'Kael').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ user_name: 'Kael', character_name: 'Ann', create_date: '2026-09-26@14h05m09s', chat_metadata: {} });
    expect(lines[1]).toMatchObject({ name: 'Ann', is_user: false, mes: 'Welcome back, Kael.', swipe_id: 1, swipes: ['Halt, Kael!', 'Welcome back, Kael.'] });
    expect(lines[2]).toMatchObject({ name: 'Kael', is_user: true, is_system: false, mes: 'Hi Ann.' });
    expect(lines[2].swipes).toBeUndefined();
    expect(lines[3]).toMatchObject({ name: 'Ann', mes: 'Second.', swipe_id: 1, swipes: ['First.', 'Second.'], extra: { api: 'openai', model: 'glm', reasoning: 'Hmm.' } });
    expect(lines[3].swipe_info).toHaveLength(2);
    expect(lines).toHaveLength(4);
  });

  it("writes each version's own time, and the shown one's as the message's", () => {
    const later = new Date(2026, 8, 26, 15, 30).getTime();
    const c = chat();
    c.messages[1] = { ...c.messages[1], swipeDates: [at, later] };
    const lines = chatToStJsonl(c, card(), 'Kael').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[3].send_date).toBe('September 26, 2026 3:30pm');
    expect(lines[3].swipe_info.map((s: { send_date: string }) => s.send_date)).toEqual(['September 26, 2026 2:05pm', 'September 26, 2026 3:30pm']);
    // A chat from before versions had times: the message's own for each.
    expect(chatToStJsonl(chat(), card(), 'Kael').includes('3:30pm')).toBe(false);
  });

  it('leaves the greeting out when the chat opened without one', () => {
    const lines = chatToStJsonl({ ...chat(), greeting: -1 }, card(), 'Kael').trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  it('names files as SillyTavern does, and writes readable text', () => {
    expect(chatFileName(chat(), card())).toBe('Ann - 2026-09-26@14h05m09s');
    expect(chatToText(chat(), card(), 'Kael')).toContain('Ann:\nWelcome back, Kael.\n\nKael:\nHi Ann.\n\nAnn:\nSecond.');
  });
});
