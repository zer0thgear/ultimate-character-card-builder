import type { CardData, Lorebook, LorebookEntry } from '@/types/card';
import type { LlmMessage } from '@/types/llm';
import { cardContext, fillTemplate, templateText } from '@/lib/assist';
import { extractJson } from '@/lib/adventure';
import { entryName, newEntry, newLorebook } from '@/lib/cardSpec';
import { packLayer, type LoreLengthOption, type LoreSizeOption } from '@/lib/packLayer';
import { uuid } from '@/lib/uuid';

// The lorebook wizard: a guided session that drafts a whole lorebook with
// you. Two roles, as Adventure mode's Director and actors: the Planner
// plans the entries (and turns what you say into changes to the plan) as
// JSON, and the Writer writes each entry with a call of its own. The calls
// are made by the wizard's window (components/loreWizard); this file builds
// their prompts and reads their replies.

// ─── The session ─────────────────────────────────────────────────────────────

export type WizardStage = 'brief' | 'draft';
/** A built-in length or size, or one an extension pack adds ("<pack>:<id>"). */
export type WizardLength = 'short' | 'medium' | 'long' | (string & {});
export type WizardSize = 'small' | 'medium' | 'large' | (string & {});

/** One entry of the draft: planned (a brief, no text yet) or written. */
export interface WizardEntry {
  id: string;
  name: string;
  category?: string;
  keys: string[];
  always?: boolean;
  /** What the entry will cover, from the plan. */
  brief: string;
  /** Its text; empty until the Writer has written it. */
  content: string;
  /** A change the Planner asked the Writer for, waiting to be written. */
  rewrite?: string;
  /** Why the last write failed. */
  error?: string;
  /** The id of the lorebook entry it came from, in a session
   *  started from the lorebook; saving puts it back there. */
  sourceId?: SourceId;
}

export type SourceId = number | string;

/** A message in the wizard's conversation (yours, or the Planner's). */
export interface WizardMessage {
  role: 'user' | 'wizard';
  text: string;
  runId?: string;
  /** What the Planner changed, said under its message. */
  changes?: string[];
}

export interface WizardSession {
  stage: WizardStage;
  /** The lorebook's name, for a new one. */
  title: string;
  pitch: string;
  focus: string[];
  size: WizardSize;
  length: WizardLength;
  /** Whether the card is sent along (off for a lorebook of its own). */
  useCard: boolean;
  entries: WizardEntry[];
  chat: WizardMessage[];
  /** Started from the lorebook it's for (to review, change and add to it),
   *  with the ids of the entries it brought in. */
  fromBook?: boolean;
  sources?: SourceId[];
}

export const newSession = (useCard = true): WizardSession => ({
  stage: 'brief',
  title: '',
  pitch: '',
  focus: [],
  size: 'medium',
  length: 'medium',
  useCard,
  entries: [],
  chat: [],
});

/** What a lorebook is often about, for the brief's focus chips. */
export const FOCUS_OPTIONS = ['Places', 'People', 'Factions', 'History', 'Customs & beliefs', 'Magic & technology', 'Items', 'Creatures', 'Events'];

export const SIZE_COUNT: Record<'small' | 'medium' | 'large', number> = { small: 8, medium: 15, large: 30 };

export const LENGTH_TEXT: Record<'short' | 'medium' | 'long', string> = {
  short: 'under 80 words',
  medium: 'about 80 to 180 words',
  long: 'about 180 to 350 words',
};

// The brief's choices: the built-in ones, then what enabled extension
// packs add (lib/packLayer.ts).

export const focusOptions = (): string[] => [...new Set([...FOCUS_OPTIONS, ...packLayer().loreFocus])];

export const sizeOptions = (): LoreSizeOption[] => [
  { id: 'small', label: `A few (about ${SIZE_COUNT.small})`, count: SIZE_COUNT.small },
  { id: 'medium', label: `Some (about ${SIZE_COUNT.medium})`, count: SIZE_COUNT.medium },
  { id: 'large', label: `Lots (about ${SIZE_COUNT.large})`, count: SIZE_COUNT.large },
  ...packLayer().loreSizes.map((s) => ({ ...s, label: `${s.label} (about ${s.count})` })),
];

export const lengthOptions = (): LoreLengthOption[] => [
  { id: 'short', label: 'Short (under 80 words)', text: LENGTH_TEXT.short },
  { id: 'medium', label: 'Medium (80–180 words)', text: LENGTH_TEXT.medium },
  { id: 'long', label: 'Long (180–350 words)', text: LENGTH_TEXT.long },
  ...packLayer().loreLengths,
];

