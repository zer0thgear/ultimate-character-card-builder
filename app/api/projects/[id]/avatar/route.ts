import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { gunzipSync } from 'node:zlib';
import { readStealth } from '@/lib/genMetadata';
import { avatarPath, updateProject, writeFileAtomic } from '@/lib/server/storage';
import { bytesResponse, handle } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string }> };

/**
 * The avatar as stored, or prepared for export with `?max=` (longest edge,
 * px) and `?compress=lossless|palette`. Palette is pngquant-style: a 256
 * colour palette with dithering, usually a fraction of the size and hard
 * to tell apart for anime-style art. Either way the result has no text
 * chunks; the caller puts back any it wants. `?scrub=1` also erases the
 * copy of the generation metadata NovelAI hides in the alpha channel, which
 * survives removing the text chunks.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const original = await fs.readFile(avatarPath(id));
    const q = new URL(req.url).searchParams;
    const max = Math.max(0, Number(q.get('max')) || 0);
    const compress = q.get('compress');
    const scrub = q.get('scrub') === '1' && (await hasStealth(original));
    if (!max && !scrub && compress !== 'lossless' && compress !== 'palette') return bytesResponse(original, 'image/png');
    let img = scrub ? await scrubbed(original) : sharp(original);
    if (max) img = img.resize(max, max, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' });
    const out = await img
      .png(compress === 'palette' ? { palette: true, quality: 90, effort: 10, dither: 1, compressionLevel: 9 } : { compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
      .toBuffer();
    // Recompressing losslessly can come out bigger than a well-packed
    // original; then the original wins.
    return bytesResponse(!max && !scrub && compress === 'lossless' && out.length >= original.length ? original : out, 'image/png');
  });
}

async function hasStealth(png: Buffer): Promise<boolean> {
  try {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return (await readStealth({ width: info.width, height: info.height, data }, async (b) => gunzipSync(b))) !== null;
  } catch {
    return false;
  }
}

/** The picture without its hidden metadata: an opaque picture loses its
 *  alpha channel altogether; otherwise near-opaque and near-clear alpha
 *  (where the bits hide) is snapped to fully opaque and fully clear, as
 *  NovelAI's own canvas does. */
async function scrubbed(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 254) opaque = false;
    if (data[i] === 254) data[i] = 255;
    else if (data[i] === 1) data[i] = 0;
  }
  const img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  return opaque ? img.removeAlpha() : img;
}

/** Sets the avatar from any image the browser sends; it's stored as PNG,
 *  since that's what a card gets written into. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const input = Buffer.from(await req.arrayBuffer());
    const isPng = input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const png = isPng ? input : await sharp(input).png().toBuffer();
    const { width = 0, height = 0 } = await sharp(png).metadata();
    await writeFileAtomic(avatarPath(id), png);
    const saved = await updateProject(id, (p) => ({ ...p, avatar: { width, height, version: Date.now() } }));
    return Response.json(saved.avatar);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    await fs.rm(avatarPath(id), { force: true });
    await updateProject(id, (p) => ({ ...p, avatar: undefined }));
    return Response.json({ ok: true });
  });
}
