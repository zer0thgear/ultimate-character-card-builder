// 📊 A card's numbers, across all its chats: how much has been said and
// written, when, the longest replies, the words each side uses most. For
// fun; nothing here is billing (prompts sent with each reply aren't
// counted, only the messages).

import type { ChatMessage, ChatSession } from '@/types/project';
import { branchCount, type ContinueNode } from '@/lib/continueTree';

export interface ChatStatRow {
  id: string;
  name: string;
  /** Messages in it (yours and the character's; system notes aside). */
  messages: number;
  sent: number;
  received: number;
  /** Tokens in every version of every message. */
  tokens: number;
  /** Words in the chat as it reads now (the versions showing). */
  words: number;
  createdAt: number;
  /** Its newest message or version (0: none yet). */
  last: number;
}

export interface WordCount {
  word: string;
  count: number;
}

export interface CardStats {
  chats: ChatStatRow[];
  totals: {
    chats: number;
    messages: number;
    sent: number;
    received: number;
    tokens: number;
    words: number;
    /** Versions written beyond each reply's first (swipes and rerolls). */
    versions: number;
    /** Continues made, kept or not. */
    continues: number;
    /** Pictures drawn in the chats. */
    pictures: number;
  };
  /** The first and newest message (0: none). */
  first: number;
  last: number;
  /** Days with at least one message, and the day with the most. */
  daysActive: number;
  busiestDay: { day: string; messages: number } | null;
  /** The character's replies and yours, in words (as they read now). */
  replies: { average: number; longest: number };
  yours: { average: number; longest: number };
  /** The words each side uses most (common ones aside). */
  favouriteWords: { char: WordCount[]; you: WordCount[] };
}

const shown = (m: ChatMessage) => m.swipes?.[m.swipe] ?? '';
const wordsIn = (text: string) => text.match(/[\p{L}\p{N}'’-]+/gu)?.length ?? 0;
const times = (m: ChatMessage) => [m.createdAt, ...(m.swipeDates ?? [])].filter((t): t is number => typeof t === 'number' && t > 0);

/** A day, in the server's time zone, as YYYY-MM-DD. */
const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Words too common to be anyone's favourite.
const STOP = new Set(
  `the a an and or but if then so of to in on at by for with from into onto over under up down out off about as is are was were be been being am do does did done have has had having
  i me my mine myself you your yours yourself he him his himself she her hers herself it its itself we us our ours they them their theirs this that these those there here
  what which who whom whose when where why how all any both each few more most other some such no nor not only own same than too very can will just should would could
  might must shall may now again once also still even ever back well just like get got go goes going gone went come came make made say said says know see seen look looked
  one two thing things way really yeah yes oh ok okay don't i'm it's that's you're can't won't didn't isn't doesn't i'll i've let's he's she's there's what's they're we're
  char user`.split(/\s+/),
);

function topWords(texts: string[], n = 8): WordCount[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    // {{char}} and {{user}} are names, not words.
    for (const w of t.replace(/\{\{[^}]*\}\}/g, ' ').toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? []) {
      const word = w.replace(/’/g, "'").replace(/^['-]+|['-]+$/g, '');
      if (word.length < 4 || STOP.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([word, count]) => ({ word, count }));
}

const average = (ns: number[]) => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0);

/** A card's numbers from its chats; `count` is the token estimate. */
export function cardStats(chats: ChatSession[], count: (text: string) => number): CardStats {
  const rows: ChatStatRow[] = [];
  const totals = { chats: 0, messages: 0, sent: 0, received: 0, tokens: 0, words: 0, versions: 0, continues: 0, pictures: 0 };
  const days = new Map<string, number>();
  const replyWords: number[] = [];
  const yourWords: number[] = [];
  const charTexts: string[] = [];
  const yourTexts: string[] = [];
  let first = 0;
  let last = 0;

  for (const chat of chats) {
    const row: ChatStatRow = { id: chat.id, name: chat.name, messages: 0, sent: 0, received: 0, tokens: 0, words: 0, createdAt: chat.createdAt ?? 0, last: 0 };
    for (const m of Array.isArray(chat.messages) ? chat.messages : []) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const mine = m.role === 'user';
      const text = shown(m);
      const words = wordsIn(text);
      row.messages++;
      if (mine) row.sent++;
      else row.received++;
      row.words += words;
      for (const s of Array.isArray(m.swipes) ? m.swipes : []) if (typeof s === 'string' && s) row.tokens += count(s);
      if (!mine) totals.versions += Math.max(0, (m.swipes?.length ?? 1) - 1);
      for (const tree of m.continues ?? []) if (tree) totals.continues += branchCount(tree as ContinueNode);
      (mine ? yourWords : replyWords).push(words);
      (mine ? yourTexts : charTexts).push(text);
      const ts = times(m);
      if (ts.length) {
        row.last = Math.max(row.last, ...ts);
        first = first ? Math.min(first, ...ts) : Math.min(...ts);
        const day = dayOf(m.createdAt || ts[0]);
        days.set(day, (days.get(day) ?? 0) + 1);
      }
    }
    totals.pictures += chat.images?.length ?? 0;
    totals.chats++;
    totals.messages += row.messages;
    totals.sent += row.sent;
    totals.received += row.received;
    totals.tokens += row.tokens;
    totals.words += row.words;
    last = Math.max(last, row.last);
    rows.push(row);
  }

  const busiest = [...days].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
  return {
    chats: rows.sort((a, b) => (b.last || b.createdAt) - (a.last || a.createdAt)),
    totals,
    first,
    last,
    daysActive: days.size,
    busiestDay: busiest ? { day: busiest[0], messages: busiest[1] } : null,
    replies: { average: average(replyWords), longest: Math.max(0, ...replyWords) },
    yours: { average: average(yourWords), longest: Math.max(0, ...yourWords) },
    favouriteWords: { char: topWords(charTexts), you: topWords(yourTexts) },
  };
}
