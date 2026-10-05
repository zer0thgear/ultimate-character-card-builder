import type { Lorebook, LorebookEntry } from '@/types/card';
import { entryName } from '@/lib/cardSpec';
import { entryBook } from '@/lib/lorebookBank';

// Which lorebook entries a chat turn activates, as SillyTavern reads them:
// an entry fires when one of its keys appears in the last `scan_depth`
// messages (or always, if constant); a selective entry also checks its
// secondary keys, by its logic (AND ANY, AND ALL, NOT ANY, NOT ALL). With
// recursive scanning, fired entries' content is scanned too. SillyTavern's
// own rules, kept in the entry's extensions, apply as it applies them: the
// trigger %, inclusion groups, recursion switches, per-entry scan depth,
// whole-word and case matching, and the timed effects (sticky, cooldown,
// delay). Entries go in by insertion_order, and past the token budget the
// lowest-priority ones are dropped first.

export const DEFAULT_SCAN_DEPTH = 2;
/** How many times recursive scanning goes round, at most. */
export const DEFAULT_MAX_RECURSION = 5;

/** What the scan falls back on where a lorebook doesn't say (the test
 *  chat's settings); a lorebook's own scan depth and budget win. */
export interface LoreDefaults {
  scanDepth?: number;
  /** Tokens; 0 or none: no limit. */
  tokenBudget?: number;
  maxRecursion?: number;
}

export interface ActivatedEntry {
  entry: LorebookEntry;
  index: number;
  /** Why it fired: 'constant', 'sticky', or the key that matched. */
  reason: string;
}

/** An entry whose keys matched but that was kept out, and why. */
export interface SkippedEntry {
  entry: LorebookEntry;
  index: number;
  reason: string;
}

export interface ScanResult {
  active: ActivatedEntry[];
  /** Entries that fired but didn't fit the token budget. */
  dropped: ActivatedEntry[];
  /** Entries that matched but lost a roll or a group, or are cooling down. */
  skipped?: SkippedEntry[];
}

/** SillyTavern's secondary-key logic (its `selectiveLogic` numbers). */
export const SELECTIVE_LOGIC = { andAny: 0, notAll: 1, notAny: 2, andAll: 3 } as const;
export type SelectiveLogic = (typeof SELECTIVE_LOGIC)[keyof typeof SELECTIVE_LOGIC];

/** The rules SillyTavern keeps in an entry's extensions, read with its
 *  defaults. */
