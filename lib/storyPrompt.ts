import type { CardData, Lorebook, LorebookEntry } from '@/types/card';
import type { LlmMessage } from '@/types/llm';
import type { StoryPersona, StorySession } from '@/types/project';
import { expandMacros } from '@/lib/macros';
import { describeEntry, scanLorebook, type ActivatedEntry } from '@/lib/lorebookScan';
import { extractJson } from '@/lib/adventure';

// Writing mode: a story written together with the model, as one flat
// document (NovelAI's story mode). What goes in front of the story is the
// memory, the Cast members whose names are in the recent text (read
// like lorebook entries), and the card's lorebook entries the text brings
// in. A text-completion connection gets it all as one raw prompt and simply
// writes on; a chat connection is asked for the next part, which a second
// call can proofread so it joins the story cleanly.

export const DEFAULT_STORY_WORDS = 200;
export const DEFAULT_STORY_SCAN_DEPTH = 6;
/** Lines from the end of the story the author's note goes (as NovelAI puts
 *  it, three newlines back). */
export const STORY_NOTE_DEPTH = 3;

export const DEFAULT_STORY_INSTRUCTIONS = `You are a co-author writing a story together with the user. You are given the story so far; write the next part of it.

- Continue from exactly where the text stops. If it stops mid-sentence, finish that sentence first, without repeating any of it.
- Write only the new text: no title, no summary, no notes or commentary, no quotation of what's already written.
- Keep the story's voice: its tense, point of view, style and formatting.
- Move the story forward a little, and leave room for the user to steer it. Don't end the story.
- Write about {{words}} words.`;

export const DEFAULT_PROOFREAD_PROMPT = `You proofread a continuation that was written for a story, so that it joins the story seamlessly. You are given the end of the story and the continuation.

Fix only these, changing nothing else:
- Text at the start that repeats what the story already says: remove it.
- A first sentence that doesn't join where the story stops (the story stops mid-sentence and the continuation starts over, or the reverse): make it join.
- Anything that isn't story text: headings, notes, commentary, questions to the reader, quotation marks or tags around the whole thing. Remove it.
- An ending cut off mid-sentence: end it at the last complete sentence.

Reply with the corrected continuation only, nothing before or after it. If nothing needs fixing, reply with it unchanged.`;

/** The names and descriptions macros and linked personae read. */
export interface StoryContext {
  card: CardData;
  userName: string;
  userDescription: string;
}

const x = (text: string, ctx: StoryContext) => expandMacros(text, { char: ctx.card.name || 'Character', user: ctx.userName || 'User' });

/** A story's settings filled in where it doesn't say (stories saved before
 *  a setting existed, or written by hand). */
export function normalizeStory(s: Partial<StorySession> & Pick<StorySession, 'id'>): StorySession {
  const now = Date.now();
  return {
    name: 'Story',
    text: '',
    memory: '',
    authorsNote: '',
    personae: [],
    useLorebook: true,
    scanDepth: DEFAULT_STORY_SCAN_DEPTH,
    proofread: false,
    words: DEFAULT_STORY_WORDS,
    createdAt: now,
    updatedAt: now,
    ...s,
  };
}

/** The Cast a new story starts with: the card's character and
 *  you, both read live from the card and your persona. */
export function defaultPersonae(newId: () => string): StoryPersona[] {
  return [
    { id: newId(), name: '', aliases: [], description: '', always: true, enabled: true, link: 'char' },
    { id: newId(), name: '', aliases: [], description: '', always: true, enabled: true, link: 'user' },
  ];
}

/** A persona's name and description as the prompt gets them (a linked one
 *  from the card or your persona). */
export function personaFields(p: StoryPersona, ctx: StoryContext): { name: string; description: string } {
  if (p.link === 'char') {
    const c = ctx.card;
    const description = [c.description.trim(), c.personality.trim() && `Personality: ${c.personality.trim()}`].filter(Boolean).join('\n');
    return { name: c.name || 'Character', description: x(description, ctx) };
  }
  if (p.link === 'user') return { name: ctx.userName || 'User', description: x(ctx.userDescription, ctx) };
  return { name: p.name.trim(), description: x(p.description, ctx) };
}

/** The story's paragraphs (non-empty lines), oldest first: what names and
 *  lorebook keys are looked for in. */
