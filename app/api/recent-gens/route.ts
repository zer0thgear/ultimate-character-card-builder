import { addRecentGen, BadRequestError, deleteRecentGens, listRecentGens, recentGenStats, type RecentGenMeta } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';

// Recent gens (see lib/server/storage.ts): GET lists them (and cleans up
// expired ones), POST adds one, DELETE removes several.

export async function GET(req: Request) {
  return handle(async () => {
    if (new URL(req.url).searchParams.has('stats')) return Response.json(await recentGenStats());
    return Response.json(await listRecentGens());
  });
}

/** A form with `image` (the PNG) and `meta` (its details, as JSON). */
export async function POST(req: Request) {
  return handle(async () => {
    const form = await req.formData().catch(() => null);
    const image = form?.get('image');
    const metaText = form?.get('meta');
    if (!(image instanceof Blob) || typeof metaText !== 'string') throw new BadRequestError('Expected an image and its meta.');
    let meta: RecentGenMeta;
    try {
      meta = JSON.parse(metaText);
    } catch {
      throw new BadRequestError('The meta is not JSON.');
    }
    await addRecentGen(meta, new Uint8Array(await image.arrayBuffer()));
    return Response.json({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const { ids } = await jsonBody<{ ids: string[] }>(req);
    if (!Array.isArray(ids)) throw new BadRequestError('Expected { ids }.');
    await deleteRecentGens(ids);
    return Response.json({ ok: true });
  });
}
