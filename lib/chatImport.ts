import type { CardData } from '@/types/card';
import type { AuthorsNote, ChatMessage, ChatSession } from '@/types/project';
import { expandMacros } from '@/lib/macros';
import { greetingText } from '@/lib/chatPrompt';
import { uuid } from '@/lib/uuid';

// Chats in, as SillyTavern saves them (and Chub exports them): JSONL, a
// metadata line and then one line per message, the format lib/chatExport.ts
// writes. A JSON array of those lines, or a plain list of { role, content }
// messages, is read too. The character's opening message becomes the
// chat's greeting: the card's own when it matches one (read live from the
// card from then on), else this chat's wording of the nearest.

export class ChatImportError extends Error {}

type Line = Record<string, unknown>;

const isObject = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** A message time as SillyTavern or Chub writes it ("September 26, 2026
 *  2:51pm", an ISO date, or milliseconds), or undefined. */
export function parseSendDate(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const st = v.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (st) {
    const month = MONTHS.indexOf(st[1].toLowerCase());
    if (month >= 0) {
      let h = Number(st[4]) % 12;
      if (st[6]?.toLowerCase() === 'pm') h += 12;
      else if (!st[6]) h = Number(st[4]);
      return new Date(Number(st[3]), month, Number(st[2]), h, Number(st[5])).getTime();
    }
  }
  // SillyTavern's chat creation stamp, "2026-09-26@14h51m03s".
  const stamp = v.match(/^(\d{4})-(\d{2})-(\d{2})@(\d{2})h(\d{2})m(\d{2})s/);
  if (stamp) return new Date(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6]).getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

/** The file's lines: JSONL, or one JSON array / object holding them. */
function readLines(text: string): Line[] {
  const trimmed = text.trim().replace(/^﻿/, '');
  if (!trimmed) throw new ChatImportError('That file is empty.');
  if (trimmed.startsWith('[') || (trimmed.startsWith('{') && !trimmed.includes('\n'))) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(isObject);
      if (isObject(parsed)) {
        const list = Array.isArray(parsed.messages) ? parsed.messages : Array.isArray(parsed.chat) ? parsed.chat : null;
        if (list) return [{ ...parsed, messages: undefined, chat: undefined }, ...list.filter(isObject)];
        return [parsed];
      }
    } catch {
      /* fall through to JSONL */
    }
  }
  const lines: Line[] = [];
  for (const raw of trimmed.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      const v: unknown = JSON.parse(raw);
      if (isObject(v)) lines.push(v);
    } catch {
      throw new ChatImportError("That file isn't a SillyTavern or Chub chat (.jsonl).");
    }
  }
  return lines;
}

/** Whether a line is a message rather than the metadata line. */
const isMessage = (l: Line) => typeof l.mes === 'string' || typeof l.content === 'string' || typeof l.text === 'string' || typeof l.message === 'string';

type Role = ChatMessage['role'];

function roleOf(l: Line, charName: string): Role {
  if (l.is_user === true) return 'user';
  if (typeof l.role === 'string') return l.role === 'user' ? 'user' : l.role === 'system' ? 'system' : 'assistant';
  // SillyTavern's own system messages (a narrator, a notice) aren't the
  // character's; its hidden messages are, and keep their speaker.
  if (l.is_system === true && str(l.name) && str(l.name) !== charName) return 'system';
  return 'assistant';
}