export const storyParagraphs = (text: string) => text.split(/\n+/).filter((l) => l.trim());

/** The Cast as a lorebook, so they're read the way lorebook
 *  entries are: a name (or alias) in the recent text brings one in. */
export function personaeBook(personae: StoryPersona[], ctx: StoryContext): Lorebook {
  const entries: LorebookEntry[] = personae.map((p, i) => {
    const f = personaFields(p, ctx);
    return {
      keys: [f.name, ...p.aliases].map((k) => k.trim()).filter(Boolean),
      content: f.description.trim() ? `${f.name}: ${f.description.trim()}` : '',
      extensions: {},
      enabled: p.enabled && !!f.description.trim(),
      insertion_order: i,
      use_regex: false,
      constant: p.always,
      name: f.name,
    };
  });
  return { entries, extensions: {} };
}

export interface StoryLore {
  /** The Cast members going in, each as "Name: description". */
  personae: { name: string; text: string; reason: string }[];
  /** The card's lorebook entries the story brings in. */
  lore: ActivatedEntry[];
}

/** Which Cast members and lorebook entries the end of the story brings in. */
export function storyLore(story: Pick<StorySession, 'text' | 'personae' | 'useLorebook' | 'scanDepth'>, ctx: StoryContext, opts: { count?: (t: string) => number; random?: () => number } = {}): StoryLore {
  const paragraphs = storyParagraphs(story.text);
  const scanDepth = Math.max(1, story.scanDepth || DEFAULT_STORY_SCAN_DEPTH);
  const cast = scanLorebook(personaeBook(story.personae, ctx), paragraphs, { scanDepth, count: opts.count, random: () => 0 });
  const personae = cast.active
    .sort((a, b) => a.index - b.index)
    .map((a) => ({ name: a.entry.name ?? '', text: a.entry.content, reason: a.reason }));
  const book = story.useLorebook ? ctx.card.character_book : undefined;
  const lore = book ? scanLorebook(book, paragraphs, { scanDepth, count: opts.count, random: opts.random }).active : [];
  return { personae, lore: lore.map((a) => ({ ...a, entry: { ...a.entry, content: x(a.entry.content, ctx) } })) };
}

/** The end of the story that fits in `budget` tokens, starting at a
 *  paragraph (or, for one paragraph too long, a word). */
export function fitStory(text: string, budget: number | undefined, count: (t: string) => number): { text: string; trimmed: boolean } {
  if (budget === undefined || count(text) <= budget) return { text, trimmed: false };
  if (budget <= 0) return { text: '', trimmed: true };
  const lines = text.split('\n');
  let kept = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const next = i === lines.length - 1 ? lines[i] : `${lines[i]}\n${kept}`;
    if (count(next) > budget) break;
    kept = next;
  }
  if (kept.trim()) return { text: kept.replace(/^\n+/, ''), trimmed: true };
  // Even the last paragraph is too long: its end, from a word.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (count(text.slice(mid)) <= budget) hi = mid;
    else lo = mid + 1;
  }
  const rest = text.slice(lo);
  const word = rest.search(/\s/);
  return { text: word >= 0 ? rest.slice(word).trimStart() : rest, trimmed: true };
}

/** The story with a bracketed line put `depth` lines from its end. */
export function insertNote(text: string, note: string, depth = STORY_NOTE_DEPTH): string {
  if (!note.trim()) return text;
  const line = `[ ${note.trim()} ]`;
  if (!text) return line + '\n';
  const lines = text.split('\n');
  const at = Math.max(0, lines.length - depth);
  return [...lines.slice(0, at), line, ...lines.slice(at)].join('\n');
}

export interface StoryRequestOptions {
  /** Raw text completion (one prompt the model writes on from) or chat. */
  mode: 'text' | 'chat';
  /** Context size and reply length, in tokens, to trim the story's start. */
  maxContext?: number;
  maxTokens?: number;
  /** A one-off steer for this continuation. */
  direction?: string;
  /** The chat instructions (`{{words}}` for the length). */
  instructions?: string;
  count?: (t: string) => number;
  random?: () => number;
}

export interface StoryRequest {
  messages: LlmMessage[];
  /** Text completion: the whole prompt. */
  prompt?: string;
  lore: StoryLore;
  /** The start of the story didn't fit and was left out. */
  trimmed: boolean;
}

