import { BadRequestError, getProject, updateProject } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import { normalizeLorebook } from '@/lib/cardSpec';
import type { Lorebook } from '@/types/card';

type Ctx = { params: Promise<{ id: string }> };

/** Sets a card's lorebook, and nothing else, for a card that isn't open:
 *  its copy in the Lorebooks bank changed and the two are synced
 *  (store/lorebookSync.ts). `syncByDefault` is the global setting; the
 *  card's own choice (lorebookSync) wins, and when it says no, nothing
 *  changes. The rest of the card on disk stays as it is. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const body = await jsonBody<{ book: Lorebook; syncByDefault?: boolean }>(req);
    const book = normalizeLorebook(body?.book);
    if (!book) throw new BadRequestError('Expected { book }.');
    const synced = (p: { lorebookSync?: boolean }) => p.lorebookSync ?? body.syncByDefault === true;
    // Not synced: nothing is written.
    if (!synced(await getProject(id))) return Response.json({ synced: false });
    const saved = await updateProject(id, (p) => (synced(p) ? { ...p, card: { ...p.card, data: { ...p.card.data, character_book: book } } } : p));
    return Response.json({ synced: true, updatedAt: saved.updatedAt });
  });
}
