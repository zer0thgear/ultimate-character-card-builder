import type { CardData } from '@/types/card';
import { listTextFields } from '@/lib/cardPath';

// What changed between two versions of a card: the fields that differ, and
// within each, the words added and taken out.

export interface DiffPart {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** The longest-common-subsequence diff of two token lists. Past `limit`
 *  cells it gives up and calls it all replaced. */
function diffTokens(a: string[], b: string[], limit = 4_000_000): DiffPart[] {
  // Common ends first: most edits touch a small middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).join('');
  const tail = a.slice(endA).join('');
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const middle: DiffPart[] = [];
  if (x.length * y.length > limit) {
    if (x.length) middle.push({ kind: 'removed', text: x.join('') });
    if (y.length) middle.push({ kind: 'added', text: y.join('') });
  } else {
    // lcs[i][j]: the common length of x[i..] and y[j..].
    const n = x.length;
    const m = y.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) {
        middle.push({ kind: 'same', text: x[i++] });
        j++;
      }
      // On a tie, what went comes before what came.
      else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) middle.push({ kind: 'removed', text: x[i++] });
      else middle.push({ kind: 'added', text: y[j++] });
    }
  }
  const parts = [...(head ? [{ kind: 'same' as const, text: head }] : []), ...middle, ...(tail ? [{ kind: 'same' as const, text: tail }] : [])];
  // Runs of one kind as one part.
  const out: DiffPart[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last?.kind === p.kind) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

/** Words and the spaces between them, each a token. */
const words = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** A word-level diff of two texts. */
export const diffText = (before: string, after: string): DiffPart[] => diffTokens(words(before), words(after));

export interface FieldChange {
  label: string;
  before: string;
  after: string;
}

/** The card's fields that differ between `before` and `after`, in editor order. */
export function cardChanges(before: CardData, after: CardData): FieldChange[] {
  const out: FieldChange[] = [];
  if (before.name !== after.name) out.push({ label: 'Name', before: before.name, after: after.name });
  if ((before.nickname ?? '') !== (after.nickname ?? '')) out.push({ label: 'Nickname', before: before.nickname ?? '', after: after.nickname ?? '' });
  const a = new Map(listTextFields(before).map((f) => [f.path, f]));
  const b = new Map(listTextFields(after).map((f) => [f.path, f]));
  const paths = [...new Set([...b.keys(), ...a.keys()])];
  for (const p of paths) {
    const x = a.get(p)?.text ?? '';
    const y = b.get(p)?.text ?? '';
    if (x !== y) out.push({ label: (b.get(p) ?? a.get(p))!.label, before: x, after: y });
  }
  const tags = (d: CardData) => d.tags.join(', ');
  if (tags(before) !== tags(after)) out.push({ label: 'Tags', before: tags(before), after: tags(after) });
  if (before.creator !== after.creator) out.push({ label: 'Creator', before: before.creator, after: after.creator });
  if (before.character_version !== after.character_version) out.push({ label: 'Character version', before: before.character_version, after: after.character_version });
  // Lorebook entries' keys and switches aren't text fields; say so if they moved.
  const lore = (d: CardData) => JSON.stringify((d.character_book?.entries ?? []).map(({ content: _c, ...rest }) => (void _c, rest)));
  if (lore(before) !== lore(after)) out.push({ label: 'Lorebook entries (keys, names, settings)', before: '', after: '' });
  return out;
}
