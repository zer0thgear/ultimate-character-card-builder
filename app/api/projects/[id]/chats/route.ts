import { listChats, saveChat } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { ChatSession } from '@/types/project';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await listChats(id)));
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await saveChat(id, await jsonBody<ChatSession>(req))));
}
