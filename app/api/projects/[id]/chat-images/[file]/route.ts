import { promises as fs } from 'node:fs';
import { chatImagePath, writeFileAtomic } from '@/lib/server/storage';
import { bytesResponse, handle } from '@/lib/server/http';

// Pictures drawn in chats (Chat mode's 🎨): the PNGs only; the chat keeps
// where each one goes and what it was drawn from.

type Ctx = { params: Promise<{ id: string; file: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, file } = await params;
  return handle(async () => bytesResponse(await fs.readFile(chatImagePath(id, file)), 'image/png', 'max-age=31536000, immutable'));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id, file } = await params;
  return handle(async () => {
    await writeFileAtomic(chatImagePath(id, file), Buffer.from(await req.arrayBuffer()));
    return Response.json({ file });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, file } = await params;
  return handle(async () => {
    await fs.rm(chatImagePath(id, file), { force: true });
    return Response.json({ ok: true });
  });
}
