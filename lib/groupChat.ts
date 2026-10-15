import type { CardData, Lorebook } from '@/types/card';
import type { ChatMessage, ChatSession, GroupMember, GroupProject, GroupSettings } from '@/types/project';
import { ENTRY_BOOK } from '@/lib/lorebookBank';
import type { LlmMessage } from '@/types/llm';

// Group chats: several cards in one chat. Each reply is written by one
// member (the speaker), from a card built for that turn and run through the
// usual prompt builders (lib/chatPrompt.ts, lib/presetPrompt.ts), so
// presets, macros, lorebooks and regex scripts work as in a card's chat.
// The group's strategy decides what that card holds:
//
// - swap: the speaker's card (SillyTavern's default);
// - join: every member's card in one, each part wrapped in the group's
//   join prefix and suffix (SillyTavern's "join character cards");
// - cast: the speaker in full, members in the scene (who spoke or were
//   named lately, or were marked present) in full but for their examples,
//   and everyone else as a line or two, each in a block of their own, so
//   nobody is forgotten and nobody's details run into another's.
//
// In every strategy the members' lorebooks are all in play, and the
// history names who said what.

/** A member with their card, as the chat has them. */
export interface Member {
  id: string;
  card: CardData;
  muted?: boolean;
  talkativeness?: number;
  summary?: string;
}

export const DEFAULT_GROUP_SETTINGS: GroupSettings = { strategy: 'cast', order: 'natural' };
/** Cast's defaults: in the scene after speaking or being named in the last
 *  6 messages, for 4 more, with no token budget. */
export const CAST_RECENT = 6;
export const CAST_STICKY = 4;
/** Join's default wrapping around each card's part. */
export const JOIN_PREFIX = '### {{char}}';
export const JOIN_SUFFIX = '';

export const memberName = (card: Pick<CardData, 'name' | 'nickname'>) => card.nickname?.trim() || card.name.trim() || 'Character';

/** Members as the chat has them: the group's, with their cards (a member
 *  whose card is gone is left out). */
export function groupMembers(group: Pick<GroupProject, 'members'>, cards: Map<string, CardData>): Member[] {
  return group.members.flatMap((m: GroupMember) => {
    const card = cards.get(m.projectId);
    return card ? [{ id: m.projectId, card, muted: m.muted, talkativeness: m.talkativeness, summary: m.summary }] : [];
  });
}

/** `{{char}}` (and <BOT>) in a member's own text, as that member's name. */
const ownName = (text: string, name: string) => text.replace(/\{\{char\}\}|<BOT>/gi, name);

/** A member's line for when they're off-stage: their summary, or the start
 *  of their description. */
export function memberSummary(m: Member): string {
  if (m.summary?.trim()) return ownName(m.summary.trim(), memberName(m.card));
  const desc = ownName(m.card.description, memberName(m.card)).replace(/\s+/g, ' ').trim();
  if (desc.length <= 220) return desc;
  const cut = desc.slice(0, 220);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The names a member answers to: their name and nickname. */
const namesOf = (card: CardData) => [...new Set([card.name, card.nickname].map((n) => n?.trim()).filter((n): n is string => !!n))];
/** Whether `text` names the member (a whole word, any case). */
export function mentions(text: string, card: CardData): boolean {
  return namesOf(card).some((n) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(n)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text));
}

const shown = (m: ChatMessage) => m.swipes[m.swipe] ?? '';

// ─── Cast ───────────────────────────────────────────────────────────────────

export type Tier = 'speaker' | 'scene' | 'offstage';

export interface CastPlace {
  id: string;
  name: string;
  tier: Tier;
  /** Why they're where they are, for the inspector. */
  why: string;
}

/** Where each member is for the speaker's turn: the speaker; in the scene
 *  (spoke or was named within the last castRecent + castSticky messages,
 *  or marked present); or off-stage (or marked out). Past the token budget,
 *  the least recently active in the scene drop to off-stage. */
