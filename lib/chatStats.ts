// How much a chat's been used: messages sent (yours) and received (the
// character's), and the tokens in them. Every version of a message counts
// toward the tokens, since each was written and read; system notes count
// toward neither.

import type { ChatMessage } from '@/types/project';

export interface ChatTally {
  sent: number;
  received: number;
  tokens: number;
}

export function tallyChat(messages: ChatMessage[], count: (text: string) => number): ChatTally {
  const tally: ChatTally = { sent: 0, received: 0, tokens: 0 };
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (m.role === 'user') tally.sent++;
    else tally.received++;
    for (const s of Array.isArray(m.swipes) ? m.swipes : []) if (typeof s === 'string') tally.tokens += count(s);
  }
  return tally;
}

/** Tallies added up. */
export const sumTallies = (tallies: ChatTally[]): ChatTally =>
  tallies.reduce((a, t) => ({ sent: a.sent + t.sent, received: a.received + t.received, tokens: a.tokens + t.tokens }), { sent: 0, received: 0, tokens: 0 });
