// The card lists a page at a time, as SillyTavern's character list is: so a
// library of hundreds of cards doesn't load every picture at once.

/** How many cards a page can hold (0 is every card on one page). */
export const CARD_PAGE_SIZES = [25, 50, 100, 250, 0] as const;

export const DEFAULT_CARD_PAGE_SIZE = 50;

/** One page of these items: the page asked for, kept in range (so a page
 *  that's gone, after a filter or a delete, shows the last one there is). */
export function pageOf<T>(items: T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  if (size <= 0) return { items, page: 0, pages: 1 };
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  return { items: items.slice(at * size, (at + 1) * size), page: at, pages };
}

/** The page this item is on, or -1 if it isn't in the list. */
export function pageWith<T>(items: T[], match: (item: T) => boolean, size: number): number {
  const i = items.findIndex(match);
  return i < 0 ? -1 : size <= 0 ? 0 : Math.floor(i / size);
}
