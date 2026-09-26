import JSZip from 'jszip';
import type { CharacterCard } from '@/types/card';
import { normalizeCard, normalizeLorebook, toV2, toV3 } from '@/lib/cardSpec';
import { base64ToUtf8, isPng, readTextChunks, replaceTextChunks, utf8ToBase64 } from '@/lib/png';
import type { Lorebook } from '@/types/card';

// Card files in and out: PNG (a `ccv3` and/or `chara` tEXt chunk holding
// base64 JSON), plain JSON, and CHARX (a zip with card.json and its assets).

export interface ImportedCard {
  card: CharacterCard;
  /** The avatar, if the file carried one: a PNG card's own picture (with
   *  its card chunks removed), or a CHARX's main icon. */
  avatar?: { bytes: Uint8Array; type: string };
  /** Which chunk a PNG's card came from, for the import message. */
  source: 'ccv3' | 'chara' | 'json' | 'charx';
}

export class CardImportError extends Error {}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new CardImportError("The file isn't valid JSON.");
  }
}

/** The card chunks of a PNG, V3 first. */
function cardChunks(png: Uint8Array) {
  const chunks = readTextChunks(png);
  const pick = (k: string) => chunks.find((c) => c.keyword.toLowerCase() === k);
  return { ccv3: pick('ccv3'), chara: pick('chara') };
}

const MIME_BY_EXT: Record<string, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', avif: 'image/avif' };

async function importCharx(bytes: Uint8Array): Promise<ImportedCard> {
  const zip = await JSZip.loadAsync(bytes);
  const cardFile = zip.file('card.json');
  if (!cardFile) throw new CardImportError('This zip has no card.json, so it isn\'t a CHARX card.');
  const card = normalizeCard(parseJson(await cardFile.async('string')));
  if (!card) throw new CardImportError("card.json in this CHARX doesn't hold a character card.");
  const icons = (card.data.assets ?? []).filter((a) => a.type === 'icon');
  const icon = icons.find((a) => a.name === 'main') ?? icons[0];
  let avatar: ImportedCard['avatar'];
  if (icon?.uri.startsWith('embeded://') || icon?.uri.startsWith('embedded://')) {
    const path = icon.uri.replace(/^embedd?ed:\/\//, '');
    const file = zip.file(path);
    if (file) avatar = { bytes: await file.async('uint8array'), type: MIME_BY_EXT[icon.ext?.toLowerCase()] ?? 'image/png' };
  }
  return { card, avatar, source: 'charx' };
}

/** Reads a dropped or picked card file of any supported kind. */
export async function importCardFile(name: string, bytes: Uint8Array): Promise<ImportedCard> {
  if (isPng(bytes)) {
    const { ccv3, chara } = cardChunks(bytes);
    if (!ccv3 && !chara) throw new CardImportError('This PNG has no character card data in it.');
    const read = (text: string) => {
      try {
        return normalizeCard(JSON.parse(base64ToUtf8(text)));
      } catch {
        return null;
      }
    };
    // A broken ccv3 chunk falls back to chara.
    let card = ccv3 ? read(ccv3.text) : null;
    let source: ImportedCard['source'] = 'ccv3';
    if (!card && chara) {
      card = read(chara.text);
      source = 'chara';
    }
    if (!card) throw new CardImportError("This PNG's card data couldn't be read.");
    return { card, avatar: { bytes: replaceTextChunks(bytes, []), type: 'image/png' }, source };
  }
  if (isZip(bytes) || /\.charx$/i.test(name)) return importCharx(bytes);
  const card = normalizeCard(parseJson(new TextDecoder().decode(bytes)));
  if (!card) throw new CardImportError("This JSON file doesn't hold a character card.");
  return { card, source: 'json' };
}

/** A lorebook from a standalone lorebook JSON, or the one inside a card
 *  (PNG, JSON or CHARX). */
export async function importLorebookFile(name: string, bytes: Uint8Array): Promise<Lorebook> {
  if (!isPng(bytes) && !isZip(bytes)) {
    const raw = parseJson(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (raw && (raw.spec === 'lorebook_v3' || Array.isArray(raw.entries) || typeof raw.entries === 'object')) {
      // SillyTavern's own world files keep entries as an object keyed by uid.
      const entries = raw.entries && !Array.isArray(raw.entries) && raw.spec !== 'lorebook_v3'
        ? Object.values(raw.entries as Record<string, unknown>).map(fromSillyTavernEntry)
        : undefined;
      const book = normalizeLorebook(entries ? { ...raw, entries } : raw);
      if (book) return book;
    }
  }
  const { card } = await importCardFile(name, bytes);
  if (!card.data.character_book) throw new CardImportError('That card has no lorebook attached.');
  return card.data.character_book;
}

/** A SillyTavern world-info entry (its own format) as a card lorebook entry. */
function fromSillyTavernEntry(raw: unknown) {
  const e = (raw ?? {}) as Record<string, unknown>;
  return {
    keys: e.key ?? e.keys ?? [],
    secondary_keys: e.keysecondary ?? e.secondary_keys ?? [],
    content: e.content ?? '',
    comment: e.comment ?? '',
    name: e.comment ?? '',
    enabled: e.disable !== true,
    constant: e.constant === true,
    selective: e.selective === true,
    insertion_order: typeof e.order === 'number' ? e.order : 100,
    position: e.position === 1 ? 'after_char' : 'before_char',
    case_sensitive: e.caseSensitive === true,
    use_regex: false,
    id: e.uid,
    extensions: { depth: e.depth, probability: e.probability, useProbability: e.useProbability },
  };
}

/** The card's JSON as a V3 file. */
export function cardJson(card: CharacterCard): string {
  return JSON.stringify(toV3(card), null, 2);
}

/**
 * The card written into a PNG avatar: its V3 data in `ccv3` and V2 data in
 * `chara`, so V2-only frontends still read it. The avatar's own text chunks
 * go (NovelAI's generation metadata included) unless `keepMetadata` is set.
 */
export function cardPng(card: CharacterCard, avatarPng: Uint8Array, { keepMetadata = false } = {}): Uint8Array {
  if (!isPng(avatarPng)) throw new Error('The avatar has to be a PNG to write a card into it.');
  const v3 = toV3(card);
  return replaceTextChunks(
    avatarPng,
    [
      { keyword: 'chara', text: utf8ToBase64(JSON.stringify(toV2(v3))) },
      { keyword: 'ccv3', text: utf8ToBase64(JSON.stringify(v3)) },
    ],
    (_chunk, keyword) => keepMetadata && keyword !== 'chara' && keyword !== 'ccv3',
  );
}

/** A CHARX zip: card.json plus the avatar as its main icon. */
export async function cardCharx(card: CharacterCard, avatar?: { bytes: Uint8Array; ext: string }): Promise<Uint8Array> {
  const v3 = toV3(card);
  const zip = new JSZip();
  if (avatar) {
    const path = `assets/icon/images/main.${avatar.ext}`;
    const others = (v3.data.assets ?? []).filter((a) => !(a.type === 'icon' && a.name === 'main'));
    v3.data.assets = [{ type: 'icon', uri: `embeded://${path}`, name: 'main', ext: avatar.ext }, ...others];
    zip.file(path, avatar.bytes);
  }
  zip.file('card.json', JSON.stringify(v3, null, 2));
  return zip.generateAsync({ type: 'uint8array' });
}

/** A filesystem-safe version of the card's name for export filenames. */
export function cardFileName(card: CharacterCard, fallback = 'character'): string {
  return (card.data.name || fallback).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100) || fallback;
}
