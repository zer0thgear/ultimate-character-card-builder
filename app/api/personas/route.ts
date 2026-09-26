import { listPersonas, updatePersonas } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { Persona } from '@/types/project';

export async function GET() {
  return handle(async () => Response.json(await listPersonas()));
}

/** Replaces the whole list (it's small); avatars go through their own route. */
export async function PUT(req: Request) {
  return handle(async () => {
    const incoming = await jsonBody<Persona[]>(req);
    // The avatar on disk wins, as with card projects.
    return Response.json(
      await updatePersonas((current) => {
        const byId = new Map(current.map((p) => [p.id, p]));
        return incoming.map((p) => ({ ...p, avatar: byId.get(p.id)?.avatar }));
      }),
    );
  });
}
