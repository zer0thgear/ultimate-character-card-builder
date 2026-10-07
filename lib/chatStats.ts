// How much a chat's been used: messages sent (yours) and received (the
// character's), and the tokens in them. Every version of a message counts
// toward the tokens, since each was written and read; system notes count
// toward neither. And when it was last used: its newest message or version
// (sending, a reply, a reroll), not just opening it or editing the card.

import type { ChatMessage } from '@/types/project';

export interface ChatTally {
  sent: number;
  received: number;
  tokens: number;
  /** When its newest message or version was written (0: none yet). */
  last: number;
}

export function tallyChat(messages: ChatMessage[], count: (text: string) => number): ChatTally {
  const tally: ChatTally = { sent: 0, received: 0, tokens: 0, last: 0 };
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (m.role === 'user') tally.sent++;
    else tally.received++;
    const times = [m.createdAt, ...(Array.isArray(m.swipeDates) ? m.swipeDates : [])].filter((t): t is number => typeof t === 'number');
    if (times.length) tally.last = Math.max(tally.last, ...times);
    for (const s of Array.isArray(m.swipes) ? m.swipes : []) if (typeof s === 'string') tally.tokens += count(s);
  }
  return tally;
}

/** Tallies added up. */
export const sumTallies = (tallies: ChatTally[]): ChatTally =>
  tallies.reduce((a, t) => ({ sent: a.sent + t.sent, received: a.received + t.received, tokens: a.tokens + t.tokens, last: Math.max(a.last, t.last ?? 0) }), { sent: 0, received: 0, tokens: 0, last: 0 });
