// Pure helpers for comma-segment tag autocomplete, shared by every prompt
// field (components/TagAutocompleteField.tsx).

/** Segments break on commas and line breaks — the latter matter for random
 *  wildcard entries (one option per line) and Shift+Enter in prompt boxes. */
function segmentBounds(text: string, cursor: number): { start: number; end: number } {
  const before = text.slice(0, cursor);
  const start = Math.max(before.lastIndexOf(','), before.lastIndexOf('\n')) + 1;
  const comma = text.indexOf(',', cursor);
  const line = text.indexOf('\n', cursor);
  const end = Math.min(comma === -1 ? text.length : comma, line === -1 ? text.length : line);
  return { start, end };
}

// Emphasis a tag can open with: {…}, […] or an explicit weight (1.2::…::).
// A plain tag starting with a digit ("1girl") isn't one; the weight form
// needs its "::".
const OPENERS = /^(?:\{+|\[+|-?\d*\.?\d+::)*/;
const CLOSERS = /(?:\}|\]|::)+$/;

/** The closers that balance a run of openers, innermost first. */
function closersFor(openers: string): string {
  const tokens = openers.match(/\{|\[|-?\d*\.?\d+::/g) ?? [];
  return tokens
    .reverse()
    .map((t) => (t === '{' ? '}' : t === '[' ? ']' : '::'))
    .join('');
}

/** The tag being typed at the cursor, without leading whitespace or emphasis
 *  syntax — this is what gets sent to the suggest-tags API as `prompt`. */
export function currentSegment(text: string, cursor: number): string {
  const { start } = segmentBounds(text, cursor);
  return text.slice(start, cursor).trimStart().replace(OPENERS, '').trimStart();
}

/** Replaces the whole tag the cursor is in with `tag`, keeping the tag's own
 *  emphasis (and closing it if it's still being typed, so `{{blu` becomes
 *  `{{blue hair}}`), plus any closers that belong to an enclosing group.
 *  Returns the new text and where the cursor lands: after ", " at the end of
 *  a line ready for the next tag, or right after the tag mid-prompt. */
export function applySegment(text: string, cursor: number, tag: string): { text: string; cursor: number } {
  const { start, end } = segmentBounds(text, cursor);
  const segment = text.slice(start, end).trim();
  const openers = OPENERS.exec(segment)?.[0] ?? '';
  const closers = closersFor(openers);
  const trailing = CLOSERS.exec(segment.slice(openers.length))?.[0] ?? '';
  // Closers beyond this tag's own belong to a group opened in an earlier
  // segment (`{a, b}`), so they're kept. A partial set of this tag's own
  // (`{{blu}`) is simply completed.
  const outer = trailing.startsWith(closers) ? trailing.slice(closers.length) : closers.startsWith(trailing) ? '' : trailing;

  const before = text.slice(0, start);
  const lead = start > 0 && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : '';
  const replaced = lead + openers + tag + closers + outer;
  const after = text.slice(end);

  if (after.startsWith(',')) {
    return { text: before + replaced + after, cursor: before.length + replaced.length };
  }
  const withComma = replaced + ', ';
  return { text: before + withComma + after, cursor: before.length + withComma.length };
}

// Relevance-dot brightness (0-1) for a suggestion, matching NovelAI's own
// "Did you mean?" chips. Confirmed live 2026-09-17 by reading the computed
// background-color of the actual dot element next to each chip and
// correlating it against the raw API response for the same query — the
// dot brightness tracks `count`, NOT the `confidence` field (two tags with
// the same confidence but very different counts had very different dot
// brightness). Exact prefix matches are always capped at count:10000 and
// always render fully bright.
//
// This isn't a formula NovelAI publishes — it's a curve fit through the
// real (count, brightness) pairs read off the live page for one query
// ("blue ha" against nai-diffusion-5-curated):
//   count=40 -> 0.025, count=104 -> 0.034, count=404 -> 0.063,
//   count=1844 -> 0.202, count=5144 -> 0.524, count>=10000 -> 1.0
// Interpolated linearly in log10(count) space between those anchors, same
// empirical-fit approach used for the Anlas cost formula — treat it as a
// close visual approximation, not a byte-exact port.
const RELEVANCE_CURVE: [log10Count: number, brightness: number][] = [
  [0, 0.02],
  [1.602, 0.025],
  [2.017, 0.034],
  [2.606, 0.063],
  [3.266, 0.202],
  [3.711, 0.524],
  [4, 1],
];

export function relevanceBrightness(count: number): number {
  if (count >= 10000) return 1;
  if (count <= 1) return RELEVANCE_CURVE[0][1];
  const x = Math.log10(count);
  for (let i = 1; i < RELEVANCE_CURVE.length; i++) {
    const [x1, y1] = RELEVANCE_CURVE[i - 1];
    const [x2, y2] = RELEVANCE_CURVE[i];
    if (x <= x2) {
      const t = (x - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return 1;
}