/** How many entries to plan; a pack's size that's gone (uninstalled) counts as medium. */
export const entryCount = (size: WizardSize) => sizeOptions().find((o) => o.id === size)?.count ?? SIZE_COUNT.medium;
/** How long an entry should be, for the Writer; medium when the choice is gone. */
export const lengthText = (length: WizardLength) => lengthOptions().find((o) => o.id === length)?.text ?? LENGTH_TEXT.medium;

export const isWritten = (e: WizardEntry) => !!e.content.trim();

/** Entries waiting for the Writer: never written, or with a change asked for. */
export const toWrite = (entries: WizardEntry[]) => entries.filter((e) => !isWritten(e) || e.rewrite);

/** A lorebook as a draft: every entry, written, tied to the
 *  entry it came from. */
export function entriesFromBook(book: Lorebook | undefined): WizardEntry[] {
  return (book?.entries ?? []).map((e, i) => ({
    id: uuid(),
    name: entryName(e) || e.keys[0] || `Entry ${i + 1}`,
    keys: [...e.keys],
    ...(e.constant ? { always: true } : {}),
    brief: '',
    content: e.content,
    ...(e.id !== undefined ? { sourceId: e.id } : {}),
  }));
}

/** The lorebook's entries that were brought into the draft and taken out
 *  of it since (saving removes them from the card). */
export function droppedSources(s: WizardSession): SourceId[] {
  const kept = new Set(s.entries.map((e) => e.sourceId).filter((id) => id !== undefined));
  return (s.sources ?? []).filter((id) => !kept.has(id));
}

// ─── Reading replies ─────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

const keysOf = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v.map(str) : typeof v === 'string' ? v.split(',').map((k) => k.trim()) : [];
  const seen = new Set<string>();
  return list.filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
};

const boolOf = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined);

function toEntry(raw: unknown): WizardEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = str(o.name ?? o.title ?? o.entry);
  if (!name) return null;
  const always = boolOf(o.always ?? o.constant);
  return {
    id: uuid(),
    name,
    ...(str(o.category) ? { category: str(o.category) } : {}),
    keys: keysOf(o.keys ?? o.key ?? o.triggers),
    ...(always ? { always } : {}),
    brief: str(o.brief ?? o.summary ?? o.description),
    content: '',
  };
}

/** The Planner's first plan: its message and the entries it planned. A
 *  reply that isn't JSON is kept as the message, with no entries. */
export function parsePlan(text: string): { message: string; entries: WizardEntry[]; parsed: boolean } {
  const json = extractJson(text) as Record<string, unknown> | null;
  if (!json || typeof json !== 'object') return { message: text.trim(), entries: [], parsed: false };
  const list = Array.isArray(json.entries) ? json.entries : Array.isArray(json.plan) ? json.plan : [];
  const entries = list.map(toEntry).filter((e): e is WizardEntry => !!e);
  return { message: str(json.message), entries: dedupeByName(entries), parsed: true };
}

const norm = (s: string) => s.trim().toLowerCase();

function dedupeByName(entries: WizardEntry[]): WizardEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => !seen.has(norm(e.name)) && seen.add(norm(e.name)));
}

export type WizardChange =
  | { op: 'add'; entry: WizardEntry }
  | { op: 'edit'; entry: string; name?: string; keys?: string[]; always?: boolean; brief?: string; rewrite?: string }
  | { op: 'remove'; entry: string };

/** The Planner's answer to your message: what it says, and what it changes. */
export function parseRevision(text: string): { message: string; changes: WizardChange[]; parsed: boolean } {
  const json = extractJson(text) as Record<string, unknown> | null;
  if (!json || typeof json !== 'object') return { message: text.trim(), changes: [], parsed: false };
  const changes: WizardChange[] = [];
  for (const raw of Array.isArray(json.changes) ? json.changes : []) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const op = str(o.op ?? o.action).toLowerCase();
    if (op === 'add') {
      const entry = toEntry(o);
      if (entry) changes.push({ op: 'add', entry });
    } else if (op === 'remove' || op === 'delete') {
      const entry = str(o.entry ?? o.name);
      if (entry) changes.push({ op: 'remove', entry });
    } else if (op === 'edit' || op === 'change' || op === 'rewrite') {
      const entry = str(o.entry ?? o.name);
      if (!entry) continue;
      const renamed = o.entry !== undefined ? str(o.name) : '';
      const keys = o.keys !== undefined ? keysOf(o.keys) : undefined;
      const always = boolOf(o.always ?? o.constant);
      const brief = str(o.brief);
      const rewrite = str(o.rewrite ?? o.instruction ?? (op === 'rewrite' ? o.change : ''));
      changes.push({
        op: 'edit',
        entry,
        ...(renamed && norm(renamed) !== norm(entry) ? { name: renamed } : {}),
        ...(keys?.length ? { keys } : {}),
        ...(always !== undefined ? { always } : {}),
        ...(brief ? { brief } : {}),
        ...(rewrite ? { rewrite } : {}),
      });
    }
  }
  return { message: str(json.message), changes, parsed: true };
}

