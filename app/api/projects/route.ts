import { createProject, listProjects } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { CardProject } from '@/types/project';

export async function GET() {
  return handle(async () => Response.json(await listProjects()));
}

/** Creates a project; the body may seed it (an imported card, say). */
export async function POST(req: Request) {
  return handle(async () => {
    const init = req.headers.get('content-length') === '0' ? {} : await jsonBody<Partial<CardProject>>(req).catch(() => ({}));
    return Response.json(await createProject(init));
  });
}
