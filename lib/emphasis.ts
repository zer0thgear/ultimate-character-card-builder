// NovelAI emphasis syntax, and finding/adjusting the weighted span a caret is in.
//   {text}  ×1.05 per brace      [text]  ÷1.05 per bracket
//   1.5::text::  an explicit weight (V4+), negative values allowed
// Braces are what most prompts use; explicit weights are for values braces
// can't express. Stepping keeps whichever form a span already uses.

export const BRACE_FACTOR = 1.05;
const STEP = 0.05;
const NUMERIC_GROUP = /(-?\d*\.?\d+)::([\s\S]*?)::/g;
const NUMERIC_EXACT = /^(-?\d*\.?\d+)::([\s\S]*)::$/;

export interface Span {
  start: number;
  end: number;
}

export interface ParsedWeight {
  inner: string;
  kind: 'plain' | 'brace' | 'numeric';
  /** Braces (+) or brackets (−) stacked around `inner`. */
  level: number;
  /** The multiplier this span ends up with. */
  weight: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const formatWeight = (w: number) => String(round2(w));

function isBalanced(s: string): boolean {
  let braces = 0;
  let brackets = 0;
  for (const ch of s) {
    if (ch === '{') braces++;
    else if (ch === '}' && --braces < 0) return false;
    else if (ch === '[') brackets++;
    else if (ch === ']' && --brackets < 0) return false;
  }
  return braces === 0 && brackets === 0;
}

export function parseWeighted(text: string): ParsedWeight {
  const numeric = NUMERIC_EXACT.exec(text);
  if (numeric) return { inner: numeric[2], kind: 'numeric', level: 0, weight: parseFloat(numeric[1]) };

  for (const [open, close, sign] of [['{', '}', 1], ['[', ']', -1]] as const) {
    let n = 0;
    while (text[n] === open && text[text.length - 1 - n] === close && n * 2 < text.length) n++;
    // `{a}{b}` starts and ends with braces but isn't one group; only accept
    // a peel that leaves a balanced inside.
    while (n > 0 && !isBalanced(text.slice(n, text.length - n))) n--;
    if (n > 0) {
      return { inner: text.slice(n, text.length - n), kind: 'brace', level: n * sign, weight: BRACE_FACTOR ** (n * sign) };
    }
  }
  return { inner: text, kind: 'plain', level: 0, weight: 1 };
}

function render(inner: string, level: number): string {
  if (level > 0) return '{'.repeat(level) + inner + '}'.repeat(level);
  if (level < 0) return '['.repeat(-level) + inner + ']'.repeat(-level);
  return inner;
}

/** One Ctrl+↑/↓ press: a brace more or less, or ±0.05 on an explicit weight.
 *  Reaching neutral drops the syntax entirely. */
export function stepWeight(text: string, dir: 1 | -1): string {
  const p = parseWeighted(text);
  if (p.kind === 'numeric') return withWeight(p.inner, p.weight + STEP * dir);
  return render(p.inner, p.level + dir);
}

/** An explicit weight, or plain text at 1. */
export function withWeight(inner: string, weight: number): string {
  const w = round2(weight);
  return w === 1 ? inner : `${formatWeight(w)}::${inner}::`;
}

/**
 * The span Ctrl+↑/↓ should act on. A selection wins (widened to swallow any
 * wrappers sitting right around it, so selecting just the words of `{x}`
 * still means that group). Otherwise, the weighted group around the caret
 * (innermost one, with any identical wrappers stacked on it), or failing
 * that, the comma/line-separated tag the caret is in.
 */
export function findWeightTarget(text: string, selStart: number, selEnd: number): Span | null {
  if (selEnd > selStart) {
    let start = selStart;
    let end = selEnd;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start === end) return null;
    for (;;) {
      const before = text[start - 1];
      const after = text[end];
      if ((before === '{' && after === '}') || (before === '[' && after === ']')) {
        start--;
        end++;
        continue;
      }
      const num = /(-?\d*\.?\d+)::$/.exec(text.slice(0, start));
      if (num && text.startsWith('::', end)) {
        start -= num[0].length;
        end += 2;
        continue;
      }
      return { start, end };
    }
  }

  const caret = selStart;
  for (const m of text.matchAll(NUMERIC_GROUP)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (start <= caret && caret <= end) return { start, end };
  }

  // Bracket pairs containing the caret (inclusive of just past the closer,
  // so the caret left behind after a step still targets the same group).
  const pairs: Span[] = [];
  const stack: { ch: string; at: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') stack.push({ ch, at: i });
    else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (open && (open.ch === '{') === (ch === '}')) {
        const span = { start: open.at, end: i + 1 };
        if (span.start <= caret && caret <= span.end) pairs.push(span);
      }
    }
  }
  if (pairs.length) {
    // Innermost first; then absorb identical wrappers directly around it.
    pairs.sort((a, b) => a.end - a.start - (b.end - b.start));
    let target = pairs[0];
    for (const outer of pairs.slice(1)) {
      if (outer.start === target.start - 1 && outer.end === target.end + 1 && text[outer.start] === text[target.start]) {
        target = outer;
      }
    }
    return target;
  }

  const before = text.slice(0, caret);
  let start = Math.max(before.lastIndexOf(','), before.lastIndexOf('\n')) + 1;
  const afterComma = text.indexOf(',', caret);
  const afterLine = text.indexOf('\n', caret);
  let end = Math.min(afterComma === -1 ? text.length : afterComma, afterLine === -1 ? text.length : afterLine);
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return start < end ? { start, end } : null;
}
