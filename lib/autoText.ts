import { CharacterPrompt, NovelAIModel } from '@/types/novelai';
import { TEXT_SECTION } from '@/lib/naiPresets';

// V5's automatic text section, ported from novelai.net's client (2026-09-19).
// Before sending a V5 request, its client gathers the quoted text in the
// prompt and the character prompts and appends it as ", teXt: <strings>" to
// the prompt's first mix part. The odd capital X marks the addition as its
// own, so importing an image can take it back out (stripAutoText). Nothing is
// added when the user already wrote a text: section, or quoted nothing.
// Other models are left alone. Checked against NovelAI's own functions.

type Character = Pick<CharacterPrompt, 'prompt' | 'center'> & { enabled?: boolean };

const AUTO_TEXT = 'teXt:';
// The same boundary rule as a typed text: section, but only this spelling.
const AUTO_SECTION = /(?:^|\s|[,.:[\]{}、。])teXt:(?!:)/;
// Opening quote → its closing quote.
const QUOTES: Record<string, string> = { '"': '"', '“': '”', '「': '」', "'": "'", '‘': '’' };
// Text that's mostly CJK reads its strings in reverse order.
const CJK = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/gu;
// Characters in reading order: rows split where y jumps (see readingOrder).
const ROW_GAP = 0.1;
const ROW_SPAN = 0.15;

// NovelAI's prompt-mix split: `|` separates parts (at most six; the rest stay
// in the last one), but not inside a `||a|b||` random group.
const MIX_LIMIT = 6;
const GROUP = '||';
const INNER_BAR = '\u{103B9}';
const GROUP_MARK = '\u{12137}';

function splitMixParts(text: string): string[] {
  const protectedText = text
    .split(GROUP)
    .map((part, i) => (i % 2 === 1 ? part.split('|').join(INNER_BAR) : part))
    .join(GROUP_MARK);
  const parts = protectedText.split('|');
  const out = parts.slice(0, MIX_LIMIT - 1);
  if (parts.length > MIX_LIMIT - 1) out.push(parts.slice(MIX_LIMIT - 1).join('|'));
  return out.map((p) => p.replaceAll(INNER_BAR, '|').replaceAll(GROUP_MARK, GROUP));
}

const isLetterOrDigit = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isBoundary = (c: string | undefined) => c === undefined || /[\s,.]/.test(c);

/** The quoted strings in some text. A single quote only opens after a space,
 *  comma, full stop or the start, and a closing single quote followed by a
 *  letter or digit is an apostrophe ("don't"), not the end. */
function quotedStrings(text: string): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < text.length) {
    const close = QUOTES[text[i]];
    if (close === undefined || (text[i] === "'" && !isBoundary(text[i - 1]))) {
      i++;
      continue;
    }
    const apostropheLike = close === "'" || close === '’';
    let end = i + 1;
    while (end < text.length && (text[end] !== close || (apostropheLike && isLetterOrDigit(text[end + 1])))) end++;
    if (end >= text.length) {
      i++;
      continue;
    }
    const inner = text.slice(i + 1, end).trim();
    if (inner.length > 0) found.push(inner);
    i = end + 1;
  }
  return found;
}

/** Splits characters (sorted top to bottom) into rows wherever the biggest
 *  vertical gap is large, recursively. */
function rows(chars: Character[]): Character[][] {
  if (chars.length <= 1) return [chars];
  const span = chars[chars.length - 1].center.y - chars[0].center.y;
  let splitAt = 1;
  let biggestGap = -1;
  for (let i = 1; i < chars.length; i++) {
    const gap = chars[i].center.y - chars[i - 1].center.y;
    if (gap > biggestGap) {
      biggestGap = gap;
      splitAt = i;
    }
  }
  return span <= ROW_SPAN && biggestGap <= ROW_GAP
    ? [chars]
    : [...rows(chars.slice(0, splitAt)), ...rows(chars.slice(splitAt))];
}

/** Top-to-bottom rows, each left to right. */
function readingOrder(chars: Character[]): Character[] {
  return rows([...chars].sort((a, b) => a.center.y - b.center.y)).flatMap((row) =>
    row.sort((a, b) => a.center.x - b.center.x),
  );
}

function isMostlyCjk(text: string): boolean {
  const count = text.match(CJK)?.length;
  return !!count && count / text.length > 0.3;
}

const activeCharacters = (characters: Character[]) =>
  characters.filter((c) => (c.enabled ?? true) && c.prompt.length > 0);

/** The strings to add: the base prompt's, then each character's (in reading
 *  order when positions are used), each group reversed for CJK text. */
function textStrings(base: string, characters: Character[], useCoords: boolean): string[] {
  const active = activeCharacters(characters);
  const ordered = useCoords ? readingOrder(active) : active;
  const groups = [quotedStrings(base), ...ordered.map((c) => quotedStrings(c.prompt))];
  if (isMostlyCjk(groups.flat().join(''))) for (const g of groups) g.reverse();
  return groups.flat();
}

/** NovelAI's V5 text step: appends ", teXt: …" built from the quoted text. */
export function addAutoText(prompt: string, characters: Character[], useCoords: boolean): string {
  const active = activeCharacters(characters);
  if (TEXT_SECTION.test(prompt) || active.some((c) => TEXT_SECTION.test(c.prompt))) return prompt;
  const parts = splitMixParts(prompt);
  const strings = textStrings(parts[0] ?? '', active, useCoords);
  if (strings.length === 0) return prompt;
  const section = `${AUTO_TEXT} ${strings.join('\n\n')}`;
  const head = (parts[0] ?? '').replace(/[\s,]+$/, '');
  parts[0] = head.length > 0 ? `${head}, ${section}` : section;
  return parts.join('|');
}

/** Only V5 does this (its models' `autoText` setting). */
export const hasAutoText = (model: NovelAIModel) => model.startsWith('nai-diffusion-5');

/** The reverse, as NovelAI's import does it: removes a teXt: section that's
 *  exactly what addAutoText would have added, leaving anything else. */
export function stripAutoText(prompt: string, characters: Character[] = [], useCoords = false): string {
  return splitMixParts(prompt)
    .map((part) => {
      const match = part.match(AUTO_SECTION);
      if (match?.index === undefined) return part;
      const before = part.slice(0, match.index);
      const expected = textStrings(before, characters, useCoords).join('\n\n');
      return part.slice(match.index + match[0].length).trim() !== expected ? part : before.replace(/[\s,]+$/, '');
    })
    .join('|');
}
