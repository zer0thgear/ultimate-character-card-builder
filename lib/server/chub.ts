import 'server-only';
import { BadRequestError, NotFoundError } from '@/lib/server/storage';
import type { UrlCardImport } from '@/lib/extensions/types';

// Characters from Chub (chub.ai, characterhub.org), as SillyTavern's
// "Import from URL" fetches them: the project's definition from Chub's API,
// made into a V2 card, and its picture at full size. Links to Chub mirrors
// (Cardbox) name the same characters by the same paths, and are fetched
// through the mirror's copy of Chub's API: it has characters Chub hides in
// some places (NSFL ones), which is what the mirror is for. If the mirror
// can't be reached, Chub's own API is tried.

const CHUB_HOSTS = ['chub.ai', 'characterhub.org'];
/** Sites that mirror Chub's character pages at Chub's paths, and where
 *  their copy of Chub's API is. */
const CHUB_MIRRORS: Record<string, { name: string; apiBase: string }> = { 'cardbox.moe': { name: 'Cardbox', apiBase: 'https://cardbox.moe/gateway' } };
/** Where Chub keeps pictures; the only hosts a picture is fetched from. */
const PICTURE_HOSTS = ['chub.ai', 'characterhub.org', 'charhub.io'];

const onHost = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

export const isChubHost = (host: string) => onHost(host.toLowerCase(), CHUB_HOSTS);

/** The mirror a host belongs to (Cardbox), if it's one. */
const mirrorOf = (host: string) => Object.entries(CHUB_MIRRORS).find(([domain]) => onHost(host.toLowerCase(), [domain]))?.[1];

/** A Chub character link (or a mirror's) as its id, where it's from, and
 *  (for a mirror) where its copy of Chub's API is. */
export function chubLink(link: string): { id: string; source: string; apiBase?: string } | null {
  const id = chubCharacterId(link);
  if (!id) return null;
  try {
    const mirror = mirrorOf(new URL(link.trim()).hostname);
    if (mirror) return { id, source: mirror.name, apiBase: mirror.apiBase };
  } catch {
    /* a bare path */
  }
  return { id, source: 'Chub' };
}

/**
 * The character a Chub link (or a mirror's) names. A mirror's link is
 * fetched through the mirror; if that fails other than by not having it,
 * from Chub. Chub not having it says it may be hidden there.
 */
export async function chubLinkCharacter(link: string): Promise<UrlCardImport | null> {
  const found = chubLink(link);
  if (!found) return null;
  const { id, source, apiBase } = found;
  if (apiBase) {
    try {
      return await chubCharacter(id, { apiBase, source });
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      const viaChub = await chubCharacter(id).catch(() => null);
      if (!viaChub) throw err;
      return { ...viaChub, source: `${source} (from Chub)` };
    }
  }
  try {
    return await chubCharacter(id);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    throw new NotFoundError(`Chub has no character at ${id}. If it's there but hidden where you are (Chub hides NSFL cards in some places), its link on cardbox.moe may work.`);
  }
}

/**
 * A Chub character's id ("creator/name") from a link (Chub's or a
 * mirror's) or a bare path, as SillyTavern reads them:
 * /characters/creator/name, or creator/name. Null for anything else
 * (lorebooks included, for now).
 */
export function chubCharacterId(link: string): string | null {
  let path = link.trim();
  try {
    const url = new URL(path);
    if (!isChubHost(url.hostname) && !mirrorOf(url.hostname)) return null;
    path = url.pathname;
  } catch {
    /* a bare path */
  }
  const parts = path.split(/[?#]/)[0].split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0]?.toLowerCase() === 'characters') parts.shift();
  else if (parts[0]?.toLowerCase() === 'lorebooks') return null;
  if (parts.length !== 2 || parts.some((p) => !/^[\w.~-]+$/.test(p))) return null;
  return parts.join('/');
}

interface ChubDefinition {
  name?: string;
  personality?: string;
  tavern_personality?: string;
  scenario?: string;
  first_message?: string;
  example_dialogs?: string;
  description?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  embedded_lorebook?: unknown;
  extensions?: Record<string, unknown>;
}

const TIMEOUT_MS = 20_000;

export interface ChubOptions {
  /** Chub's API, or a mirror of it with the same paths and replies. */
  apiBase?: string;
  /** Hosts the picture may come from, beyond Chub's own. */
  pictureHosts?: string[];
  /** Named in messages ("Chub" by default). */
  source?: string;
}

/** A Chub character as a card, by its id ("creator/name"). */
export async function chubCharacter(id: string, opts: ChubOptions = {}): Promise<UrlCardImport> {
  const [creator, name] = id.split('/');
  const source = opts.source ?? 'Chub';
  const base = (opts.apiBase ?? 'https://api.chub.ai').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/characters/${encodeURIComponent(creator)}/${encodeURIComponent(name)}?full=true`, {
    headers: { Accept: 'application/json', 'User-Agent': 'UCCB' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) throw new NotFoundError(`${source} has no character at ${id}.`);
  if (!res.ok) {
    // Chub's refusals say why in plain text ("not available in your country").
    const why = (await res.text().catch(() => '')).trim().slice(0, 200);
    throw new Error(`${source} said ${res.status} for ${id}${why && !why.startsWith('<') ? `: ${why}` : '.'}`);
  }
  const json = (await res.json()) as { node?: { definition?: ChubDefinition; topics?: string[]; max_res_url?: string; avatar_url?: string } };
  const node = json.node;
  const d = node?.definition;
  if (!d) throw new BadRequestError(`${source}'s reply for ${id} had no character in it.`);
  // Chub's names for the fields aren't the card's: its "personality" is the
  // description, its "description" the creator's notes.
  const card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: d.name ?? name,
      description: d.personality ?? '',
      personality: d.tavern_personality ?? '',
      scenario: d.scenario ?? '',
      first_mes: d.first_message ?? '',
      mes_example: d.example_dialogs ?? '',
      creator_notes: d.description ?? '',
      system_prompt: d.system_prompt ?? '',
      post_history_instructions: d.post_history_instructions ?? '',
      alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings : [],
      tags: Array.isArray(node?.topics) ? node.topics : [],
      creator,
      character_version: '',
      ...(d.embedded_lorebook ? { character_book: d.embedded_lorebook } : {}),
      extensions: d.extensions ?? {},
    },
  };
  return { card, avatar: await chubPicture(node?.max_res_url ?? node?.avatar_url, [...PICTURE_HOSTS, ...(opts.pictureHosts ?? [])]), source };
}

/** The character's picture, from Chub's own hosts (or the mirror's) only. */
async function chubPicture(link: string | undefined, hosts: string[]): Promise<UrlCardImport['avatar']> {
  if (!link) return undefined;
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || !onHost(url.hostname, hosts)) return undefined;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    if (!type.startsWith('image/')) return undefined;
    return { bytes: new Uint8Array(await res.arrayBuffer()), type };
  } catch {
    // The card comes without a picture rather than not at all.
    return undefined;
  }
}
