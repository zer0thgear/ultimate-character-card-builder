// App tags: SillyTavern's own tags, kept by UCCB rather than in the cards.
// The tags written in a card (card.data.tags) travel with it; these are
// yours, for sorting your collection: named, coloured, filtered on (show
// only, or hide), and optionally shown as folders ("Tags as Folders").
//
// As in ST (public/scripts/tags.js), a tag is a folder only when it's set
// to be one:
//   open    the folder shows in the list, and its cards show outside it too
//   closed  its cards show only inside it (and in no other closed folder
//           you haven't opened)
// Opening a folder is the same as filtering on its tag, so the folders you
// are in are the "show only" tags that are folders.
//
// Saved on the server (data/tags.json) so every device shares them.

export type TagFolder = 'none' | 'open' | 'closed';

export interface AppTag {
  id: string;
  name: string;
  /** Background colour of its chip ('' or unset: the usual grey). */
  color?: string;
  /** Text colour of its chip. */
  color2?: string;
  folder: TagFolder;
  /** Its place in the tag list (Manage tags), lowest first. */
  order: number;
  createdAt: number;
  /** Left off the cards in the lists (still filters, still a folder). */
  hideOnCard?: boolean;
}

/** What to do with the tags written in a card when it's imported. */
export type TagImport = 'ask' | 'none' | 'all' | 'existing';

export interface AppTagData {
  tags: AppTag[];
  /** Card (project) id → its tags' ids. */
  map: Record<string, string[]>;
  /** "Tags as Folders": folder tags show as folders in the card lists. */
  folders: boolean;
  importMode: TagImport;
}

export const EMPTY_TAG_DATA: AppTagData = { tags: [], map: {}, folders: true, importMode: 'ask' };

/** A card list's filter on app tags: shown only with all of `include`
 *  (the folders you're in among them), hidden with any of `exclude`. */
export interface AppTagFilter {
  include: string[];
  exclude: string[];
}

export const NO_TAG_FILTER: AppTagFilter = { include: [], exclude: [] };

/** ST leaves these out when importing a card's tags. */
const IMPORT_EXCLUDED = ['root', 'tavern'];
/** And imports no more than this many from one card. */
export const IMPORT_MAX_TAGS = 50;

const same = (a: string, b: string) => a.trim().localeCompare(b.trim(), undefined, { sensitivity: 'base' }) === 0;

export const isFolder = (t: Pick<AppTag, 'folder'> | undefined) => !!t && t.folder !== 'none';

/** The tag called `name` (any case or accents). */
export function findTag(tags: AppTag[], name: string): AppTag | undefined {
  return tags.find((t) => same(t.name, name));
}

/** A new tag (not yet added to the list). */
export function newTag(name: string, tags: AppTag[], id: string, now = Date.now()): AppTag {
  return { id, name: name.trim(), folder: 'none', order: Math.max(-1, ...tags.map((t) => t.order)) + 1, createdAt: now };
}

