import { backendOptions, type BackendConnection } from '@/lib/server/imageBackends';
import { handle, jsonBody } from '@/lib/server/http';

/** POST /api/image/options: the checkpoints, samplers and schedulers an
 *  A1111 or ComfyUI server offers (and Settings' Test connection). */
export async function POST(req: Request) {
  return handle(async () => Response.json(await backendOptions((await jsonBody<{ connection: BackendConnection }>(req)).connection)));
}
