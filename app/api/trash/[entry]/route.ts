import { deleteFromTrash, restoreFromTrash } from '@/lib/server/storage';
import { handle } from '@/lib/server/http';

type Ctx = { params: Promise<{ entry: string }> };

/** Puts a deleted card back. */
export async function POST(_req: Request, { params }: Ctx) {
  const { entry } = await params;
  return handle(async () => Response.json(await restoreFromTrash(entry)));
}

/** Deletes one card from the trash for good. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { entry } = await params;
  return handle(async () => {
    await deleteFromTrash(entry);
    return Response.json({ ok: true });
  });
}
