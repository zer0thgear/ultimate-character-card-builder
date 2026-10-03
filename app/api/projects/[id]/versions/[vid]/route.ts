import { deleteVersion, getVersion, renameVersion } from '@/lib/server/versions';
import { handle, jsonBody } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string; vid: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, vid } = await params;
  return handle(async () => Response.json(await getVersion(id, vid)));
}

/** Names a version: `{ label }` ('' takes the name off). */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, vid } = await params;
  return handle(async () => Response.json(await renameVersion(id, vid, (await jsonBody<{ label?: string }>(req)).label ?? '')));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, vid } = await params;
  return handle(async () => {
    await deleteVersion(id, vid);
    return Response.json({ ok: true });
  });
}
