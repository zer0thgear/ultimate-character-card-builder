import { backendGenerate, type BackendConnection } from '@/lib/server/imageBackends';
import { bytesResponse, handle, jsonBody } from '@/lib/server/http';
import type { BackendGenRequest } from '@/types/imageBackend';

const typeOf = (b: Uint8Array) => (b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x52 && b[1] === 0x49 ? 'image/webp' : 'image/png');

/** POST /api/image/generate: one gen on an A1111 or ComfyUI connection,
 *  answered with the picture. */
export async function POST(req: Request) {
  return handle(async () => {
    const { connection, request } = await jsonBody<{ connection: BackendConnection; request: BackendGenRequest }>(req);
    const [image] = await backendGenerate(connection, request);
    return bytesResponse(image, typeOf(image));
  });
}
