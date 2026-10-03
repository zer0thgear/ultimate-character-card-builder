import { emptyTrash, listTrash } from '@/lib/server/storage';
import { handle } from '@/lib/server/http';

/** Deleted cards in data/trash, newest first. */
export async function GET() {
  return handle(async () => Response.json(await listTrash()));
}

/** Empties the trash for good. */
export async function DELETE() {
  return handle(async () => {
    await emptyTrash();
    return Response.json({ ok: true });
  });
}
