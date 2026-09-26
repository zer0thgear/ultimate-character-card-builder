import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { avatarPath, updateProject, writeFileAtomic } from '@/lib/server/storage';
import { bytesResponse, handle } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => bytesResponse(await fs.readFile(avatarPath(id)), 'image/png'));
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
