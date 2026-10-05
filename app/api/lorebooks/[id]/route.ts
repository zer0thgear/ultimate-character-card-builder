import { BadRequestError, deleteLorebook, getLorebook, saveLorebook } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { BankLorebook } from '@/types/project';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => Response.json(await getLorebook((await params).id)));
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const b = await jsonBody<BankLorebook>(req);
    if (b?.id !== id) throw new BadRequestError("The lorebook's id doesn't match the address.");
    return Response.json(await saveLorebook(b));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await deleteLorebook((await params).id);
    return Response.json({ ok: true });
  });
}