const defaultCount = (t: string) => Math.ceil(t.length / 3.5);

/** What's sent to continue the story. */
export function buildStoryRequest(story: StorySession, ctx: StoryContext, opts: StoryRequestOptions): StoryRequest {
  const count = opts.count ?? defaultCount;
  const lore = storyLore(story, ctx, { count, random: opts.random });
  const memory = x(story.memory, ctx).trim();
  const note = x(story.authorsNote, ctx).trim();
  const direction = (opts.direction ?? '').trim();
  const budget = (fixed: string) => (opts.maxContext ? opts.maxContext - (opts.maxTokens ?? 0) - count(fixed) - 16 : undefined);

  if (opts.mode === 'text') {
    const head = [memory, [...lore.personae.map((p) => p.text), ...lore.lore.map((a) => a.entry.content.trim())].filter(Boolean).join('\n')].filter(Boolean);
    const steer = [note && `Author's note: ${note}`, direction && `Next: ${direction}`].filter(Boolean).join(' ');
    const top = head.length ? head.join('\n***\n') + '\n***\n' : '';
    const fit = fitStory(story.text, budget(top + steer), count);
    const prompt = top + insertNote(fit.text, steer);
    return { prompt, messages: [{ role: 'user', content: prompt }], lore, trimmed: fit.trimmed };
  }

  const words = String(Math.max(20, story.words || DEFAULT_STORY_WORDS));
  const instructions = (opts.instructions?.trim() || DEFAULT_STORY_INSTRUCTIONS).replace(/\{\{words\}\}/gi, words);
  const sections = [
    memory && `## Memory\n${memory}`,
    lore.personae.length && `## Cast\n${lore.personae.map((p) => p.text.trim()).join('\n\n')}`,
    lore.lore.length && `## World\n${lore.lore.map((a) => a.entry.content.trim()).filter(Boolean).join('\n\n')}`,
  ].filter(Boolean);
  const system = [instructions, ...sections].join('\n\n');
  const after = [note && `Author's note (keep this in mind): ${note}`, direction && `For this part: ${direction}`].filter(Boolean).join('\n');
  const ask = story.text.trim() ? 'Continue the story from exactly where it stops.' : 'Begin the story.';
  const fit = fitStory(story.text, budget(system + after + ask + '<story>\n</story>\n\n'), count);
  const user = (story.text.trim() ? `<story>\n${fit.trimmed ? '[…]\n' : ''}${fit.text}\n</story>\n\n` : '') + (after ? `${after}\n\n` : '') + ask;
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], lore, trimmed: fit.trimmed };
}

/** How much of the story's end the proofreader sees. */
const PROOFREAD_TAIL = 2000;

/** The proofreading call: the end of the story and the continuation. */
export function proofreadMessages(story: string, continuation: string, prompt?: string): LlmMessage[] {
  const tail = story.length > PROOFREAD_TAIL ? story.slice(-PROOFREAD_TAIL).replace(/^\S*\s/, '') : story;
  return [
    { role: 'system', content: prompt?.trim() || DEFAULT_PROOFREAD_PROMPT },
    { role: 'user', content: `<story_end>\n${tail}\n</story_end>\n\n<continuation>\n${continuation}\n</continuation>\n\nReply with the corrected continuation only.` },
  ];
}

/**
 * A chat model's continuation, cleaned up: wrappers around it (code fences,
 * <continuation> or <story> tags) gone, and any start of it that repeats the
 * end of the story dropped.
 */
export function cleanContinuation(output: string, story: string): string {
  const unwrap = (t: string) =>
    t
      .replace(/^\s*```[a-z]*\n/i, '')
      .replace(/\n?```\s*$/, '')
      .replace(/^\s*<(continuation|story)>\n?/i, '')
      .replace(/\n?<\/(continuation|story)>\s*$/i, '');
  let out = unwrap(output);
  // The model starting over with the story's last words: keep what's new.
  const end = story.trimEnd();
  const lead = out.trimStart();
  const max = Math.min(end.length, lead.length, 400);
  for (let n = max; n >= 12; n--) {
    if (lead.startsWith(end.slice(-n))) {
      out = unwrap(lead.slice(n));
      break;
    }
  }
  return out.trimEnd();
}

