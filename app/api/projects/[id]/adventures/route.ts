import { listAdventures } from '@/lib/server/storage';
import { handle } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await listAdventures(id)));
}
