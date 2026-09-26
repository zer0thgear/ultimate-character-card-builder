import { getProject, trashProject, updateProject } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { CardProject } from '@/types/project';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await getProject(id)));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const body = await jsonBody<CardProject>(req);
    // The avatar and kept gens are changed through their own routes, so the
    // copy on disk wins: a save from a tab that hasn't seen a new one yet
    // mustn't drop it.
    return Response.json(await updateProject(id, (current) => ({ ...body, id, avatar: current.avatar, kept: current.kept })));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    await trashProject(id);
    return Response.json({ ok: true });
  });
}