/** Tags in their list order (then A–Z). */
export function sortTags(tags: AppTag[]): AppTag[] {
  return [...tags].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

/** A card's tags, in list order. */
export function tagsOf(data: Pick<AppTagData, 'tags' | 'map'>, cardId: string): AppTag[] {
  const ids = new Set(data.map[cardId] ?? []);
  return sortTags(data.tags.filter((t) => ids.has(t.id)));
}

/** How many cards have each tag (by id). */
export function tagUse(data: Pick<AppTagData, 'tags' | 'map'>, cardIds?: Iterable<string>): Map<string, number> {
  const known = new Set(data.tags.map((t) => t.id));
  const use = new Map<string, number>();
  const ids = cardIds ? [...cardIds] : Object.keys(data.map);
  for (const card of ids) for (const t of new Set(data.map[card] ?? [])) if (known.has(t)) use.set(t, (use.get(t) ?? 0) + 1);
  return use;
}

/** The next state of a tag's filter chip when clicked, as in ST:
 *  off → show only → hide → off. */
export function cycleFilter(f: AppTagFilter, id: string): AppTagFilter {
  if (f.include.includes(id)) return { include: f.include.filter((x) => x !== id), exclude: [...f.exclude, id] };
  if (f.exclude.includes(id)) return { include: f.include, exclude: f.exclude.filter((x) => x !== id) };
  return { include: [...f.include, id], exclude: f.exclude };
}

export interface FolderEntry {
  tag: AppTag;
  /** Cards you'd see inside it. */
  count: number;
  /** A few of them, for the folder's picture. */
  sample: string[];
}

/** A card list after the app tag filter, and the folders to show above
 *  it. Cards in a closed folder you haven't opened are left out; a folder
 *  shows (with what it holds) unless it's open already, filtered out, or
 *  empty. Tags that no longer exist are ignored. */
export function applyAppTags<T extends { id: string }>(cards: T[], data: AppTagData, filter: AppTagFilter): { cards: T[]; folders: FolderEntry[] } {
  const byId = new Map(data.tags.map((t) => [t.id, t]));
  const include = filter.include.filter((id) => byId.has(id));
  const exclude = filter.exclude.filter((id) => byId.has(id));
  const has = (c: T) => new Set(data.map[c.id] ?? []);
  const filtered = cards.filter((c) => {
    const tags = has(c);
    return include.every((id) => tags.has(id)) && !exclude.some((id) => tags.has(id));
  });
  if (!data.folders) return { cards: filtered, folders: [] };
  const closed = data.tags.filter((t) => t.folder === 'closed' && !include.includes(t.id)).map((t) => t.id);
  // Hidden by a closed folder other than `except`.
  const hidden = (tags: Set<string>, except?: string) => closed.some((id) => id !== except && tags.has(id));
  const folders: FolderEntry[] = [];
  for (const tag of sortTags(data.tags)) {
    if (!isFolder(tag) || include.includes(tag.id) || exclude.includes(tag.id)) continue;
    const inside = filtered.filter((c) => {
      const tags = has(c);
      return tags.has(tag.id) && !hidden(tags, tag.id);
    });
    if (inside.length) folders.push({ tag, count: inside.length, sample: inside.slice(0, 4).map((c) => c.id) });
  }
  return { cards: filtered.filter((c) => !hidden(has(c))), folders };
}

/** The folders you're in, outermost first: the "show only" tags that are
 *  folders, in the order you went in. */
export function openFolders(data: Pick<AppTagData, 'tags' | 'folders'>, filter: AppTagFilter): AppTag[] {
  if (!data.folders) return [];
  return filter.include.map((id) => data.tags.find((t) => t.id === id)).filter((t): t is AppTag => isFolder(t));
}

/** What importing a card's own tags as app tags would bring: tags you have
 *  already, and new ones. Leaves out ROOT and TAVERN (as ST does),
 *  repeats, and tags the card has already. */
export function importCandidates(cardTags: string[], data: Pick<AppTagData, 'tags' | 'map'>, cardId?: string): { existing: AppTag[]; fresh: string[] } {
  const assigned = new Set(cardId ? (data.map[cardId] ?? []) : []);
  const existing: AppTag[] = [];
  const fresh: string[] = [];
  for (const raw of cardTags) {
    const name = raw.trim();
    if (!name || IMPORT_EXCLUDED.includes(name.toLowerCase())) continue;
    if (existing.length + fresh.length >= IMPORT_MAX_TAGS) break;
    const tag = findTag(data.tags, name);
    if (tag) {
      if (!assigned.has(tag.id) && !existing.includes(tag)) existing.push(tag);
    } else if (!fresh.some((f) => same(f, name))) fresh.push(name);
  }
  return { existing, fresh };
}

/** `data` with `names` added to the card's tags: new tags are made (with
 *  ids from `makeId`) unless `onlyExisting`. */
export function addTagsToCard(data: AppTagData, cardId: string, names: string[], makeId: () => string, onlyExisting = false): AppTagData {
  let tags = data.tags;
  const ids = [...(data.map[cardId] ?? [])];
  for (const name of names) {
    if (!name.trim()) continue;
    let tag = findTag(tags, name);
    if (!tag) {
      if (onlyExisting) continue;
      tag = newTag(name, tags, makeId());
      tags = [...tags, tag];
    }
    if (!ids.includes(tag.id)) ids.push(tag.id);
  }
  return { ...data, tags, map: { ...data.map, [cardId]: ids } };
}

/** Puts a tag on every one of these cards, or (`on` false) takes it off
 *  them all: tagging many cards at once. */
export function setTagOnCards(data: AppTagData, cardIds: Iterable<string>, tagId: string, on: boolean): AppTagData {
  const map = { ...data.map };
  for (const id of cardIds) {
    const has = map[id] ?? [];
    if (on) {
      if (!has.includes(tagId)) map[id] = [...has, tagId];
    } else if (has.includes(tagId)) {
      const left = has.filter((t) => t !== tagId);
      if (left.length) map[id] = left;
      else delete map[id];
    }
  }
  return { ...data, map };
}

/** Reads a saved tag file (or anything else) into a sound one: bad
 *  entries dropped, missing fields filled in, the map pruned to known tags. */
export function cleanTagData(raw: unknown): AppTagData {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AppTagData, unknown>>;
  const seen = new Set<string>();
  const tags: AppTag[] = [];
  for (const t of Array.isArray(o.tags) ? o.tags : []) {
    if (!t || typeof t !== 'object') continue;
    const x = t as Record<string, unknown>;
    if (typeof x.id !== 'string' || !x.id || seen.has(x.id) || typeof x.name !== 'string' || !x.name.trim()) continue;
    seen.add(x.id);
    tags.push({
      id: x.id,
      name: x.name.trim(),
      ...(typeof x.color === 'string' && x.color ? { color: x.color } : {}),
      ...(typeof x.color2 === 'string' && x.color2 ? { color2: x.color2 } : {}),
      folder: x.folder === 'open' || x.folder === 'closed' ? x.folder : 'none',
      order: typeof x.order === 'number' && Number.isFinite(x.order) ? x.order : tags.length,
      createdAt: typeof x.createdAt === 'number' ? x.createdAt : 0,
      ...(x.hideOnCard === true ? { hideOnCard: true } : {}),
    });
  }
  const map: Record<string, string[]> = {};
  if (o.map && typeof o.map === 'object') {
    for (const [card, ids] of Object.entries(o.map as Record<string, unknown>)) {
      if (!Array.isArray(ids)) continue;
      const kept = [...new Set(ids.filter((id): id is string => typeof id === 'string' && seen.has(id)))];
      if (kept.length) map[card] = kept;
    }
  }
  const importMode = (['ask', 'none', 'all', 'existing'] as const).find((m) => m === o.importMode) ?? 'ask';
  return { tags, map, folders: o.folders !== false, importMode };
}

/** `data` without the tag (taken off every card, and out of `filter`s). */
export function removeTag(data: AppTagData, id: string): AppTagData {
  const map: Record<string, string[]> = {};
  for (const [card, ids] of Object.entries(data.map)) {
    const kept = ids.filter((x) => x !== id);
    if (kept.length) map[card] = kept;
  }
  return { ...data, tags: data.tags.filter((t) => t.id !== id), map };
}

/** `data` with a card's tags given to another (a copy). */
export function copyCardTags(data: AppTagData, from: string, to: string): AppTagData {
  const ids = data.map[from];
  return ids?.length ? { ...data, map: { ...data.map, [to]: [...ids] } } : data;
}

/** Turns a SillyTavern tag backup (Manage tags → Backup: `{ tags, tag_map }`)
 *  or a UCCB tag export into tags to merge, matched by name. ST's tag map
 *  is keyed by its card files, which UCCB doesn't have, so only the tags
 *  themselves come across from ST. */
export function parseTagBackup(raw: unknown): { tags: Omit<AppTag, 'id' | 'order'>[]; map?: Record<string, string[]>; byId?: Map<string, string> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.tags)) return null;
  const list: Omit<AppTag, 'id' | 'order'>[] = [];
  const byId = new Map<string, string>();
  for (const t of o.tags) {
    if (!t || typeof t !== 'object') continue;
    const x = t as Record<string, unknown>;
    if (typeof x.name !== 'string' || !x.name.trim()) continue;
    // ST spells folders OPEN / CLOSED / NONE in folder_type.
    const folderRaw = String(x.folder ?? x.folder_type ?? '').toLowerCase();
    list.push({
      name: x.name.trim(),
      ...(typeof x.color === 'string' && x.color ? { color: x.color } : {}),
      ...(typeof x.color2 === 'string' && x.color2 ? { color2: x.color2 } : {}),
      folder: folderRaw === 'open' || folderRaw === 'closed' ? folderRaw : 'none',
      createdAt: typeof x.createdAt === 'number' ? x.createdAt : typeof x.create_date === 'number' ? x.create_date : Date.now(),
      ...(x.hideOnCard === true || x.is_hidden_on_character_card === true ? { hideOnCard: true } : {}),
    });
    if (typeof x.id === 'string') byId.set(x.id, x.name.trim());
  }
  // A UCCB export carries its map (keyed by card id); ST's tag_map is not usable here.
  const map = o.map && typeof o.map === 'object' && !('tag_map' in o) ? (o.map as Record<string, string[]>) : undefined;
  return { tags: list, map, byId };
}

