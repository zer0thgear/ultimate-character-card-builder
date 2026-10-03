import { addVersion, listVersions } from '@/lib/server/versions';
import { getProject } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { CardVersion } from '@/types/project';

type Ctx = { params: Promise<{ id: string }> };

/** The card's earlier versions, newest first (without their cards). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await listVersions(id)));
}

/** Keeps a version: `{ card, reason, label? }`. Null when it wasn't kept
 *  (history off, or the same as the newest). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    await getProject(id);
    const body = await jsonBody<Pick<CardVersion, 'card' | 'reason' | 'label'>>(req);
    return Response.json(await addVersion(id, body));
  });
}
