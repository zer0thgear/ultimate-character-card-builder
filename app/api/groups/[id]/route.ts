import { deleteGroup, getGroup, saveGroup } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { GroupProject } from '@/types/project';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await getGroup(id)));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await saveGroup({ ...(await jsonBody<GroupProject>(req)), id })));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    await deleteGroup(id);
    return Response.json({ ok: true });
  });
}
