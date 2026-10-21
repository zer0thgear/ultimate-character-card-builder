// Author tags: an app tag (lib/appTags.ts) for each card's author, put on
// cards as they're imported (and on every card at once from Manage tags),
// as people tag cards by author by hand in SillyTavern. Aliases send an
// author's other names (a second account, an old name) to one tag, or to
// any tag at all.
//
// A card's author is its creator field, else the creator in its Chub path
// (extensions.chub.full_path, "creator/name"), as Chub's own exports have it.

import type { AppTag, AppTagData } from '@/lib/appTags';
import { findTag, newTag } from '@/lib/appTags';

/** Not an author: what stands in for an anonymous upload. */
const NOBODY = ['anonymous', 'chub.ai', 'characterhub.org', 'unknown'];

const same = (a: string, b: string) => a.trim().localeCompare(b.trim(), undefined, { sensitivity: 'base' }) === 0;

/** A card's author ('' for none). */
export function cardAuthor(card: { creator?: string; extensions?: Record<string, unknown> }): string {
  const own = card.creator?.trim() ?? '';
  const chub = card.extensions?.chub as { full_path?: unknown } | undefined;
  const fromPath = typeof chub?.full_path === 'string' && chub.full_path.includes('/') ? chub.full_path.split('/')[0].trim() : '';
  const author = own || fromPath;
  return NOBODY.includes(author.toLowerCase()) ? '' : author;
}

/** The tag an author's cards get: their alias's, else their name. */
export function authorTagName(author: string, aliases: Record<string, string>): string {
  const alias = Object.entries(aliases).find(([from]) => same(from, author))?.[1]?.trim();
  return alias || author.trim();
}

/**
 * `data` with each card given its author's tag (made, marked as an author
 * tag, if there isn't one by that name). A card keeps one author tag: one
 * it had for another name (before an alias) comes off, and an author tag
 * left on no card goes too, unless you've made it your own (a colour, a
 * folder). Returns how many cards changed.
 */
export function tagCardsByAuthor(data: AppTagData, cards: { id: string; author: string }[], aliases: Record<string, string>, makeId: () => string): { data: AppTagData; changed: number } {
  let tags = data.tags;
  const map = { ...data.map };
  let changed = 0;
  const tookOff = new Set<string>();
  for (const card of cards) {
    if (!card.author.trim()) continue;
    const name = authorTagName(card.author, aliases);
    let tag: AppTag | undefined = findTag(tags, name);
    if (!tag) {
      tag = { ...newTag(name, tags, makeId()), author: true };
      tags = [...tags, tag];
    }
    const has = map[card.id] ?? [];
    const authorTags = new Set(tags.filter((t) => t.author).map((t) => t.id));
    const next = [...has.filter((id) => id === tag.id || !authorTags.has(id)), ...(has.includes(tag.id) ? [] : [tag.id])];
    if (next.length !== has.length || next.some((id, i) => id !== has[i])) {
      for (const id of has) if (!next.includes(id)) tookOff.add(id);
      map[card.id] = next;
      changed++;
    }
  }
  const used = new Set(Object.values(map).flat());
  const leftover = (t: AppTag) => tookOff.has(t.id) && t.author && !used.has(t.id) && !t.color && !t.color2 && t.folder === 'none';
  return { data: { ...data, tags: tags.filter((t) => !leftover(t)), map }, changed };
}

/** The authors among these cards, most cards first. */
export function authorsIn(cards: { author: string }[]): { author: string; cards: number }[] {
  const count = new Map<string, { author: string; cards: number }>();
  for (const c of cards) {
    const a = c.author.trim();
    if (!a) continue;
    const key = a.toLowerCase();
    const seen = count.get(key);
    if (seen) seen.cards++;
    else count.set(key, { author: a, cards: 1 });
  }
  return [...count.values()].sort((a, b) => b.cards - a.cards || a.author.localeCompare(b.author, undefined, { sensitivity: 'base' }));
}
