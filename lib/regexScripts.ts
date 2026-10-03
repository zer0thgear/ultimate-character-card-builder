import type { CardData } from '@/types/card';

// A card's regex scripts, as SillyTavern's Regex extension runs them. Cards
// carry them in extensions.regex_scripts (scoped scripts, in SillyTavern's
// words), to hide a stat block, restyle a reply or tidy what the model
// sees. Each finds a pattern in some kinds of text (your messages, the
// character's, lorebook entries) and replaces it, for display, for the
// prompt, or both.
//
// SillyTavern writes a script with neither "only" switch into the message
// itself as it arrives; UCCB leaves the message as it was written and runs
// the script wherever the message is shown or sent, which reads the same
// and keeps the original a ✎ away.

/** Where a script runs (SillyTavern's placement numbers). */
export const REGEX_PLACEMENT = { userInput: 1, aiOutput: 2, slashCommand: 3, worldInfo: 5, reasoning: 6 } as const;
export type RegexPlacement = (typeof REGEX_PLACEMENT)[keyof typeof REGEX_PLACEMENT];

export interface RegexScript {
  id?: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: number[];
  disabled: boolean;
  /** Only changes what's shown. */
  markdownOnly: boolean;
  /** Only changes what the model is sent. */
  promptOnly: boolean;
  /** Macros in the pattern: 0 none, 1 as they are, 2 escaped. */
  substituteRegex: number;
  /** Messages from the end (0: the last) it starts and stops at. */
  minDepth?: number | null;
  maxDepth?: number | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The card's scripts, as SillyTavern stores them, with gaps filled. */
export function cardRegexScripts(card: Pick<CardData, 'extensions'>): RegexScript[] {
  const raw = (card.extensions as { regex_scripts?: unknown } | undefined)?.regex_scripts;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).map((s) => ({
    id: typeof s.id === 'string' ? s.id : undefined,
    scriptName: typeof s.scriptName === 'string' ? s.scriptName : '',
    findRegex: typeof s.findRegex === 'string' ? s.findRegex : '',
    replaceString: typeof s.replaceString === 'string' ? s.replaceString : '',
    trimStrings: Array.isArray(s.trimStrings) ? s.trimStrings.filter((t): t is string => typeof t === 'string') : [],
    placement: Array.isArray(s.placement) ? s.placement.filter((p): p is number => typeof p === 'number') : [],
    disabled: s.disabled === true,
    markdownOnly: s.markdownOnly === true,
    promptOnly: s.promptOnly === true,
    substituteRegex: typeof s.substituteRegex === 'number' ? s.substituteRegex : s.substituteRegex === true ? 1 : 0,
    minDepth: typeof s.minDepth === 'number' ? s.minDepth : null,
    maxDepth: typeof s.maxDepth === 'number' ? s.maxDepth : null,
  }));
}

/** A `/pattern/flags` string (or a bare pattern) as a RegExp, or null. */
export function regexFromString(input: string): RegExp | null {
  if (!input) return null;
  const m = input.match(/^\/([\s\S]+)\/([dgimsuvy]*)$/);
  try {
    return m ? new RegExp(m[1], m[2]) : new RegExp(input);
  } catch {
    return null;
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface RegexRun {
  placement: RegexPlacement;
  /** Shown in the chat, or sent to the model. */
  target: 'display' | 'prompt';
  /** Messages from the end (0: the last); depth limits only apply with it. */
  depth?: number;
  /** Fills {{char}}, {{user}} and the other macros. */
  macros: (text: string) => string;
}

function applies(s: RegexScript, run: RegexRun): boolean {
  if (s.disabled || !s.findRegex || !s.placement.includes(run.placement)) return false;
  if (run.target === 'display' ? s.promptOnly : s.markdownOnly) return false;
  if (typeof run.depth === 'number') {
    if (typeof s.minDepth === 'number' && s.minDepth >= -1 && run.depth < s.minDepth) return false;
    if (typeof s.maxDepth === 'number' && s.maxDepth >= 0 && run.depth > s.maxDepth) return false;
  }
  return true;
}

/** One script over `text`, as SillyTavern runs it: {{match}} and $1 / $<name>
 *  in the replacement take the match and its groups (each with the trim
 *  strings taken out), then macros are filled in. */
export function runRegexScript(script: RegexScript, text: string, macros: (t: string) => string): string {
  let pattern = script.findRegex;
  if (script.substituteRegex === 1) pattern = macros(pattern);
  else if (script.substituteRegex === 2) pattern = pattern.replace(/\{\{[^{}]+\}\}/g, (m) => escapeRegex(macros(m)));
  const re = regexFromString(pattern);
  if (!re) return text;
  const trim = (s: string | undefined) => script.trimStrings.reduce((acc, t) => (t ? acc.split(macros(t)).join('') : acc), s ?? '');
  return text.replace(re, (...args: unknown[]) => {
    // replace() passes the match, its groups, the offset, the whole string
    // and, with named groups, an object of them last.
    const named = isObject(args[args.length - 1]) ? (args[args.length - 1] as Record<string, string | undefined>) : undefined;
    const withMatch = script.replaceString.replace(/\{\{match\}\}/gi, '$0');
    const filled = withMatch.replace(/\$(\d+)|\$<([^>]+)>/g, (_, num: string | undefined, name: string | undefined) => {
      const value = num !== undefined ? args[Number(num)] : named?.[name!];
      return trim(typeof value === 'string' ? value : '');
    });
    return macros(filled);
  });
}

/** Every script that applies, in order, over `text`. */
export function runRegexScripts(scripts: RegexScript[], text: string, run: RegexRun): string {
  let out = text;
  for (const s of scripts) if (applies(s, run)) out = runRegexScript(s, out, run.macros);
  return out;
}

/** The placement a chat message's text has. */
export const placementFor = (role: string): RegexPlacement | null => (role === 'user' ? REGEX_PLACEMENT.userInput : role === 'assistant' ? REGEX_PLACEMENT.aiOutput : null);