export function castScene(
  members: Member[],
  speakerId: string,
  history: ChatMessage[],
  settings: GroupSettings,
  presence: Record<string, 'in' | 'out'> = {},
  count: (text: string) => number = (t) => Math.ceil(t.length / 4),
): CastPlace[] {
  const recent = settings.castRecent ?? CAST_RECENT;
  const sticky = settings.castSticky ?? CAST_STICKY;
  const window = recent + sticky;
  /** How many messages ago each was last active (spoke or was named). */
  const lastActive = (m: Member): { ago: number; how: 'spoke' | 'named' } | null => {
    for (let i = history.length - 1, ago = 0; i >= 0 && ago < window; i--, ago++) {
      const msg = history[i];
      if (msg.speaker === m.id) return { ago, how: 'spoke' };
      if (mentions(shown(msg), m.card)) return { ago, how: 'named' };
    }
    return null;
  };
  const places = members.map((m) => {
    const name = memberName(m.card);
    if (m.id === speakerId) return { m, place: { id: m.id, name, tier: 'speaker' as Tier, why: 'speaking' }, ago: -1 };
    if (presence[m.id] === 'out') return { m, place: { id: m.id, name, tier: 'offstage' as Tier, why: 'marked out of the scene' }, ago: Infinity };
    if (presence[m.id] === 'in') return { m, place: { id: m.id, name, tier: 'scene' as Tier, why: 'marked present' }, ago: -1 };
    const a = lastActive(m);
    if (!a) return { m, place: { id: m.id, name, tier: 'offstage' as Tier, why: `not active in the last ${window} messages` }, ago: Infinity };
    const when = a.ago === 0 ? 'in the last message' : `${a.ago + 1} messages ago`;
    return { m, place: { id: m.id, name, tier: 'scene' as Tier, why: `${a.how} ${when}${a.ago >= recent ? ' (staying a while)' : ''}` }, ago: a.ago };
  });
  // The budget: the most recently active stay in full.
  const budget = settings.castBudget ?? 0;
  if (budget > 0) {
    let used = 0;
    for (const p of [...places].filter((x) => x.place.tier === 'scene').sort((a, b) => a.ago - b.ago)) {
      used += count(fullBlock(p.m));
      if (used > budget && p.place.why !== 'marked present') {
        p.place.tier = 'offstage';
        p.place.why = `over the scene's ${budget}-token budget (${p.place.why})`;
      }
    }
  }
  return places.map((p) => p.place);
}

/** A member's description and personality, in their own words. */
function fullBlock(m: Member): string {
  const name = memberName(m.card);
  const parts = [ownName(m.card.description, name).trim(), m.card.personality.trim() ? `${name}'s personality: ${ownName(m.card.personality, name).trim()}` : ''];
  return parts.filter(Boolean).join('\n\n');
}

const block = (name: string, body: string, speaking: boolean) => `<character name="${name.replace(/"/g, "'")}"${speaking ? ' speaking="yes"' : ''}>\n${body}\n</character>`;

// ─── The card for a turn ────────────────────────────────────────────────────

/** Every member's lorebook in one, each entry tagged with whose it is (as
 *  attached lorebooks are): the speaker's first, or (`speakerId` null) in
 *  the group's order, the same every turn. */
function membersLore(members: Member[], speakerId: string | null): Lorebook | undefined {
  const ordered = speakerId ? [...members].sort((a, b) => (a.id === speakerId ? -1 : b.id === speakerId ? 1 : 0)) : members;
  const books = ordered.filter((m) => m.card.character_book?.entries.length);
  if (!books.length) return undefined;
  const first = books[0].card.character_book!;
  return {
    ...first,
    extensions: first.extensions ?? {},
    scan_depth: books.map((m) => m.card.character_book!.scan_depth).find((d) => typeof d === 'number'),
    token_budget: books.map((m) => m.card.character_book!.token_budget).find((d) => typeof d === 'number'),
    recursive_scanning: books.some((m) => m.card.character_book!.recursive_scanning),
    entries: books.flatMap((m) => m.card.character_book!.entries.map((e) => (m.id === speakerId ? e : { ...e, [ENTRY_BOOK]: memberName(m.card) }))),
  };
}

export interface GroupTurn {
  /** The card the reply is written from. */
  card: CardData;
  /** Said last, after the history: whose reply it is (and, in the
   *  cache-friendly layout, everything that changes with them). */
  turnNote: string;
  /** Cast: where each member is. */
  cast?: CastPlace[];
}

