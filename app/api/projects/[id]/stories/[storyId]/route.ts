import { deleteStory, getStory, saveStory } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { StorySession } from '@/types/project';

type Ctx = { params: Promise<{ id: string; storyId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, storyId } = await params;
  return handle(async () => Response.json(await getStory(id, storyId)));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id, storyId } = await params;
  return handle(async () => Response.json(await saveStory(id, { ...(await jsonBody<StorySession>(req)), id: storyId })));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, storyId } = await params;
  return handle(async () => {
    await deleteStory(id, storyId);
    return Response.json({ ok: true });
  });
}
