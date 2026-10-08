import { readAppTags, saveAppTags } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';

// Your app tags (lib/appTags.ts), read and replaced whole (it's small).

export async function GET() {
  return handle(async () => Response.json(await readAppTags()));
}

export async function PUT(req: Request) {
  return handle(async () => Response.json(await saveAppTags(await jsonBody<unknown>(req))));
}
