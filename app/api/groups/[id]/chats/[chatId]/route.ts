import { deleteGroupChat, getGroupChat, saveGroupChat } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { ChatSession } from '@/types/project';

type Ctx = { params: Promise<{ id: string; chatId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, chatId } = await params;
  return handle(async () => Response.json(await getGroupChat(id, chatId)));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id, chatId } = await params;
  return handle(async () => Response.json(await saveGroupChat(id, { ...(await jsonBody<ChatSession>(req)), id: chatId })));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, chatId } = await params;
  return handle(async () => {
    await deleteGroupChat(id, chatId);
    return Response.json({ ok: true });
  });
}
