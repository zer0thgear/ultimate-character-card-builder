import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BadRequestError, DATA_DIR, NotFoundError, writeFileAtomic } from '@/lib/server/storage';
import { bytesResponse, handle } from '@/lib/server/http';

// The picture behind the app (lib/appearance.ts, Look.background): one
// image, kept as it was given (so an animated one still moves).
//   data/background/image.<format>

const DIR = path.join(DATA_DIR, 'background');
const TYPES: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
const MAX_BYTES = 40 * 1024 * 1024;

async function current(): Promise<{ file: string; type: string } | null> {
  const files = await fs.readdir(DIR).catch(() => [] as string[]);
  const name = files.find((f) => f.startsWith('image.') && TYPES[f.slice(6)]);
  return name ? { file: path.join(DIR, name), type: TYPES[name.slice(6)] } : null;
}

export async function GET() {
  return handle(async () => {
    const found = await current();
    if (!found) throw new NotFoundError('No background picture');
    // Asked for with ?v=<version>, so it can be kept for good.
    return bytesResponse(await fs.readFile(found.file), found.type, 'max-age=31536000, immutable');
  });
}

/** Sets the background from an image (the request's body). */
export async function PUT(req: Request) {
  return handle(async () => {
    const bytes = Buffer.from(await req.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) throw new BadRequestError('A background is an image of up to 40 MB.');
    const meta = await sharp(bytes).metadata().catch(() => null);
    // heif is how sharp names AVIF.
    const format = meta?.format === 'heif' ? 'avif' : (meta?.format ?? '');
    if (!TYPES[format]) throw new BadRequestError("That isn't a picture UCCB can show (PNG, JPEG, WebP, GIF or AVIF).");
    await fs.rm(DIR, { recursive: true, force: true });
    await fs.mkdir(DIR, { recursive: true });
    await writeFileAtomic(path.join(DIR, `image.${format}`), bytes);
    return Response.json({ version: Date.now(), width: meta?.width ?? 0, height: meta?.height ?? 0 });
  });
}

export async function DELETE() {
  return handle(async () => {
    await fs.rm(DIR, { recursive: true, force: true });
    return Response.json({ ok: true });
  });
}
