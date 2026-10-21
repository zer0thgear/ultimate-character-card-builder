import { chubLorebook } from '@/lib/server/chub';
import { handle, jsonBody } from '@/lib/server/http';
import { BadRequestError } from '@/lib/server/storage';

/** POST /api/lorebooks/chub { path }: a lorebook from Chub, by its path
 *  ("lorebooks/creator/name"), for a card's linked lorebooks
 *  (lib/chubLore.ts). Only fetched, not saved: the bank does that. */
export async function POST(req: Request) {
  return handle(async () => {
    const { path } = await jsonBody<{ path?: string }>(req);
    if (typeof path !== 'string' || !path.trim()) throw new BadRequestError('Expected { path }.');
    return Response.json(await chubLorebook(path));
  });
}