export interface EntryRules {
  logic: SelectiveLogic;
  /** 0–100; 100 always fires. */
  chance: number;
  groups: string[];
  groupOverride: boolean;
  groupWeight: number;
  groupScoring: boolean;
  /** Not fired by other entries' content, only by the chat. */
  excludeRecursion: boolean;
  /** Its content isn't scanned for other entries' keys. */
  preventRecursion: boolean;
  /** Fires only from other entries' content: from this recursion step on (0: not delayed). */
  delayUntilRecursion: number;
  scanDepth?: number;
  wholeWords?: boolean;
  caseSensitive?: boolean;
  /** Messages it stays in for once fired. */
  sticky: number;
  /** Messages it can't fire for after it has. */
  cooldown: number;
  /** Messages the chat needs before it can fire. */
  delay: number;
  /** Never dropped over the token budget. */
  ignoreBudget: boolean;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

export function entryRules(e: LorebookEntry): EntryRules {
  const x = (e.extensions ?? {}) as Record<string, unknown>;
  const logic = num(x.selectiveLogic);
  const probability = num(x.probability);
  const delayRec = x.delay_until_recursion;
  return {
    logic: logic === 1 || logic === 2 || logic === 3 ? logic : 0,
    chance: x.useProbability === false || probability === undefined ? 100 : Math.max(0, Math.min(100, probability)),
    groups: typeof x.group === 'string' ? x.group.split(',').map((g) => g.trim()).filter(Boolean) : [],
    groupOverride: x.group_override === true,
    groupWeight: Math.max(0, num(x.group_weight) ?? 100),
    groupScoring: x.use_group_scoring === true,
    excludeRecursion: x.exclude_recursion === true,
    preventRecursion: x.prevent_recursion === true,
    delayUntilRecursion: delayRec === true ? 1 : Math.max(0, num(delayRec) ?? 0),
    scanDepth: num(x.scan_depth),
    wholeWords: bool(x.match_whole_words),
    caseSensitive: bool(x.case_sensitive) ?? e.case_sensitive,
    sticky: Math.max(0, num(x.sticky) ?? 0),
    cooldown: Math.max(0, num(x.cooldown) ?? 0),
    delay: Math.max(0, num(x.delay) ?? 0),
    ignoreBudget: x.ignore_budget === true,
  };
}

/** Rough token count (≈4 characters each), for the budget. */
export const roughTokens = (text: string) => Math.ceil(text.length / 4);

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A `/pattern/flags` key as a RegExp, or null if it isn't one. */
function asRegex(key: string): RegExp | null {
  const m = key.match(/^\/([\s\S]+)\/([gimsuy]*)$/);
  if (!m) return null;
  try {
    return new RegExp(m[1], m[2]);
  } catch {
    return null;
  }
}

type MatchEntry = Pick<LorebookEntry, 'case_sensitive' | 'use_regex'> & Partial<Pick<LorebookEntry, 'extensions'>>;

/** The keys that match `text`. */
export function matchingKeys(keys: string[] | undefined, text: string, entry: MatchEntry): string[] {
  const rules = entry.extensions ? entryRules(entry as LorebookEntry) : undefined;
  const caseSensitive = rules?.caseSensitive ?? entry.case_sensitive;
  const regexKeys = !!entry.use_regex;
  const out: string[] = [];
  for (const raw of keys ?? []) {
    const key = raw.trim();
    if (!key) continue;
    const regex = regexKeys || key.startsWith('/') ? asRegex(key) : null;
    if (regex) {
      if (regex.test(text)) out.push(key);
      continue;
    }
    if (regexKeys) {
      try {
        if (new RegExp(key, caseSensitive ? '' : 'i').test(text)) out.push(key);
      } catch {
        /* a bad pattern never matches */
      }
      continue;
    }
    // Plain keys match as whole words where they start and end with a word
    // character, so "cat" doesn't fire on "concatenate", unless the entry
    // turns whole words off.
    const whole = rules?.wholeWords !== false;
    const edgeL = whole && /^\w/.test(key) ? '(?<![\\w])' : '';
    const edgeR = whole && /\w$/.test(key) ? '(?![\\w])' : '';
    const re = new RegExp(`${edgeL}${escapeRegex(key)}${edgeR}`, caseSensitive ? '' : 'i');
    if (re.test(text)) out.push(key);
  }
  return out;
}

/** The key that matches `text`, if any. */
export function matchingKey(keys: string[] | undefined, text: string, entry: MatchEntry): string | null {
  return matchingKeys(keys, text, entry)[0] ?? null;
}

/** Why an entry's keys fire on `text` and how strongly (for group
 *  scoring), or null if they don't. */
function keyMatch(entry: LorebookEntry, rules: EntryRules, text: string): { reason: string; score: number } | null {
  const primary = matchingKeys(entry.keys, text, entry);
  if (!primary.length) return null;
  const secondaryKeys = (entry.secondary_keys ?? []).filter((k) => k.trim());
  if (!entry.selective || !secondaryKeys.length) return { reason: primary[0], score: primary.length };
  const second = matchingKeys(secondaryKeys, text, entry);
  switch (rules.logic) {
    case SELECTIVE_LOGIC.andAll:
      return second.length === secondaryKeys.length ? { reason: `${primary[0]} + all of ${second.join(', ')}`, score: primary.length + second.length } : null;
    case SELECTIVE_LOGIC.notAny:
      return second.length === 0 ? { reason: `${primary[0]}, none of ${secondaryKeys.join(', ')}`, score: primary.length } : null;
    case SELECTIVE_LOGIC.notAll:
      return second.length < secondaryKeys.length ? { reason: `${primary[0]}, not all of ${secondaryKeys.join(', ')}`, score: primary.length + second.length } : null;
    default:
      return second.length ? { reason: `${primary[0]} + ${second[0]}`, score: primary.length + second.length } : null;
  }
}

/** Timed effects running, by entry index: the chat lengths they started
 *  and end at (in messages, the greeting counted, as SillyTavern counts). */
export interface LoreTimers {
  sticky: Map<number, { start: number; end: number }>;
  cooldown: Map<number, { start: number; end: number }>;
}

const newTimers = (): LoreTimers => ({ sticky: new Map(), cooldown: new Map() });

export interface ScanOptions {
  scanDepth?: number;
  tokenBudget?: number;
  count?: (text: string) => number;
  defaults?: LoreDefaults;
  /** For trigger % and groups' weighted picks (Math.random by default). */
  random?: () => number;
  /**
   * Where earlier replies were written: indexes into the history, each the
   * point a prompt was built (the history before it). With these, entries
   * with sticky or cooldown are replayed through the chat so far to know
   * which are still in or cooling down. Earlier rolls are replayed with a
   * fixed seed per reply, so the replay is the same every time.
   */
  generatedAt?: number[];
}

/** A small seeded random (mulberry32), for replaying earlier turns. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scanLorebook(
  book: Lorebook | undefined,
  /** Chat messages, oldest first (the greeting included). */
  history: string[],
  opts: ScanOptions = {},
): ScanResult {
  if (!book || book.entries.length === 0) return { active: [], dropped: [], skipped: [] };
  const timers = newTimers();
  const timed = book.entries.some((e) => {
    const r = entryRules(e);
    return r.sticky > 0 || r.cooldown > 0;
  });
  if (timed && opts.generatedAt?.length) {
    const points = [...new Set(opts.generatedAt)].filter((p) => p > 0 && p < history.length).sort((a, b) => a - b);
    for (const p of points) scanOnce(book, history.slice(0, p), { ...opts, random: seeded(p * 7919 + 17) }, timers);
  }
  return scanOnce(book, history, opts, timers);
}

