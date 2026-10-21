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

// Updating a card from where it came from: fetched again from its link, as
// Import from URL fetches it, and put in place of the card's text (as
// Overwrite does).

/** Hosts Import from URL takes (an extension can take others). */
const KNOWN_HOSTS = ['chub.ai', 'characterhub.org', 'cardbox.moe'];
const onKnownHost = (link: string) => {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return KNOWN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

/**
 * The links a card can be fetched again from, best first: its sources
 * (V3's `source`) on Chub or Cardbox, then its other web sources (an
 * extension may know them), then its Chub page from Chub's metadata
 * (a card saved from Chub as a file).
 */
export function sourceLinks(card: { source?: string[]; extensions?: Record<string, unknown> }): string[] {
  const web = (card.source ?? []).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
  const chub = card.extensions?.chub as { full_path?: unknown } | undefined;
  const fromChub = typeof chub?.full_path === 'string' && /^[\w.~-]+\/[\w.~-]+$/.test(chub.full_path) ? [`https://chub.ai/characters/${chub.full_path}`] : [];
  return [...new Set([...web.filter(onKnownHost), ...web.filter((s) => !onKnownHost(s)), ...fromChub])];
}

/** What a field is called, for saying what an update changed. */
const FIELD_NAMES: Record<string, string> = {
  name: 'name',
  nickname: 'nickname',
  description: 'description',
  personality: 'personality',
  scenario: 'scenario',
  first_mes: 'first message',
  alternate_greetings: 'greetings',
  group_only_greetings: 'group greetings',
  mes_example: 'example messages',
  system_prompt: 'system prompt',
  post_history_instructions: 'post-history instructions',
  creator_notes: "creator's notes",
  creator_notes_multilingual: "creator's notes",
  tags: 'tags',
  creator: 'creator',
  character_version: 'version',
  character_book: 'lorebook',
  extensions: 'extensions',
  assets: 'assets',
};
/** Not the card's content: when it was made or saved, and where it came from. */
const IGNORED = new Set(['creation_date', 'modification_date', 'source']);

/** JSON with object keys in order, so the same content reads the same. */
const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';

/** The fields that differ between a card and a newer copy of it, by name. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter((k) => !IGNORED.has(k)));
  const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && v !== null && !Object.keys(v).length);
  const same = (a: unknown, b: unknown) => (empty(a) && empty(b)) || stable(a) === stable(b);
  return [...new Set([...keys].filter((k) => !same(before[k], after[k])).map((k) => FIELD_NAMES[k] ?? k))];
}
