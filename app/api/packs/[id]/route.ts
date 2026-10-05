import { BadRequestError, deletePack, savePack } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { InstalledPack } from '@/lib/extensionPack';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const p = await jsonBody<InstalledPack>(req);
    if (p?.pack?.id !== id) throw new BadRequestError("The pack's id doesn't match the address.");
    return Response.json(await savePack(p));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await deletePack((await params).id);
    return Response.json({ ok: true });
  });
}