/** The entry a change names: by name, else the only one whose name holds
 *  it (or is held by it). */
export function findEntry(entries: WizardEntry[], name: string): WizardEntry | undefined {
  const n = norm(name);
  const exact = entries.find((e) => norm(e.name) === n);
  if (exact) return exact;
  const near = entries.filter((e) => norm(e.name).includes(n) || n.includes(norm(e.name)));
  return near.length === 1 ? near[0] : undefined;
}

/** The Planner's changes applied to the draft, with a line about each for
 *  you (and one for each it named an entry that isn't there). A written
 *  entry's rewrite waits for the Writer (see toWrite). */
export function applyChanges(entries: WizardEntry[], changes: WizardChange[]): { entries: WizardEntry[]; notes: string[] } {
  let next = [...entries];
  const notes: string[] = [];
  for (const c of changes) {
    if (c.op === 'add') {
      if (next.some((e) => norm(e.name) === norm(c.entry.name))) {
        notes.push(`"${c.entry.name}" is already there`);
        continue;
      }
      next.push(c.entry);
      notes.push(`+ ${c.entry.name}`);
      continue;
    }
    const target = findEntry(next, c.entry);
    if (!target) {
      notes.push(`couldn't find "${c.entry}"`);
      continue;
    }
    if (c.op === 'remove') {
      next = next.filter((e) => e.id !== target.id);
      notes.push(`− ${target.name}`);
      continue;
    }
    const patch: Partial<WizardEntry> = {};
    const what: string[] = [];
    if (c.name) {
      patch.name = c.name;
      what.push(`renamed to "${c.name}"`);
    }
    if (c.keys) {
      patch.keys = c.keys;
      what.push('keys');
    }
    if (c.always !== undefined && c.always !== !!target.always) {
      patch.always = c.always;
      what.push(c.always ? 'always on' : 'on keys');
    }
    if (c.brief) {
      patch.brief = c.brief;
      what.push('plan');
    }
    if (c.rewrite && isWritten(target)) {
      patch.rewrite = target.rewrite ? `${target.rewrite}\n${c.rewrite}` : c.rewrite;
      what.push('to rewrite');
    } else if (c.rewrite) {
      // Not written yet: the change goes into its plan.
      patch.brief = `${patch.brief ?? target.brief} ${c.rewrite}`.trim();
      what.push('plan');
    }
    if (!what.length) continue;
    next = next.map((e) => (e.id === target.id ? { ...e, ...patch, error: undefined } : e));
    notes.push(`✎ ${target.name}: ${[...new Set(what)].join(', ')}`);
  }
  return { entries: next, notes };
}

/** The Writer's reply as entry text: without a code fence, a "CONTENT:"
 *  label or quotes around the whole of it. */
export function cleanEntryText(text: string): string {
  let t = text.trim();
  const fenced = t.match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
  if (fenced) t = fenced[1].trim();
  t = t.replace(/^(?:content|entry|text)\s*:\s*/i, '');
  if (/^"[\s\S]*"$/.test(t) && !t.slice(1, -1).includes('"')) t = t.slice(1, -1).trim();
  return t;
}

// ─── Keys ────────────────────────────────────────────────────────────────────

// Words too common to be a key: they'd fire the entry all the time.
const COMMON = new Set(
  'the a an and or of to in on at is it he she they we you i me my his her their our your this that there here what who where when how why yes no not man woman men women boy girl city town house home room day night time way thing people place world king queen god gods war love life one two'.split(' '),
);

/** What's wrong with an entry's keys, for a hint beside it: none (and not
 *  always on), a key another entry has too, or a key too common or short. */
