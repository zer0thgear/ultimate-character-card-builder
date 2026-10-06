import { serverExtensions } from '@/lib/extensions/server';
import { chubCharacterId, chubLinkCharacter, type chubCharacter } from '@/lib/server/chub';
import { handle, jsonBody } from '@/lib/server/http';
import { BadRequestError } from '@/lib/server/storage';

// Import from URL: a character card from a link, as SillyTavern's does.
// Only sites UCCB knows (Chub, its Cardbox mirror, and any a local
// extension adds) are fetched;
// the server doesn't follow arbitrary links.

export async function POST(req: Request) {
  return handle(async () => {
    const { url: link } = await jsonBody<{ url?: string }>(req);
    const text = (link ?? '').trim();
    if (!text) throw new BadRequestError('Paste a link to a character.');
    let url: URL | null = null;
    try {
      url = new URL(text);
    } catch {
      /* a bare Chub path (creator/name) */
    }
    if (url && url.protocol !== 'https:' && url.protocol !== 'http:') throw new BadRequestError("That isn't a web link.");
    // Where it came from, for the card's source (V3): the link as given
    // (less any #fragment), or Chub's for a bare creator/name.
    const from = (id?: string) => (url ? url.href.replace(/#.*$/, '') : `https://chub.ai/characters/${id}`);
    // Local extensions' sites first.
    if (url) {
      for (const ext of serverExtensions.values()) {
        const found = await ext.importUrl?.(url);
        if (found) return reply(found, from());
      }
    }
    // Chub, or a mirror of it (Cardbox, fetched through the mirror).
    const chub = await chubLinkCharacter(text);
    if (chub) return reply(chub, from(chubCharacterId(text) ?? undefined));
    throw new BadRequestError('UCCB can import Chub and Cardbox character links (…/characters/creator/name) for now; that isn’t one.');
  });
}

function reply(found: Awaited<ReturnType<typeof chubCharacter>>, sourceUrl: string) {
  return Response.json({
    card: found.card,
    source: found.source,
    sourceUrl,
    ...(found.avatar ? { avatar: Buffer.from(found.avatar.bytes).toString('base64'), avatarType: found.avatar.type } : {}),
  });
}