export interface TurnExtras {
  /** Members marked in or out of the scene (Cast). */
  presence?: Record<string, 'in' | 'out'>;
  /** Each member's memory of this chat (their notes), by id. */
  memories?: Record<string, string>;
  /** Token count, for Cast's budget. */
  count?: (text: string) => number;
}

/** A member's memory, as their part of the prompt has it. */
const memoryBlock = (name: string, text: string | undefined) => (text?.trim() ? `<memory>\n${name}'s memories of this chat so far:\n${text.trim()}\n</memory>` : '');

/** The card for `speakerId`'s reply in the group, by its strategy. */
export function groupTurn(group: Pick<GroupProject, 'settings' | 'scenario' | 'name'>, members: Member[], speakerId: string, history: ChatMessage[], extras: TurnExtras = {}): GroupTurn {
  const speaker = members.find((m) => m.id === speakerId);
  if (!speaker) throw new Error('The speaker is not in the group.');
  const name = memberName(speaker.card);
  const s = group.settings;
  const memories = extras.memories ?? {};
  const memoryOf = (m: Member) => memoryBlock(memberName(m.card), memories[m.id]);
  const others = members.filter((m) => m.id !== speakerId).map((m) => memberName(m.card));
  const instruction = `[Group chat with ${[name, ...others].join(', ')}. Write only ${name}'s next reply; don't write for the others or for {{user}}.]`;

  if (s.strategy === 'cast' && s.cacheLayout !== false) return cacheFriendlyCast(group, members, speaker, history, extras, instruction);

  const lore = membersLore(members, speakerId);
  const base: CardData = { ...speaker.card, ...(lore ? { character_book: lore } : {}) };
  if (!lore) delete base.character_book;
  const scenario = group.scenario?.trim() ? group.scenario : speaker.card.scenario;

  if (s.strategy === 'swap') {
    const memory = memoryOf(speaker);
    return { card: { ...base, scenario, ...(memory ? { description: `${speaker.card.description.trim()}\n\n${memory}` } : {}) }, turnNote: instruction };
  }

  if (s.strategy === 'join') {
    const pre = s.joinPrefix ?? JOIN_PREFIX;
    const post = s.joinSuffix ?? JOIN_SUFFIX;
    const included = members.filter((m) => m.id === speakerId || !m.muted || s.joinMuted);
    const join = (field: 'description' | 'personality' | 'scenario' | 'mes_example') =>
      included
        .map((m) => {
          const n = memberName(m.card);
          const text = [ownName(m.card[field] ?? '', n).trim(), field === 'description' ? memoryOf(m) : ''].filter(Boolean).join('\n\n');
          return text ? [ownName(pre, n), text, ownName(post, n)].filter((x) => x.trim()).join('\n') : '';
        })
        .filter(Boolean)
        .join('\n\n');
    return {
      card: { ...base, description: join('description'), personality: join('personality'), scenario: group.scenario?.trim() ? group.scenario : join('scenario'), mes_example: join('mes_example') },
      turnNote: instruction,
    };
  }

  // Cast, everything in the card.
  const cast = castScene(members, speakerId, history, s, extras.presence, extras.count);
  const byId = new Map(members.map((m) => [m.id, m]));
  const full = cast.filter((p) => p.tier !== 'offstage').map((p) => block(p.name, [fullBlock(byId.get(p.id)!), memoryOf(byId.get(p.id)!)].filter(Boolean).join('\n\n'), p.tier === 'speaker'));
  const away = cast.filter((p) => p.tier === 'offstage').map((p) => `- ${p.name}: ${memberSummary(byId.get(p.id)!)}`);
  const description = [...full, ...(away.length ? [`<offstage>\nAlso in the story, not in the scene right now:\n${away.join('\n')}\n</offstage>`] : [])].join('\n\n');
  return { card: { ...base, description, personality: '', scenario }, turnNote: instruction, cast };
}