function messageOf(l: Line, role: Role): ChatMessage {
  const text = str(l.mes) || str(l.content) || str(l.text) || str(l.message);
  const swipes = Array.isArray(l.swipes) && l.swipes.length && l.swipes.every((s) => typeof s === 'string') ? (l.swipes as string[]) : [text];
  const swipeId = typeof l.swipe_id === 'number' && l.swipe_id >= 0 && l.swipe_id < swipes.length ? l.swipe_id : Math.max(0, swipes.indexOf(text));
  // The message shows its own text even where a frontend left swipes stale.
  if (swipes[swipeId] !== text && text) swipes[swipeId] = text;
  const info = Array.isArray(l.swipe_info) ? l.swipe_info : [];
  const extra = isObject(l.extra) ? l.extra : {};
  const created = parseSendDate(l.send_date) ?? parseSendDate(l.created_at) ?? parseSendDate(l.timestamp) ?? Date.now();
  const dates = swipes.map((_, i) => (i === swipeId ? created : (parseSendDate(isObject(info[i]) ? info[i].send_date : undefined) ?? created)));
  const reasoning = swipes.map((_, i) => {
    const e = i === swipeId ? extra : isObject(info[i]) && isObject(info[i].extra) ? info[i].extra : {};
    return str(e.reasoning) || undefined;
  });
  const model = str(extra.model) || undefined;
  return {
    id: uuid(),
    role,
    swipes,
    swipe: swipeId,
    createdAt: dates[0],
    swipeDates: dates,
    ...(reasoning.some(Boolean) ? { reasoning } : {}),
    ...(model && role === 'assistant' ? { model } : {}),
    // SillyTavern leaves its system messages out of the prompt.
    ...(l.is_system === true ? { hidden: true } : {}),
  };
}

/** SillyTavern's author's note from its chat metadata. */
function noteOf(meta: Line): AuthorsNote | undefined {
  const m = isObject(meta.chat_metadata) ? meta.chat_metadata : {};
  const prompt = str(m.note_prompt);
  if (!prompt.trim()) return undefined;
  const pos = typeof m.note_position === 'number' ? m.note_position : 1;
  const role = ['system', 'user', 'assistant'][typeof m.note_role === 'number' ? m.note_role : 0] as AuthorsNote['role'];
  return {
    prompt,
    position: pos === 0 ? 'after' : pos === 2 ? 'before' : 'chat',
    depth: typeof m.note_depth === 'number' ? m.note_depth : 4,
    frequency: typeof m.note_interval === 'number' ? m.note_interval : 1,
    role: role ?? 'system',
  };
}

const norm = (s: string) => s.replace(/\r\n/g, '\n').trim();

/**
 * A chat file as a new chat for `card`. The card's greetings are recognised
 * as the file wrote them out, with its user's name (or `userName`).
 */
export function parseChatFile(text: string, card: CardData, userName: string, fileName = ''): ChatSession {
  const lines = readLines(text);
  const meta = lines.find((l) => !isMessage(l)) ?? {};
  const charName = str(meta.character_name) || card.nickname || card.name;
  const raw = lines.filter(isMessage);
  if (!raw.length) throw new ChatImportError('That chat has no messages in it.');

  let messages = raw.map((l) => messageOf(l, roleOf(l, charName)));
  const now = Date.now();

  // The character's opening message is the greeting.
  let greeting = -1;
  let greetingEdits: Record<string, string> | undefined;
  if (messages[0].role === 'assistant') {
    const first = messages[0];
    messages = messages.slice(1);
    const fill = (t: string) => norm(expandMacros(t, { char: card.nickname || card.name || 'Character', user: str(meta.user_name) || userName || 'User' }));
    const greetings = [card.first_mes, ...card.alternate_greetings];
    const shown = norm(first.swipes[first.swipe] ?? '');
    const match = greetings.findIndex((_, i) => fill(greetingText(card, i)) === shown);
    if (match >= 0) greeting = match;
    else {
      // This chat's own wording, of the greeting its swipe was on (or the first).
      greeting = greetings.length ? Math.min(first.swipe, greetings.length - 1) : 0;
      greetingEdits = { [greeting]: first.swipes[first.swipe] ?? '' };
    }
  }

  const created = parseSendDate(meta.create_date) ?? messages[0]?.createdAt ?? now;
  const base = fileName.replace(/\.(jsonl|json)$/i, '').trim();
  return {
    id: uuid(),
    name: base ? `${base} (imported)` : `Imported chat ${new Date(now).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`,
    greeting,
    ...(greetingEdits ? { greetingEdits } : {}),
    messages,
    ...(noteOf(meta) ? { authorsNote: noteOf(meta) } : {}),
    createdAt: created,
    updatedAt: now,
  };
}
