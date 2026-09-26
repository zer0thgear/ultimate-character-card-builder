import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveItem } from '@/lib/server/library';
import { bytesResponse, handle } from '@/lib/server/http';

const TYPES: Record<string, string> = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/** GET /api/library/file?id= — the original file, metadata and all. */
export async function GET(req: Request) {
  return handle(async () => {
    const abs = await resolveItem(new URL(req.url).searchParams.get('id') ?? '');
    return bytesResponse(await fs.readFile(abs), TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream', 'max-age=3600');
  });
}