/**
 * Cast, laid out for providers' prompt caches, which reuse a prompt up to
 * where it first changes. What's the same every turn comes first: the
 * group's name as {{char}}, a roster of every character's summary, the
 * group's scenario and every lorebook in the group's order. What changes
 * with each speaker comes after the history, with the instruction: the
 * speaker's card and example messages, those in the scene, and their
 * memories. (A card's own system prompt, which would change with the
 * speaker at the very start, is left out.)
 */
function cacheFriendlyCast(group: Pick<GroupProject, 'settings' | 'scenario' | 'name'>, members: Member[], speaker: Member, history: ChatMessage[], extras: TurnExtras, instruction: string): GroupTurn {
  const s = group.settings;
  const name = memberName(speaker.card);
  const cast = castScene(members, speaker.id, history, s, extras.presence, extras.count);
  const byId = new Map(members.map((m) => [m.id, m]));
  const roster = members.map((m) => `- ${memberName(m.card)}: ${memberSummary(m)}`).join('\n');
  const lore = membersLore(members, null);
  const card: CardData = {
    ...speaker.card,
    name: group.name || 'Group',
    nickname: '',
    description: `<cast>\nThe characters in this story:\n${roster}\n</cast>`,
    personality: '',
    scenario: group.scenario ?? '',
    mes_example: '',
    system_prompt: '',
    ...(lore ? { character_book: lore } : {}),
  };
  if (!lore) delete card.character_book;
  const memories = extras.memories ?? {};
  const part = (p: CastPlace) => {
    const m = byId.get(p.id)!;
    const own = p.tier === 'speaker' && !group.scenario?.trim() && m.card.scenario.trim() ? `${p.name}'s scenario: ${ownName(m.card.scenario, p.name).trim()}` : '';
    return block(p.name, [fullBlock(m), own, memoryBlock(p.name, memories[p.id])].filter(Boolean).join('\n\n'), p.tier === 'speaker');
  };
  const scene = cast.filter((p) => p.tier !== 'offstage').map(part);
  const examples = ownName(speaker.card.mes_example, name).replace(/<START>/gi, '').trim();
  const turnNote = [`<scene>\n${scene.join('\n\n')}\n</scene>`, examples ? `<examples>\nHow ${name} talks:\n${examples}\n</examples>` : '', instruction].filter(Boolean).join('\n\n');
  return { card, turnNote, cast };
}
// ─── The history ────────────────────────────────────────────────────────────

/** The chat as the model reads it in a group: each member's message under
 *  their name ("Ann: …"), so it knows who said what. */
export function namedHistory(messages: ChatMessage[], members: Member[]): ChatMessage[] {
  const names = new Map(members.map((m) => [m.id, memberName(m.card)]));
  return messages.map((m) => {
    const name = m.speaker ? names.get(m.speaker) : undefined;
    if (!name || m.role !== 'assistant') return m;
    const text = shown(m);
    if (text.startsWith(`${name}:`)) return m;
    return { ...m, swipes: m.swipes.map((s, i) => (i === m.swipe ? `${name}: ${s}` : s)) };
  });
}

/** A reply as kept: without the speaker's name in front, and ending where
 *  it starts writing someone else's line. */
export function trimGroupReply(text: string, speaker: string, others: string[]): string {
  let out = text.replace(new RegExp(`^\\s*${escapeRegex(speaker)}:\\s*`), '');
  const names = others.filter((n) => n.trim());
  if (names.length) {
    const m = out.match(new RegExp(`\\n\\s*(?:${names.map(escapeRegex).join('|')}):`));
    if (m?.index !== undefined) out = out.slice(0, m.index);
  }
  return out;
}

// ─── Who speaks next ────────────────────────────────────────────────────────

/** The member to reply next by the group's order (null: manual, or nobody
 *  can). Natural: whoever the last message names (not the last speaker,
 *  unless self-responses are allowed), else by talkativeness; list: the
 *  next in the group's order; pooled: someone who hasn't spoken since your
 *  last message. */
