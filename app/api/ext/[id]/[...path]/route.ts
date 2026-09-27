import { serverExtensions } from '@/lib/extensions/server';
import { handle } from '@/lib/server/http';
import { NotFoundError } from '@/lib/server/storage';

// /api/ext/<id>/<path…>: a local extension's own API (lib/extensions/types.ts).

type Ctx = { params: Promise<{ id: string; path: string[] }> };

async function route(req: Request, { params }: Ctx) {
  const { id, path } = await params;
  return handle(async () => {
    const ext = serverExtensions.get(id);
    if (!ext) throw new NotFoundError(`No extension "${id}".`);
    return ext.handle(req, path);
  });
}

export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