export function keyWarnings(entries: WizardEntry[]): Record<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const e of entries) for (const k of e.keys) owners.set(norm(k), [...(owners.get(norm(k)) ?? []), e.name]);
  const out: Record<string, string[]> = {};
  for (const e of entries) {
    const w: string[] = [];
    if (!e.keys.length && !e.always) w.push('no keys, so it never fires');
    for (const k of e.keys) {
      const others = (owners.get(norm(k)) ?? []).filter((n) => n !== e.name);
      if (others.length) w.push(`"${k}" also fires ${others.join(', ')}`);
      else if (!k.startsWith('/') && (COMMON.has(norm(k)) || norm(k).length < 3)) w.push(`"${k}" is too common`);
    }
    if (w.length) out[e.id] = w;
  }
  return out;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The card as context, without its lorebook (that's listed on its own). */
function cardOnly(card: CardData | undefined, budget: number): string {
  if (!card) return '';
  const rest = { ...card };
  delete rest.character_book;
  return cardContext(rest, undefined, budget);
}

/** A lorebook's entries as names and keys, so the plan doesn't repeat it. */
export function existingContext(book: Lorebook | undefined): string {
  return (book?.entries ?? [])
    .filter((e) => e.content.trim() || entryName(e))
    .map((e) => `- ${entryName(e) || e.keys[0] || 'unnamed'}${e.constant ? ' (always on)' : e.keys.length ? ` (keys: ${e.keys.join(', ')})` : ''}`)
    .join('\n');
}

const attr = (v: string) => v.replace(/"/g, "'");

/** The draft for the Planner: each entry with its keys, and its brief
 *  (planned) or its text, cut short (written). */
export function draftContext(entries: WizardEntry[], perEntry = 500): string {
  if (!entries.length) return '(nothing planned yet)';
  return entries
    .map((e) => {
      const keys = e.always ? 'always on' : e.keys.join(', ');
      const body = isWritten(e) ? clip(e.content.trim(), perEntry) : `(planned) ${e.brief}`;
      return `<entry name="${attr(e.name)}" keys="${attr(keys)}"${e.category ? ` category="${attr(e.category)}"` : ''}>\n${body}\n</entry>`;
    })
    .join('\n');
}

/** The plan for the Writer: every entry's name and brief. */
export function planContext(entries: WizardEntry[]): string {
  return entries.map((e) => `- ${e.name}${e.category ? ` (${e.category})` : ''}: ${e.brief || '(no brief)'}`).join('\n');
}

/** The entries written so far, but `skipId`, for the Writer to stay
 *  consistent with: in full while they fit `budget`, else each cut evenly. */
export function writtenContext(entries: WizardEntry[], skipId: string | undefined, budget = 9000): string {
  const done = entries.filter((e) => e.id !== skipId && isWritten(e));
  if (!done.length) return '';
  const total = done.reduce((n, e) => n + e.content.trim().length, 0);
  const share = total <= budget ? Infinity : Math.max(120, Math.floor(budget / done.length));
  return done.map((e) => `<entry name="${attr(e.name)}">\n${clip(e.content.trim(), share)}\n</entry>`).join('\n');
}

const conversation = (chat: WizardMessage[], keep = 12) =>
  chat
    .slice(-keep)
    .map((m) => `${m.role === 'user' ? 'Creator' : 'You'}: ${clip(m.text.trim(), 1200)}`)
    .join('\n');

const messages = (system: string, user: string): LlmMessage[] => [...(system ? [{ role: 'system' as const, content: system }] : []), { role: 'user', content: user }];

/** The Planner's first plan, from the brief. `book`: the lorebook the
 *  entries are for, when it isn't the card's (one in 📖 Lorebooks). */
export function planMessages(s: WizardSession, card: CardData | undefined, book?: Lorebook): LlmMessage[] {
  const focus = s.focus.length ? s.focus.join(', ') : '';
  return messages(
    fillTemplate(templateText('loreWizard.planner'), {}),
    fillTemplate(templateText('loreWizard.plan'), {
      card: s.useCard ? cardOnly(card, 10000) : '',
      existing: existingContext(book ?? (s.useCard ? card?.character_book : undefined)),
      pitch: s.pitch.trim() || (s.useCard ? '(none: plan the lorebook this card needs)' : '(none)'),
      focus,
      count: String(entryCount(s.size)),
    }),
  );
}

/** The Planner's first look at a lorebook brought into the draft:
 *  its thoughts, and the changes it proposes. */
export function reviewMessages(s: WizardSession, card: CardData | undefined): LlmMessage[] {
  return messages(
    fillTemplate(templateText('loreWizard.planner'), {}),
    fillTemplate(templateText('loreWizard.review'), {
      card: s.useCard ? cardOnly(card, 8000) : '',
      draft: draftContext(s.entries, 1500),
      pitch: s.pitch.trim() || 'Thoughts on the lorebook, and the changes and new entries that would make it better.',
      focus: s.focus.join(', '),
    }),
  );
}

/** The Planner, on your message about the draft. */
export function reviseMessages(s: WizardSession, card: CardData | undefined, message: string): LlmMessage[] {
  return messages(
    fillTemplate(templateText('loreWizard.planner'), {}),
    fillTemplate(templateText('loreWizard.revise'), {
      card: s.useCard ? cardOnly(card, 6000) : '',
      pitch: s.pitch.trim(),
      draft: draftContext(s.entries),
      conversation: conversation(s.chat),
      message: message.trim(),
    }),
  );
}

/** The Writer, on one entry (a rewrite when it's written and a change is
 *  asked for, or `instruction` is given). */
export function writeMessages(s: WizardSession, card: CardData | undefined, entry: WizardEntry, instruction = ''): LlmMessage[] {
  const change = [entry.rewrite, instruction].filter((t) => t?.trim()).join('\n');
  const rewriting = isWritten(entry) && !!change;
  return messages(
    fillTemplate(templateText('loreWizard.writer'), {}),
    fillTemplate(templateText('loreWizard.write'), {
      card: s.useCard ? cardOnly(card, 8000) : '',
      plan: planContext(s.entries),
      written: writtenContext(s.entries, entry.id),
      current: rewriting ? entry.content.trim() : '',
      name: entry.name,
      keys: entry.always ? 'always on' : entry.keys.join(', ') || 'none yet',
      brief: entry.brief || entry.name,
      instruction: change,
      length: lengthText(s.length),
    }),
  );
}

// ─── Saving ──────────────────────────────────────────────────────────────────

/** The written entries as card lorebook entries, numbered after `existing`. */
export function toLorebookEntries(entries: WizardEntry[], existing: LorebookEntry[] = []): LorebookEntry[] {
  const out: LorebookEntry[] = [];
  for (const e of entries.filter(isWritten)) {
    out.push({ ...newEntry([...existing, ...out]), name: e.name, comment: e.name, keys: e.keys, constant: !!e.always, content: e.content.trim() });
  }
  return out;
}

/** A lorebook with the written entries in it. An entry that came from the
 *  lorebook (sourceId) goes back in its place, keeping its other settings;
 *  with `replace`, so does one with the same name as one already there,
 *  rather than being added beside it. `remove` drops the entries with
 *  those ids (ones taken out of the draft). Only entries that changed
 *  count as replaced. */
export function saveToBook(
  book: Lorebook | undefined,
  entries: WizardEntry[],
  opts: { replace?: boolean; name?: string; remove?: SourceId[] } = {},
): { book: Lorebook; added: number; replaced: number; removed: number } {
  const base = book ?? { ...newLorebook(), ...(opts.name?.trim() ? { name: opts.name.trim() } : {}) };
  const drop = new Set(opts.remove ?? []);
  let list = base.entries.filter((x) => x.id === undefined || !drop.has(x.id));
  const removed = base.entries.length - list.length;
  let replaced = 0;
  const fresh: WizardEntry[] = [];
  for (const e of entries.filter(isWritten)) {
    let at = e.sourceId !== undefined ? list.findIndex((x) => x.id === e.sourceId) : -1;
    const own = at >= 0;
    if (!own && opts.replace) at = list.findIndex((x) => norm(entryName(x)) === norm(e.name));
    if (at < 0) {
      fresh.push(e);
      continue;
    }
    const was = list[at];
    const next = { ...was, keys: e.keys, constant: !!e.always, content: e.content.trim(), ...(own && entryName(was) !== e.name ? { name: e.name, comment: e.name } : {}) };
    const changed = was.content.trim() !== next.content || !!was.constant !== next.constant || was.keys.join('\n') !== next.keys.join('\n') || entryName(was) !== entryName(next);
    if (!changed) continue;
    list = list.map((x, i) => (i === at ? next : x));
    replaced++;
  }
  const added = toLorebookEntries(fresh, list);
  return { book: { ...base, entries: [...list, ...added] }, added: added.length, replaced, removed };
}