export function nextSpeaker(members: Member[], history: ChatMessage[], settings: GroupSettings, random: () => number = Math.random): string | null {
  const active = members.filter((m) => !m.muted);
  if (!active.length || settings.order === 'manual') return null;
  const lastSpeaker = [...history].reverse().find((m) => m.role === 'assistant' && m.speaker)?.speaker;
  const eligible = active.filter((m) => settings.allowSelfResponses || m.id !== lastSpeaker || active.length === 1);
  if (!eligible.length) return null;
  const pick = (list: Member[]) => list[Math.floor(random() * list.length)]?.id ?? null;
  if (settings.order === 'list') {
    const at = active.findIndex((m) => m.id === lastSpeaker);
    for (let i = 1; i <= active.length; i++) {
      const m = active[(at + i) % active.length];
      if (eligible.includes(m)) return m.id;
    }
    return null;
  }
  if (settings.order === 'pooled') {
    const lastUser = history.map((m) => m.role).lastIndexOf('user');
    const spoke = new Set(history.slice(lastUser + 1).map((m) => m.speaker));
    const fresh = eligible.filter((m) => !spoke.has(m.id));
    return pick(fresh.length ? fresh : eligible);
  }
  // Natural.
  const last = history.at(-1);
  if (last) {
    const named = eligible.filter((m) => mentions(shown(last), m.card));
    if (named.length) return named[0].id;
  }
  const keen = eligible.filter((m) => random() < (m.talkativeness ?? 0.5));
  return pick(keen.length ? keen : eligible);
}

/** The Model order's request: the characters, the recent messages, and
 *  who may speak next (anyone but the last speaker, unless self-responses
 *  are allowed; or you). */
export function directorMessages(members: Member[], history: ChatMessage[], settings: GroupSettings, userName: string): LlmMessage[] {
  const active = members.filter((m) => !m.muted);
  const lastSpeaker = [...history].reverse().find((m) => m.role === 'assistant' && m.speaker)?.speaker;
  const choices = active.filter((m) => settings.allowSelfResponses || m.id !== lastSpeaker || active.length === 1).map((m) => memberName(m.card));
  const names = new Map(members.map((m) => [m.id, memberName(m.card)]));
  const recent = history
    .slice(-12)
    .map((m) => `${m.role === 'user' ? userName : (m.speaker && names.get(m.speaker)) || 'Narrator'}: ${shown(m).replace(/\s+/g, ' ').trim().slice(0, 600)}`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        `You direct a group roleplay chat between ${userName} and these characters. Decide who speaks next: whoever the last message addresses, or who would most naturally react, keeping the scene moving and giving everyone a turn over time. ` +
        `If the last message asks ${userName} something directly, or the scene is waiting on them, it's ${userName}'s turn. Answer with the name only.`,
    },
    {
      role: 'user',
      content: `Characters:\n${active.map((m) => `- ${memberName(m.card)}: ${memberSummary(m)}`).join('\n')}\n\nRecent messages:\n${recent || '(none yet)'}\n\nWho speaks next? Answer with one of: ${[...choices, userName].join(', ')}.`,
    },
  ];
}

/** Who the Model order's answer names: a member, you, or (no name in it) nobody. */
export function readDirector(text: string, members: Member[], userName: string): { speaker: string } | { user: true } | null {
  const answer = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const candidates = [...members.filter((m) => !m.muted).map((m) => ({ id: m.id, names: namesOf(m.card) })), { id: null, names: [userName] }];
  // The name it says first.
  let best: { id: string | null; at: number } | null = null;
  for (const c of candidates)
    for (const n of c.names) {
      const m = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(n)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').exec(answer);
      if (m && (!best || m.index < best.at)) best = { id: c.id, at: m.index };
    }
  if (!best) return null;
  return best.id ? { speaker: best.id } : { user: true };
}
/** A new group chat's opening: each member's greeting (or the first's),
 *  in their own words. */
export function groupGreetings(members: Member[], settings: GroupSettings, make: (speaker: Member, text: string) => ChatMessage): ChatMessage[] {
  const greeters = members.filter((m) => !m.muted && m.card.first_mes.trim());
  return (settings.greetings === 'first' ? greeters.slice(0, 1) : greeters).map((m) => make(m, m.card.first_mes));
}

/** A chat's memory texts by member (for groupTurn). */
export const memoryTexts = (chat: Pick<ChatSession, 'memories'> | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(chat?.memories ?? {}).map(([id, m]) => [id, m.text]));
