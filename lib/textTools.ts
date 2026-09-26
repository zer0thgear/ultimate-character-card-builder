import type { CardData } from '@/types/card';
import { listTextFields, setPath, type FieldGroup } from '@/lib/cardPath';

// Whole-card text macros for the Tools tab. Each returns the new card and
// how many changes it made per field, so the UI can preview before
// applying (and undo covers it after).

export interface ToolResult {
  data: CardData;
  /** Changes per field path; fields with none are left out. */
  changes: Record<string, number>;
  total: number;
}

function applyToFields(data: CardData, groups: FieldGroup[], transform: (text: string) => [string, number]): ToolResult {
  let out = data;
  const changes: Record<string, number> = {};
  let total = 0;
  for (const field of listTextFields(data)) {
    if (!groups.includes(field.group)) continue;
    const [next, n] = transform(field.text);
    if (n > 0 && next !== field.text) {
      out = setPath(out, field.path, next);
      changes[field.path] = n;
      total += n;
    }
  }
  return { data: out, changes, total };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface FindOptions {
  find: string;
  replace: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  groups: FieldGroup[];
}

/** The pattern a find would use, or an error message if it's invalid. */
export function findPattern(opts: Pick<FindOptions, 'find' | 'regex' | 'caseSensitive' | 'wholeWord'>): RegExp | string {
  if (!opts.find) return 'Nothing to find.';
  let source = opts.regex ? opts.find : escapeRegex(opts.find);
  if (opts.wholeWord) source = `(?<![\\w])(?:${source})(?![\\w])`;
  try {
    return new RegExp(source, opts.caseSensitive ? 'g' : 'gi');
  } catch (err) {
    return (err as Error).message;
  }
}

export function findReplace(data: CardData, opts: FindOptions): ToolResult | string {
  const pattern = findPattern(opts);
  if (typeof pattern === 'string') return pattern;
  return applyToFields(data, opts.groups, (text) => {
    let n = 0;
    const next = text.replace(pattern, (...args) => {
      n++;
      if (!opts.regex) return opts.replace;
      // $1, $<name> and $& in a regex replacement, as String.replace does.
      const match = args[0] as string;
      const groups = args.slice(1, -2) as string[];
      return opts.replace.replace(/\$(\d+|&)/g, (_, g: string) => (g === '&' ? match : groups[Number(g) - 1] ?? ''));
    });
    return [next, n];
  });
}

/** *action* → action. Only paired asterisks, one line at a time, so a
 *  lone "*" or a bulleted list survives. */
export function purgeAsterisks(data: CardData, groups: FieldGroup[]): ToolResult {
  return applyToFields(data, groups, (text) => {
    let n = 0;
    const next = text.replace(/\*([^*\n]+?)\*/g, (_, inner: string) => {
      n++;
      return inner;
    });
    return [next, n];
  });
}

/** The character's literal name → {{char}}, so the card survives a rename
 *  and reads right under a nickname. */
export function nameToMacro(data: CardData, groups: FieldGroup[]): ToolResult {
  const name = data.name.trim();
  if (!name) return { data, changes: {}, total: 0 };
  const re = new RegExp(`(?<![\\w{])${escapeRegex(name)}(?![\\w}])`, 'g');
  return applyToFields(data, groups, (text) => {
    let n = 0;
    const next = text.replace(re, () => {
      n++;
      return '{{char}}';
    });
    return [next, n];
  });
}

/** Curly quotes and apostrophes → straight ones. */
export function straightenQuotes(data: CardData, groups: FieldGroup[]): ToolResult {
  const map: Record<string, string> = { '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'" };
  return applyToFields(data, groups, (text) => {
    let n = 0;
    const next = text.replace(/[“”„‘’]/g, (c) => {
      n++;
      return map[c];
    });
    return [next, n];
  });
}

/** Trailing spaces, runs of 3+ blank lines, and leading/trailing blank
 *  lines tidied. */
export function tidyWhitespace(data: CardData, groups: FieldGroup[]): ToolResult {
  return applyToFields(data, groups, (text) => {
    const next = text
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s*\n/, '')
      .replace(/\n\s*$/, '');
    return [next, next === text ? 0 : 1];
  });
}
