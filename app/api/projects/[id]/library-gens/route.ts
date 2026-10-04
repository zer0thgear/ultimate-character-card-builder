import { keepFromLibrary, libraryIdsInGallery } from '@/lib/server/keptGens';
import { BadRequestError } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string }> };

/** GET: which library images are kept with this card (their library ids). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json({ ids: await libraryIdsInGallery(id) }));
}

/** POST { ids }: keeps these library images with the card, skipping any
 *  picture it already has. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const { ids } = await jsonBody<{ ids: unknown }>(req);
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new BadRequestError('ids must be a list of library image ids.');
    return Response.json(await keepFromLibrary(id, ids));
  });
}
