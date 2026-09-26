import type { Lorebook, LorebookEntry } from '@/types/card';
import { entryName } from '@/lib/cardSpec';

// Which lorebook entries a chat turn activates, as the card spec and
// SillyTavern read them: an entry fires when one of its keys appears in the
// last `scan_depth` messages (or always, if constant); a selective entry
// also needs one of its secondary keys. With recursive scanning, fired
// entries' content is scanned too. Entries go in by insertion_order, and
// past the token budget the lowest-priority ones are dropped first.

export const DEFAULT_SCAN_DEPTH = 2;

export interface ActivatedEntry {
  entry: LorebookEntry;
  index: number;
  /** Why it fired: 'constant', or the key that matched. */
  reason: string;
}

export interface ScanResult {
  active: ActivatedEntry[];
  /** Entries that fired but didn't fit the token budget. */
  dropped: ActivatedEntry[];
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

/** The key that matches `text`, if any. */
export function matchingKey(keys: string[] | undefined, text: string, entry: Pick<LorebookEntry, 'case_sensitive' | 'use_regex'>): string | null {
  for (const raw of keys ?? []) {
    const key = raw.trim();
    if (!key) continue;
    const regex = entry.use_regex || key.startsWith('/') ? asRegex(key) : null;
    if (regex) {
      if (regex.test(text)) return key;
      continue;
    }
    if (entry.use_regex) {
      try {
        if (new RegExp(key, entry.case_sensitive ? '' : 'i').test(text)) return key;
      } catch {
        /* a bad pattern never matches */
      }
      continue;
    }
    // Plain keys match as whole words where they start and end with a word
    // character, so "cat" doesn't fire on "concatenate".
    const edgeL = /^\w/.test(key) ? '(?<![\\w])' : '';
    const edgeR = /\w$/.test(key) ? '(?![\\w])' : '';
    const re = new RegExp(`${edgeL}${escapeRegex(key)}${edgeR}`, entry.case_sensitive ? '' : 'i');
    if (re.test(text)) return key;
  }
  return null;
}

export function scanLorebook(
  book: Lorebook | undefined,
  /** Chat messages, oldest first (the greeting included). */
  history: string[],
  opts: { scanDepth?: number; tokenBudget?: number; count?: (text: string) => number } = {},
): ScanResult {
  if (!book || book.entries.length === 0) return { active: [], dropped: [] };
  const depth = opts.scanDepth ?? book.scan_depth ?? DEFAULT_SCAN_DEPTH;
  const count = opts.count ?? roughTokens;
  let scanText = history.slice(-Math.max(1, depth)).join('\n');

  const fired = new Map<number, ActivatedEntry>();
  const passes = book.recursive_scanning ? 5 : 1;
  for (let pass = 0; pass < passes; pass++) {
    const before = fired.size;
    const newContent: string[] = [];
    book.entries.forEach((entry, index) => {
      if (fired.has(index) || entry.enabled === false || !entry.content.trim()) return;
      if (entry.constant) {
        if (pass === 0) {
          fired.set(index, { entry, index, reason: 'constant' });
          newContent.push(entry.content);
        }
        return;
      }
      const key = matchingKey(entry.keys, scanText, entry);
      if (!key) return;
      if (entry.selective && entry.secondary_keys?.some((k) => k.trim())) {
        const second = matchingKey(entry.secondary_keys, scanText, entry);
        if (!second) return;
        fired.set(index, { entry, index, reason: `${key} + ${second}` });
      } else {
        fired.set(index, { entry, index, reason: key });
      }
      newContent.push(entry.content);
    });
    if (fired.size === before) break;
    scanText += '\n' + newContent.join('\n');
  }

  const all = [...fired.values()];
  const budget = opts.tokenBudget ?? book.token_budget;
  const dropped: ActivatedEntry[] = [];
  let kept = all;
  if (budget && budget > 0) {
    // Highest priority keeps its place; ties go to the earlier entry.
    const byPriority = [...all].sort((a, b) => (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || a.index - b.index);
    let used = 0;
    kept = [];
    for (const a of byPriority) {
      const cost = count(a.entry.content);
      if (used + cost <= budget) {
        kept.push(a);
        used += cost;
      } else dropped.push(a);
    }
  }
  kept.sort((a, b) => (a.entry.insertion_order ?? 0) - (b.entry.insertion_order ?? 0) || a.index - b.index);
  return { active: kept, dropped };
}

export const describeEntry = (a: ActivatedEntry) => entryName(a.entry) || `Entry ${a.index + 1}`;
