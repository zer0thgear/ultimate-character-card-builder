// Shared assembly rules for stitching prompt fragments together. Every place
// that concatenates prompt text (base + tidbits, prefixes, quality/UC presets,
// the transparent-background suffix) goes through here so they can't disagree.

/** Strips surrounding whitespace plus any stray leading/trailing commas, so a
 *  field's own punctuation can't leak into the delimiter. Tag autocomplete
 *  deliberately leaves a trailing `", "` behind after a selection (ready for
 *  the next tag), which makes trailing commas the common case, not an edge one. */
export function normalizePromptPart(part: string | null | undefined): string {
  return (part ?? '').replace(/^[\s,]+/, '').replace(/[\s,]+$/, '');
}

/** Joins prompt fragments with ", ", dropping empties and normalizing each one
 *  so no fragment's leading/trailing comma can produce ", ," in the result. */
export function joinPromptParts(...parts: (string | null | undefined)[]): string {
  return parts.map(normalizePromptPart).filter(Boolean).join(', ');
}

/** Returns a copy of `items` with the entry at `index` moved one slot toward
 *  `direction`, or the original array if that would fall off either end. */
export function moveItem<T>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Moves the item with `id` one step toward `direction`, past its nearest
 *  neighbour that `isShown` keeps, so reordering a filtered view never looks
 *  like a no-op swap with something hidden. Hidden items keep their places.
 *  Returns the original array if there's no shown neighbour that way. */
export function moveItemAmong<T extends { id: string }>(
  items: T[],
  id: string,
  direction: 'up' | 'down',
  isShown: (item: T) => boolean,
): T[] {
  const from = items.findIndex((i) => i.id === id);
  if (from < 0) return items;
  const step = direction === 'up' ? -1 : 1;
  let to = from + step;
  while (to >= 0 && to < items.length && !isShown(items[to])) to += step;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
