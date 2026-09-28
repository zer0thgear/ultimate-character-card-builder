import type { GenInfo } from '@/lib/genMetadata';

// The gen library's search: comma separated like a
// prompt, every term required, `-` negates, `|` means "either" within a
// term. Field prefixes narrow a term:
//   char:elf   neg:blurry   model:v4.5   seed:123   file:foo   folder:bar
//   chars:2  chars:2+  chars:1-3  chars:>1  chars:<=1
// A negated term on a field an image doesn't have (a stray gen with no
// metadata) counts as "not matching", so the image stays in.

export interface LibraryItem {
  /** Stable id: a hash of the absolute path. */
  id: string;
  /** Index into the configured library folders. */
  root: number;
  /** Path under its root, forward slashes. */
  rel: string;
  /** `rel` without the file name ('' at the root). */
  folder: string;
  name: string;
  size: number;
  mtime: number;
  width: number;
  height: number;
  info: GenInfo;
}

type Atom = (item: LibraryItem) => boolean | undefined;

const lower = (s: string | undefined) => (s ?? '').toLowerCase();

function countMatcher(expr: string): ((n: number) => boolean) | null {
  let m: RegExpMatchArray | null;
  if ((m = expr.match(/^(\d+)\+$/))) return (n) => n >= +m![1];
  if ((m = expr.match(/^(\d+)-(\d+)$/))) return (n) => n >= +m![1] && n <= +m![2];
  if ((m = expr.match(/^(>=|<=|>|<)(\d+)$/))) {
    const v = +m[2];
    return { '>=': (n: number) => n >= v, '<=': (n: number) => n <= v, '>': (n: number) => n > v, '<': (n: number) => n < v }[m[1]]!;
  }
  if ((m = expr.match(/^(\d+)$/))) return (n) => n === +m![1];
  return null;
}

/** A model's short code: v3, v4, v4.5, v5… */
export function modelCode(model: string | undefined): string {
  const m = lower(model).match(/v(\d+(?:\.\d+)?)/);
  return m ? `v${m[1]}` : '';
}

/** One alternative of one term. Undefined means "this image has no such
 *  field", which a negated term treats as a pass. */
function atom(text: string): Atom {
  const colon = text.indexOf(':');
  const key = colon > 0 ? text.slice(0, colon) : '';
  const value = colon > 0 ? text.slice(colon + 1).trim() : text;
  const contains = (field: (i: LibraryItem) => string | undefined): Atom => (i) => {
    const f = field(i);
    return f === undefined || f === '' ? undefined : lower(f).includes(value);
  };
  switch (key) {
    case 'char':
      return (i) => (i.info.characters?.length ? i.info.characters.some((c) => lower(c.prompt).includes(value)) : undefined);
    case 'neg':
      return contains((i) => [i.info.negative, ...(i.info.characters ?? []).map((c) => c.uc)].filter(Boolean).join('\n'));
    case 'model':
      return (i) => (i.info.model ? modelCode(i.info.model) === value || lower(i.info.model).includes(value) : undefined);
    case 'seed':
      return (i) => (i.info.seed === undefined ? undefined : String(i.info.seed) === value);
    case 'sampler':
      return contains((i) => i.info.sampler);
    case 'type':
      return contains((i) => i.info.requestType);
    case 'file':
      return (i) => lower(i.name).includes(value);
    case 'folder':
      return (i) => lower(i.folder).includes(value);
    case 'chars': {
      const match = countMatcher(value);
      return (i) => (i.info.characters === undefined || !match ? undefined : match(i.info.characters.length));
    }
    default:
      // Not a known field: the whole text is a prompt phrase (it may itself
      // contain a colon, like "text:hello").
      return (i) => {
        const hay = [i.info.prompt, ...(i.info.characters ?? []).map((c) => c.prompt)].filter(Boolean).join('\n');
        return hay ? lower(hay).includes(text) : undefined;
      };
  }
}

export interface ParsedTerm {
  negated: boolean;
  alternatives: Atom[];
}

export function parseSearch(query: string): ParsedTerm[] {
  return query
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((t) => {
      const negated = t.startsWith('-') && t.length > 1;
      const body = negated ? t.slice(1).trim() : t;
      return { negated, alternatives: body.split('|').map((a) => a.trim()).filter(Boolean).map(atom) };
    })
    .filter((t) => t.alternatives.length > 0);
}

export function matches(item: LibraryItem, terms: ParsedTerm[]): boolean {
  return terms.every(({ negated, alternatives }) => {
    const results = alternatives.map((a) => a(item));
    const hit = results.some((r) => r === true);
    if (negated) return !hit;
    return hit;
  });
}

export function searchLibrary(items: LibraryItem[], query: string): LibraryItem[] {
  const terms = parseSearch(query);
  return terms.length ? items.filter((i) => matches(i, terms)) : items;
}
