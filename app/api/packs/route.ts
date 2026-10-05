import { listPacks, savePack } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { InstalledPack } from '@/lib/extensionPack';

// Extension packs (lib/extensionPack.ts): every installed one, and
// installing one (or updating the one with its id).

export async function GET() {
  return handle(async () => Response.json(await listPacks()));
}

export async function POST(req: Request) {
  return handle(async () => Response.json(await savePack(await jsonBody<InstalledPack>(req))));
}
