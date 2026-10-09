import { listBrainstorms } from '@/lib/server/storage';
import { handle } from '@/lib/server/http';

// A card's saved Brainstorm sessions.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await listBrainstorms(id)));
}
