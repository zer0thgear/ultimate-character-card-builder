import { CharacterPromptEntry, LibraryTidbit, PromptTidbit, WildcardPicks } from '@/types/novelai';
import { joinPromptParts, normalizePromptPart } from '@/lib/promptText';
import { linkedEntry } from '@/lib/promptTidbits';

// Inline references are `__Label__`, matched to Tidbit Library labels ignoring
// case. Double underscores avoid NovelAI's own `{}` / `[]` / `::` weighting.
const REF_SOURCE = '__([^_\\n]+?)__';
// Entries may reference other entries; this bounds self/mutual references.
const MAX_DEPTH = 5;

export const isRandomEntry = (entry: LibraryTidbit) => entry.kind === 'random';

export function randomOptions(entry: LibraryTidbit): string[] {
  return entry.text.split('\n').map(normalizePromptPart).filter(Boolean);
}

function labelIndex(library: LibraryTidbit[]): Map<string, LibraryTidbit> {
  const index = new Map<string, LibraryTidbit>();
  for (const entry of library) {
    const key = entry.label.trim().toLowerCase();
    if (key && !index.has(key)) index.set(key, entry);
  }
  return index;
}

export interface ResolvedRequestPrompts {
  /** Base prompt with its enabled tidbits, every reference expanded. */
  baseText: string;
  /** Enabled characters only, with tidbits folded into `prompt` and expanded. */
  characters: CharacterPromptEntry[];
  negativePrompt: string;
  picks: WildcardPicks;
}

/**
 * Expands every wildcard and library reference for exactly one request.
 *
 * Resolution has to happen once, up front: request builders compose each
 * character's prompt several times (captions, characterPrompts, UC search
 * text), and rolling inside composition would give one request inconsistent
 * picks. Rolls are keyed per field scope so replaying them onto a request
 * with a different shape (Variations has no base prompt to resolve) still
 * lines each character up with its own picks.
 */
export function resolveRequestPrompts(
  base: { text: string; tidbits?: PromptTidbit[] },
  characters: CharacterPromptEntry[],
  negative: { text: string; tidbits?: PromptTidbit[] },
  library: LibraryTidbit[],
  replay?: WildcardPicks,
  /** Pins random entries (by id) to one option everywhere they occur —
   *  how a sweep steps through a wildcard's options. Overrides `replay`. */
  force?: Record<string, string>,
): ResolvedRequestPrompts {
  const index = labelIndex(library);
  const picks: WildcardPicks = {};
  const counters: Record<string, number> = {};
  let scope = '';

  function entryText(entry: LibraryTidbit, depth: number): string {
    if (!isRandomEntry(entry)) return expand(entry.text, depth + 1);
    const key = `${scope}|${entry.id}`;
    const n = (counters[key] = (counters[key] ?? -1) + 1);
    // A replayed pick is authoritative even if the option has since been
    // edited out of the entry — it's what actually produced the image.
    const recorded = force?.[entry.id] ?? replay?.[key]?.[n];
    const options = randomOptions(entry);
    const choice = recorded ?? (options.length ? options[Math.floor(Math.random() * options.length)] : '');
    (picks[key] ??= [])[n] = choice;
    return expand(choice, depth + 1);
  }

  function expand(text: string, depth = 0): string {
    if (depth > MAX_DEPTH) return text;
    return text.replace(new RegExp(REF_SOURCE, 'g'), (whole, name: string) => {
      const entry = index.get(name.trim().toLowerCase());
      return entry ? entryText(entry, depth) : whole;
    });
  }

  function withTidbits(text: string, tidbits: PromptTidbit[] | undefined): string {
    const parts = (tidbits ?? [])
      .filter((t) => t.enabled)
      .map((t) => {
        const entry = linkedEntry(t, library);
        return entry ? entryText(entry, 0) : expand(t.text);
      });
    return joinPromptParts(expand(text), ...parts);
  }

  function inScope<T>(key: string, fn: () => T): T {
    scope = key;
    return fn();
  }

  const baseText = inScope('base', () => withTidbits(base.text, base.tidbits));
  const resolvedCharacters = characters
    .filter((c) => c.enabled && !c.archived)
    .map((c) => ({
      ...c,
      prompt: inScope(`char:${c.id}`, () => withTidbits(c.prompt, c.tidbits)),
      uc: inScope(`charuc:${c.id}`, () => withTidbits(c.uc, c.ucTidbits)),
      tidbits: [],
      ucTidbits: [],
    }));
  const resolvedNegative = inScope('neg', () => withTidbits(negative.text, negative.tidbits));

  return { baseText, characters: resolvedCharacters, negativePrompt: resolvedNegative, picks };
}

/** Every library entry some text and tidbit links depend on, following
 *  references inside entries, so an export can carry what its prompts need. */
export function referencedEntries(
  texts: string[],
  linkedIds: string[],
  library: LibraryTidbit[],
): LibraryTidbit[] {
  const index = labelIndex(library);
  const found = new Map<string, LibraryTidbit>();
  function visit(entry: LibraryTidbit) {
    if (found.has(entry.id)) return;
    found.set(entry.id, entry);
    scan(entry.text);
  }
  function scan(text: string) {
    for (const match of text.matchAll(new RegExp(REF_SOURCE, 'g'))) {
      const entry = index.get(match[1].trim().toLowerCase());
      if (entry) visit(entry);
    }
  }
  texts.forEach(scan);
  for (const id of linkedIds) {
    const entry = library.find((l) => l.id === id);
    if (entry) visit(entry);
  }
  return [...found.values()];
}

export interface WildcardAnalysis {
  /** References matching no library label, e.g. `__typo__`, as written. */
  unknown: string[];
  /** Whether any random entry is reachable, i.e. repeat requests can differ. */
  usesRandom: boolean;
  /** The random entries reachable from these prompts, in first-seen order. */
  randomEntries: LibraryTidbit[];
}

/** Static scan of what a request would draw on, following references into
 *  every option of each entry (not just one roll), so it's complete. */
export function analyzeWildcards(
  bases: { text: string; tidbits?: PromptTidbit[] }[],
  characters: CharacterPromptEntry[],
  negative: { text: string; tidbits?: PromptTidbit[] },
  library: LibraryTidbit[],
): WildcardAnalysis {
  const index = labelIndex(library);
  const unknown = new Set<string>();
  const visited = new Set<string>();
  const randomEntries: LibraryTidbit[] = [];

  function visit(entry: LibraryTidbit) {
    if (visited.has(entry.id)) return;
    visited.add(entry.id);
    if (isRandomEntry(entry)) randomEntries.push(entry);
    scan(entry.text);
  }
  function scan(text: string) {
    for (const match of text.matchAll(new RegExp(REF_SOURCE, 'g'))) {
      const entry = index.get(match[1].trim().toLowerCase());
      if (entry) visit(entry);
      else unknown.add(match[0]);
    }
  }
  function scanTidbits(tidbits: PromptTidbit[] | undefined) {
    for (const t of (tidbits ?? []).filter((t) => t.enabled)) {
      const entry = linkedEntry(t, library);
      if (entry) visit(entry);
      else scan(t.text);
    }
  }

  for (const b of bases) {
    scan(b.text);
    scanTidbits(b.tidbits);
  }
  for (const c of characters.filter((c) => c.enabled && !c.archived)) {
    scan(c.prompt);
    scan(c.uc);
    scanTidbits(c.tidbits);
    scanTidbits(c.ucTidbits);
  }
  scan(negative.text);
  scanTidbits(negative.tidbits);

  return { unknown: [...unknown], usesRandom: randomEntries.length > 0, randomEntries };
}
