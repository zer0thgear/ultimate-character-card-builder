import { duplicateProject } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string }> };

/** A copy of the project; `{ chats: true }` copies its chats too. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const body = await jsonBody<{ chats?: boolean }>(req).catch(() => ({}) as { chats?: boolean });
    return Response.json(await duplicateProject(id, { chats: body.chats === true }));
  });
}
