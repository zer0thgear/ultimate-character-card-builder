import { deleteAdventure, getAdventure, saveAdventure } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { AdventureSession } from '@/types/adventure';

type Ctx = { params: Promise<{ id: string; adventureId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, adventureId } = await params;
  return handle(async () => Response.json(await getAdventure(id, adventureId)));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id, adventureId } = await params;
  return handle(async () => Response.json(await saveAdventure(id, { ...(await jsonBody<AdventureSession>(req)), id: adventureId })));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, adventureId } = await params;
  return handle(async () => {
    await deleteAdventure(id, adventureId);
    return Response.json({ ok: true });
  });
}
