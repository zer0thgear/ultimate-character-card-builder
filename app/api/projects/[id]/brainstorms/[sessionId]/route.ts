import { deleteBrainstorm, getBrainstorm, saveBrainstorm } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { BrainstormSession } from '@/types/project';

type Ctx = { params: Promise<{ id: string; sessionId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, sessionId } = await params;
  return handle(async () => Response.json(await getBrainstorm(id, sessionId)));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id, sessionId } = await params;
  return handle(async () => Response.json(await saveBrainstorm(id, { ...(await jsonBody<BrainstormSession>(req)), id: sessionId })));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, sessionId } = await params;
  return handle(async () => {
    await deleteBrainstorm(id, sessionId);
    return Response.json({ ok: true });
  });
}
