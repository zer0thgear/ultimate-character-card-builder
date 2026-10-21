import { BadRequestError, updateProject } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string }> };

const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);

/** PUT { add?, remove? }: links bank lorebooks to a card that isn't open, or
 *  unlinks them (CardProject.lorebookIds; an open card's are set by its
 *  store). The rest of the card on disk stays as it is. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const body = await jsonBody<{ add?: unknown; remove?: unknown }>(req);
    const add = ids(body?.add);
    const remove = new Set(ids(body?.remove));
    if (!add.length && !remove.size) throw new BadRequestError('Expected { add } or { remove }.');
    const saved = await updateProject(id, (p) => {
      const lorebookIds = [...new Set([...(p.lorebookIds ?? []), ...add])].filter((x) => !remove.has(x));
      const next: typeof p = { ...p, lorebookIds };
      if (!lorebookIds.length) delete next.lorebookIds;
      return next;
    });
    return Response.json({ lorebookIds: saved.lorebookIds ?? [] });
  });
}
