import type { CardData, CharacterCard, Lorebook, LorebookEntry } from '@/types/card';

// Reading any card (V1, V2, V3) into the V3 shape the editor works on, and
// writing it back out as V3 and V2. Nothing unknown is dropped: fields and
// extensions other frontends added ride along untouched.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(str);
  if (typeof v === 'string') return splitList(v);
  return [];
};

/** A comma-separated list as the editor's tag and key fields take it:
 *  trimmed, with empty items dropped. */
export function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const joinList = (items: string[] | undefined) => (items ?? []).join(', ');

export function newCard(): CharacterCard {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '',
      description: '',
      tags: [],
      creator: '',
      character_version: '',
      mes_example: '',
      extensions: {},
      system_prompt: '',
      post_history_instructions: '',
      first_mes: '',
      alternate_greetings: [],
      personality: '',
      scenario: '',
      creator_notes: '',
      group_only_greetings: [],
    },
  };
}

export function newLorebook(): Lorebook {
  return { extensions: {}, entries: [] };
}

export function newEntry(entries: LorebookEntry[] = []): LorebookEntry {
  const ids = entries.map((e) => (typeof e.id === 'number' ? e.id : -1));
  const orders = entries.map((e) => e.insertion_order ?? 0);
  return {
    keys: [],
    content: '',
    extensions: {},
    enabled: true,
    insertion_order: orders.length ? Math.max(...orders) + 1 : 100,
    use_regex: false,
    constant: false,
    selective: false,
    secondary_keys: [],
    case_sensitive: false,
    name: '',
    comment: '',
    id: ids.length ? Math.max(...ids) + 1 : 0,
    position: 'before_char',
  };
}

/** An entry's display name: `name` (Chub) or `comment` (SillyTavern). */
export const entryName = (e: LorebookEntry) => e.name || e.comment || '';

/** Whether any entry's name and comment disagree with one of them empty,
 *  which frontends read differently (Chub shows name, SillyTavern comment). */
export const hasMismatchedEntryNames = (book: Lorebook | undefined) =>
  !!book?.entries.some((e) => (e.name ?? '') !== (e.comment ?? '') && (!e.name || !e.comment));

/** Fills whichever of name/comment is empty from the other. */
export function backfillEntryNames(book: Lorebook): Lorebook {
  return {
    ...book,
    entries: book.entries.map((e) => {
      const name = e.name || e.comment || '';
      return { ...e, name: e.name || name, comment: e.comment || name };
    }),
  };
}

function normalizeEntry(raw: unknown, index: number): LorebookEntry {
  const e = isObject(raw) ? raw : {};
  const entry: LorebookEntry = {
    ...e,
    keys: strArray(e.keys),
    content: str(e.content),
    extensions: isObject(e.extensions) ? e.extensions : {},
    enabled: e.enabled !== false,
    insertion_order: typeof e.insertion_order === 'number' ? e.insertion_order : Number(e.insertion_order) || 0,
    // SillyTavern marks every entry it exports use_regex while reading plain
    // keys as plain text (only /pattern/ keys are patterns), so its entries
    // (they carry its display_index) are read the way it reads them.
    use_regex: e.use_regex === true && !(isObject(e.extensions) && typeof e.extensions.display_index === 'number'),
  };
  if (e.secondary_keys !== undefined) entry.secondary_keys = strArray(e.secondary_keys);
  if (entry.id === undefined) entry.id = index;
  return entry;
}

export function normalizeLorebook(raw: unknown): Lorebook | undefined {
  if (!isObject(raw)) return undefined;
  // A standalone lorebook file wraps the book: { spec: "lorebook_v3", data }.
  const book = raw.spec === 'lorebook_v3' && isObject(raw.data) ? raw.data : raw;
  return {
    ...book,
    extensions: isObject(book.extensions) ? book.extensions : {},
    entries: Array.isArray(book.entries) ? book.entries.map(normalizeEntry) : [],
  };
}

/**
 * Any card JSON as a V3 card. V2/V3 keep their fields under `data`; V1 has
 * them at the top level. SillyTavern writes both, so `data` wins when present.
 * Returns null for something that isn't a card at all.
 */
export function normalizeCard(raw: unknown): CharacterCard | null {
  if (!isObject(raw)) return null;
  if (raw.spec === 'lorebook_v3') return null;
  const src = isObject(raw.data) && (raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3' || 'name' in raw.data)
    ? raw.data
    : raw;
  if (!('name' in src) && !('description' in src) && !('first_mes' in src)) return null;

  const base = newCard().data;
  const data: CardData = {
    ...base,
    ...src,
    name: str(src.name),
    description: str(src.description),
    personality: str(src.personality),
    scenario: str(src.scenario),
    first_mes: str(src.first_mes),
    mes_example: str(src.mes_example),
    creator_notes: str(src.creator_notes ?? src.creatorcomment),
    system_prompt: str(src.system_prompt),
    post_history_instructions: str(src.post_history_instructions),
    creator: str(src.creator),
    character_version: str(src.character_version),
    tags: strArray(src.tags).map((t) => t.trim()).filter(Boolean),
    alternate_greetings: strArray(src.alternate_greetings),
    group_only_greetings: strArray(src.group_only_greetings),
    extensions: isObject(src.extensions) ? src.extensions : {},
  };
  delete (data as Record<string, unknown>).creatorcomment;
  const book = normalizeLorebook(src.character_book);
  if (book) data.character_book = book;
  else delete data.character_book;
  return { spec: 'chara_card_v3', spec_version: '3.0', data };
}

const V3_ONLY = ['assets', 'nickname', 'creator_notes_multilingual', 'source', 'group_only_greetings', 'creation_date', 'modification_date'] as const;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The card as exported under V3, stamped with its dates. */
export function toV3(card: CharacterCard, now = Math.floor(Date.now() / 1000)): CharacterCard {
  const out = clone(card);
  out.spec = 'chara_card_v3';
  out.spec_version = '3.0';
  if (typeof out.data.creation_date !== 'number') out.data.creation_date = now;
  out.data.modification_date = now;
  return out;
}

/**
 * The card as exported under V2 for frontends that only read the `chara`
 * chunk: V3-only fields left out, and the V1 fields repeated at the top
 * level, as SillyTavern writes them, for the oldest readers.
 */
export function toV2(card: CharacterCard): Record<string, unknown> {
  const data = clone(card.data) as Record<string, unknown>;
  for (const key of V3_ONLY) delete data[key];
  if (isObject(data.character_book)) {
    const book = data.character_book as unknown as Lorebook;
    book.entries = book.entries.map((e) => {
      const { use_regex: _useRegex, ...rest } = e;
      void _useRegex;
      return rest as LorebookEntry;
    });
  }
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    name: card.data.name,
    description: card.data.description,
    personality: card.data.personality,
    scenario: card.data.scenario,
    first_mes: card.data.first_mes,
    mes_example: card.data.mes_example,
    data,
  };
}

/** A standalone lorebook file, as SillyTavern and Chub import it. */
export const lorebookFile = (book: Lorebook) => ({ spec: 'lorebook_v3', data: clone(book) });