/** `data` with a backup merged in: tags matched by name keep yours (their
 *  colour and folder set from the backup where yours has none); new ones
 *  are added; a UCCB export's card assignments are added for cards you have. */
export function mergeTagBackup(data: AppTagData, backup: NonNullable<ReturnType<typeof parseTagBackup>>, cardIds: Set<string>, makeId: () => string): { data: AppTagData; added: number } {
  let tags = [...data.tags];
  let added = 0;
  for (const t of backup.tags) {
    const mine = findTag(tags, t.name);
    if (mine) {
      tags = tags.map((x) => (x === mine ? { ...x, color: x.color || t.color, color2: x.color2 || t.color2, folder: x.folder === 'none' ? t.folder : x.folder } : x));
    } else {
      tags.push({ ...newTag(t.name, tags, makeId(), t.createdAt), ...t, order: Math.max(-1, ...tags.map((x) => x.order)) + 1 });
      added++;
    }
  }
  const map = { ...data.map };
  if (backup.map && backup.byId) {
    for (const [card, ids] of Object.entries(backup.map)) {
      if (!cardIds.has(card) || !Array.isArray(ids)) continue;
      const mineIds = ids.map((id) => backup.byId!.get(id)).map((name) => (name ? findTag(tags, name)?.id : undefined)).filter((x): x is string => !!x);
      map[card] = [...new Set([...(map[card] ?? []), ...mineIds])];
    }
  }
  return { data: { ...data, tags, map }, added };
}
