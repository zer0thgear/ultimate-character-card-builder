import { getPackData, savePackData } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';

// An extension's own data (uccb.storage in its code), kept until it's uninstalled.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => Response.json(await getPackData((await params).id)));
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => Response.json(await savePackData((await params).id, await jsonBody(req))));
}
