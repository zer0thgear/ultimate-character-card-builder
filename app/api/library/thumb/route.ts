import { thumbnail } from '@/lib/server/library';
import { bytesResponse, handle } from '@/lib/server/http';

/** GET /api/library/thumb?id= */
export async function GET(req: Request) {
  return handle(async () => bytesResponse(await thumbnail(new URL(req.url).searchParams.get('id') ?? ''), 'image/webp', 'max-age=86400'));
}
