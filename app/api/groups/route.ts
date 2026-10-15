import { listGroups, saveGroup } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { GroupProject } from '@/types/project';

// Group chats' groups (data/groups/<id>/group.json).

export async function GET() {
  return handle(async () => Response.json(await listGroups()));
}

export async function POST(req: Request) {
  return handle(async () => Response.json(await saveGroup(await jsonBody<GroupProject>(req))));
}
