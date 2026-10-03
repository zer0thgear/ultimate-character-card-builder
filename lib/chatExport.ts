import type { CardData } from '@/types/card';
import type { ChatSession } from '@/types/project';
import { expandMacros } from '@/lib/macros';
import { chatGreeting, swipeDate } from '@/lib/chatPrompt';

// Test chats out, as SillyTavern writes chats (which Chub imports too):
// JSONL, a metadata line and then one line per message. The greeting is
// the first message, its swipes every greeting, as SillyTavern opens a
// chat. {{char}}/{{user}} are filled in, as SillyTavern does when it saves.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/** SillyTavern's message time, e.g. "September 26, 2026 2:51pm". */
export function stSendDate(d: Date): string {
  const h = d.getHours() % 12 || 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${pad(d.getMinutes())}${d.getHours() < 12 ? 'am' : 'pm'}`;
}

/** SillyTavern's chat creation stamp, e.g. "2026-09-26@14h51m03s" (also
 *  what it names chat files by). */
export function stCreateDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}@${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}s`;
}

export interface ExportNames {
  char: string;
  user: string;
}

export function namesFor(card: CardData, userName: string): ExportNames {
  return { char: card.nickname || card.name || 'Character', user: userName || 'User' };
}

export function chatToStJsonl(chat: ChatSession, card: CardData, userName: string): string {
  const names = namesFor(card, userName);
  const x = (t: string) => expandMacros(t, { char: names.char, user: names.user });
  const created = new Date(chat.createdAt);
  const lines: object[] = [
    {
      user_name: names.user,
      character_name: names.char,
      create_date: stCreateDate(created),
      chat_metadata: {},
    },
  ];

  const greetings = [card.first_mes, ...card.alternate_greetings].map((_, i) => chatGreeting(card, chat, i));
  if (chat.greeting >= 0 && greetings[chat.greeting]?.trim()) {
    const swipes = greetings.map(x);
    const date = stSendDate(created);
    lines.push({
      name: names.char,
      is_user: false,
      is_system: false,
      send_date: date,
      mes: swipes[chat.greeting],
      extra: {},
      swipe_id: chat.greeting,
      swipes,
      swipe_info: swipes.map(() => ({ send_date: date, extra: {} })),
    });
  }

  for (const m of chat.messages) {
    const isUser = m.role === 'user';
    const swipes = m.swipes.map(x);
    const dateOf = (i: number) => stSendDate(new Date(swipeDate(m, i)));
    const extra = (i: number) => ({
      ...(m.model && !isUser ? { api: 'openai', model: m.model } : {}),
      ...(m.reasoning?.[i] ? { reasoning: m.reasoning[i] } : {}),
    });
    lines.push({
      name: isUser ? names.user : m.role === 'system' ? 'System' : names.char,
      is_user: isUser,
      is_system: m.role === 'system',
      send_date: dateOf(m.swipe),
      mes: swipes[m.swipe] ?? '',
      extra: extra(m.swipe),
      // SillyTavern keeps swipes on the character's messages only.
      ...(!isUser && swipes.length > 1
        ? { swipe_id: m.swipe, swipes, swipe_info: swipes.map((_, i) => ({ send_date: dateOf(i), extra: extra(i) })) }
        : {}),
    });
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

/** The chat as plain text, for reading or sharing. */
export function chatToText(chat: ChatSession, card: CardData, userName: string): string {
  const names = namesFor(card, userName);
  const x = (t: string) => expandMacros(t, { char: names.char, user: names.user });
  const out: string[] = [`${chat.name}\n${names.char} and ${names.user}\n`];
  const greeting = chatGreeting(card, chat);
  if (chat.greeting >= 0 && greeting?.trim()) out.push(`${names.char}:\n${x(greeting)}`);
  for (const m of chat.messages) {
    const who = m.role === 'user' ? names.user : m.role === 'system' ? 'System' : names.char;
    out.push(`${who}:\n${x(m.swipes[m.swipe] ?? '')}`);
  }
  return out.join('\n\n') + '\n';
}

/** A file name the way SillyTavern names chats: "Name - 2026-09-26@14h51m03s". */
export function chatFileName(chat: ChatSession, card: CardData): string {
  const name = (card.name || 'Character').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return `${name} - ${stCreateDate(new Date(chat.createdAt))}`;
}
