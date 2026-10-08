import { projectStats } from '@/lib/server/storage';
import { handle } from '@/lib/server/http';

// 📊 A card's numbers across its chats.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await projectStats(id)));
}
