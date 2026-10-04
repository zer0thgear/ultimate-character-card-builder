import { listStories, saveStory } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { StorySession } from '@/types/project';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await listStories(id)));
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => Response.json(await saveStory(id, await jsonBody<StorySession>(req))));
}
