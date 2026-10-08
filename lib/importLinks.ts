// Import from URL takes several links at once, one per line, as
// SillyTavern's does.

/** The links in what was pasted: one per line, blank lines skipped, and
 *  each link once. */
export function splitLinks(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const link = line.trim();
    if (!link || seen.has(link)) continue;
    seen.add(link);
    links.push(link);
  }
  return links;
}
