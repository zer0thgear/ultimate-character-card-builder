import { listGroupChats, saveGroupChat } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { ChatSession } from '@/types/project';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await listGroupChats(id)));
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await saveGroupChat(id, await jsonBody<ChatSession>(req))));
}
