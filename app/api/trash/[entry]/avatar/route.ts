import { promises as fs } from 'node:fs';
import { trashAvatarPath } from '@/lib/server/storage';
import { bytesResponse, handle } from '@/lib/server/http';

type Ctx = { params: Promise<{ entry: string }> };

/** A deleted card's picture, for the trash list. */
export async function GET(_req: Request, { params }: Ctx) {
  const { entry } = await params;
  return handle(async () => bytesResponse(await fs.readFile(trashAvatarPath(entry)), 'image/png'));
}
