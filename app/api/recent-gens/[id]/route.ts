import { promises as fs } from 'node:fs';
import { patchRecentGen, recentGenPath } from '@/lib/server/storage';
import { bytesResponse, handle, jsonBody } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string }> };

/** The PNG. A gen never changes once made, so it can be cached for good. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => bytesResponse(await fs.readFile(recentGenPath(id)), 'image/png', 'max-age=31536000, immutable'));
}

/** Updates its details (saved, kept…). */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await patchRecentGen(id, await jsonBody<Record<string, unknown>>(req))));
}