/**
 * Where a chat model's continuation (which comes back trimmed) meets the
 * story: a space between words, nothing before punctuation or after an
 * opening bracket or dash, and a text-completion model's own spacing kept.
 */
export function joinContinuation(story: string, output: string): string {
  if (!story || !output) return output;
  if (/\s$/.test(story) || /^\s/.test(output)) return output;
  if (/^[,.;:!?)\]}…'’]/.test(output)) return output;
  if (/[(\[{“—–-]$/.test(story)) return output;
  return ' ' + output;
}

/** The latest take, if it's still the story's end (not edited since). */
export function currentTake(story: Pick<StorySession, 'text' | 'last'>) {
  const t = story.last;
  if (!t || t.start > story.text.length) return null;
  return story.text.slice(t.start) === (t.outputs[t.index] ?? '') && t.outputs[t.index] ? t : null;
}

/** For the lore panel: why each entry went in. */
export const loreLabels = (lore: StoryLore) => [
  ...lore.personae.map((p) => ({ kind: 'persona' as const, name: p.name, reason: p.reason })),
  ...lore.lore.map((a) => ({ kind: 'lore' as const, name: describeEntry(a), reason: a.reason })),
];

export const storyWordCount = (text: string) => (text.match(/\S+/g) ?? []).length;

/** The story as a plain text file. */
export const storyFileName = (name: string) => `${(name.trim() || 'Story').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.txt`;

// ─── Scanning the story for new Cast members ─────────────────────────────────

/** How much of the story's end the scan reads, in characters. */
const SCAN_TAIL = 24000;

export interface CastSuggestion {
  name: string;
  aliases: string[];
  description: string;
}

/** Everyone already in the Cast, by every name, lowercased. */
export function castNames(personae: StoryPersona[], ctx: StoryContext): Set<string> {
  const names = new Set<string>();
  for (const p of personae) for (const n of [personaFields(p, ctx).name, ...p.aliases]) if (n.trim()) names.add(n.trim().toLowerCase());
  return names;
}

/** The scan: the story (its end, if it's long) and who's in the Cast already. */
export function castScanMessages(story: Pick<StorySession, 'text' | 'personae'>, ctx: StoryContext): LlmMessage[] {
  const known = story.personae.map((p) => personaFields(p, ctx).name).filter(Boolean);
  const text = story.text.length > SCAN_TAIL ? story.text.slice(-SCAN_TAIL).replace(/^\S*\s/, '') : story.text;
  return [
    {
      role: 'system',
      content: `You read a story and list the named characters in it who aren't in its cast list yet, so the writer can add them. For each one, give their name, any other names or titles the story calls them by, and a short description (two or three sentences) drawn only from what the story says: who they are, how they look and act, how they relate to the others. Leave out anyone already in the cast (by any of their names), unnamed extras, and people only mentioned in passing.

Reply with JSON only, in this shape: {"cast": [{"name": "…", "aliases": ["…"], "description": "…"}]}. If there's no one to add, reply {"cast": []}.`,
    },
    { role: 'user', content: `Already in the cast: ${known.length ? known.join(', ') : '(no one)'}\n\n<story>\n${text}\n</story>` },
  ];
}

/** The scan's reply as new Cast members: each with a name, none already in
 *  the Cast (by any name) or listed twice. */
export function parseCastSuggestions(text: string, known: Set<string>): CastSuggestion[] | null {
  const raw = extractJson(text) as { cast?: unknown } | unknown[] | null;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { cast?: unknown }).cast) ? ((raw as { cast: unknown[] }).cast) : null;
  if (!list) return null;
  const seen = new Set(known);
  const out: CastSuggestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name) continue;
    const aliases = (Array.isArray(r.aliases) ? r.aliases : []).filter((a): a is string => typeof a === 'string').map((a) => a.trim()).filter((a) => a && a.toLowerCase() !== name.toLowerCase());
    if ([name, ...aliases].some((n) => seen.has(n.toLowerCase()))) continue;
    for (const n of [name, ...aliases]) seen.add(n.toLowerCase());
    out.push({ name, aliases, description: typeof r.description === 'string' ? r.description.trim() : '' });
  }
  return out;
}