function scanOnce(book: Lorebook, history: string[], opts: ScanOptions, timers: LoreTimers): ScanResult {
  const d = opts.defaults ?? {};
  const depth = opts.scanDepth ?? book.scan_depth ?? d.scanDepth ?? DEFAULT_SCAN_DEPTH;
  const count = opts.count ?? roughTokens;
  const random = opts.random ?? Math.random;
  const chatLength = history.length;
  const windows = new Map<number, string>();
  const chatText = (n: number) => {
    const k = Math.max(1, n);
    if (!windows.has(k)) windows.set(k, history.slice(-k).join('\n'));
    return windows.get(k)!;
  };
  const rules = book.entries.map(entryRules);

  // Timed effects that have run out end here; a sticky entry's cooldown
  // starts when it leaves.
  for (const [i, t] of [...timers.sticky]) {
    if (chatLength < t.start || chatLength >= t.end) {
      timers.sticky.delete(i);
      if (chatLength >= t.end && rules[i]?.cooldown > 0) timers.cooldown.set(i, { start: t.end, end: t.end + rules[i].cooldown });
    }
  }
  for (const [i, t] of [...timers.cooldown]) if (chatLength < t.start || chatLength >= t.end) timers.cooldown.delete(i);

  const fired = new Map<number, ActivatedEntry>();
  const skipped = new Map<number, SkippedEntry>();
  const usable = (entry: LorebookEntry) => entry.enabled !== false && !!entry.content.trim();

  // Sticky entries stay in, keys or not.
  timers.sticky.forEach((_, i) => {
    const entry = book.entries[i];
    if (entry && usable(entry)) fired.set(i, { entry, index: i, reason: 'sticky' });
  });

  const passes = book.recursive_scanning ? Math.max(1, d.maxRecursion ?? DEFAULT_MAX_RECURSION) : 1;
  let recursed = [...fired.values()].filter((a) => !rules[a.index].preventRecursion).map((a) => a.entry.content).join('\n');
  for (let pass = 0; pass < passes; pass++) {
    const found: { index: number; reason: string; score: number }[] = [];
    book.entries.forEach((entry, index) => {
      if (fired.has(index) || skipped.has(index) || !usable(entry)) return;
      const r = rules[index];
      if (timers.cooldown.has(index)) return;
      if (r.delay > 0 && chatLength < r.delay) return;
      if (r.delayUntilRecursion > 0 && pass < r.delayUntilRecursion) return;
      if (entry.constant) {
        if (pass === 0) found.push({ index, reason: 'constant', score: 0 });
        return;
      }
      const text = pass > 0 && !r.excludeRecursion ? `${chatText(r.scanDepth ?? depth)}\n${recursed}` : chatText(r.scanDepth ?? depth);
      const m = keyMatch(entry, r, text);
      if (m) found.push({ index, ...m });
    });

    // Inclusion groups: one entry per group, as SillyTavern picks it.
    const out = new Set<number>();
    const groups = new Map<string, typeof found>();
    for (const f of found) for (const g of rules[f.index].groups) groups.set(g, [...(groups.get(g) ?? []), f]);
    for (const [group, members] of groups) {
      const live = members.filter((m) => !out.has(m.index));
      if (!live.length) continue;
      const taken = [...fired.values()].some((a) => rules[a.index].groups.includes(group));
      let winner: (typeof found)[number] | undefined;
      if (!taken) {
        const overrides = live.filter((m) => rules[m.index].groupOverride);
        if (overrides.length) {
          winner = overrides.reduce((a, b) => ((book.entries[b.index].insertion_order ?? 0) > (book.entries[a.index].insertion_order ?? 0) ? b : a));
        } else {
          let pool = live;
          if (pool.some((m) => rules[m.index].groupScoring)) {
            const best = Math.max(...pool.map((m) => m.score));
            pool = pool.filter((m) => m.score === best);
          }
          const total = pool.reduce((n, m) => n + rules[m.index].groupWeight, 0);
          let roll = random() * total;
          winner = pool[pool.length - 1];
          for (const m of pool) {
            roll -= rules[m.index].groupWeight;
            if (roll < 0) {
              winner = m;
              break;
            }
          }
        }
      }
      for (const m of live) {
        if (m === winner) continue;
        out.add(m.index);
        skipped.set(m.index, { entry: book.entries[m.index], index: m.index, reason: taken ? `group "${group}" already has an entry` : `lost group "${group}"` });
      }
    }

    const newContent: string[] = [];
    for (const f of found) {
      if (out.has(f.index)) continue;
      const r = rules[f.index];
      const entry = book.entries[f.index];
      if (r.chance < 100 && random() * 100 >= r.chance) {
        skipped.set(f.index, { entry, index: f.index, reason: `${r.chance}% roll failed` });
        continue;
      }
      fired.set(f.index, { entry, index: f.index, reason: r.chance < 100 ? `${f.reason} (${r.chance}%)` : f.reason });
      if (!r.preventRecursion) newContent.push(entry.content);
    }
    if (!newContent.length) break;
    recursed += (recursed ? '\n' : '') + newContent.join('\n');
  }

  const all = [...fired.values()];
  const budget = opts.tokenBudget ?? book.token_budget ?? d.tokenBudget;
  const dropped: ActivatedEntry[] = [];
  let kept = all;
  if (budget && budget > 0) {
    // Entries that ignore the budget go in first; then the highest priority
    // keeps its place, ties going to the earlier entry.
    const byPriority = [...all].sort(
      (a, b) => Number(rules[b.index].ignoreBudget) - Number(rules[a.index].ignoreBudget) || (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || a.index - b.index,
    );
    let used = 0;
    kept = [];
    for (const a of byPriority) {
      const cost = count(a.entry.content);
      if (rules[a.index].ignoreBudget || used + cost <= budget) {
        kept.push(a);
        used += cost;
      } else dropped.push(a);
    }
  }
  kept.sort((a, b) => (a.entry.insertion_order ?? 0) - (b.entry.insertion_order ?? 0) || a.index - b.index);

  // What went in starts its timers: sticky first, else its cooldown.
  for (const a of kept) {
    if (a.reason === 'sticky') continue;
    const r = rules[a.index];
    if (r.sticky > 0) timers.sticky.set(a.index, { start: chatLength, end: chatLength + r.sticky });
    else if (r.cooldown > 0) timers.cooldown.set(a.index, { start: chatLength, end: chatLength + r.cooldown });
  }
  timers.cooldown.forEach((t, i) => {
    const entry = book.entries[i];
    if (entry && !fired.has(i) && t.start < chatLength && !skipped.has(i)) skipped.set(i, { entry, index: i, reason: `cooling down for ${t.end - chatLength} more` });
  });
  return { active: kept, dropped, skipped: [...skipped.values()] };
}

/** An entry's name for the inspector, with the lorebook it came from when
 *  that isn't the card's own (lib/lorebookBank.ts). */
export const describeEntry = (a: Pick<ActivatedEntry, 'entry' | 'index'>) => {
  const name = entryName(a.entry) || `Entry ${a.index + 1}`;
  const book = entryBook(a.entry);
  return book ? `${name} [${book}]` : name;
};
