import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { listPersonas, personaAvatarPath, updatePersonas, writeFileAtomic } from '@/lib/server/storage';
import { NotFoundError } from '@/lib/server/storage';
import { bytesResponse, handle } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => bytesResponse(await fs.readFile(personaAvatarPath(id)), 'image/png', 'max-age=31536000, immutable'));
}

/** Sets a persona's picture from any image, kept as a PNG no bigger than
 *  512px (it's only ever shown small). */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const list = await listPersonas();
    if (!list.some((p) => p.id === id)) throw new NotFoundError(`No persona ${id}`);
    const png = await sharp(Buffer.from(await req.arrayBuffer())).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const { width = 0, height = 0 } = await sharp(png).metadata();
    await writeFileAtomic(personaAvatarPath(id), png);
    const avatar = { width, height, version: Date.now() };
    await updatePersonas((cur) => cur.map((p) => (p.id === id ? { ...p, avatar } : p)));
    return Response.json(avatar);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    await fs.rm(personaAvatarPath(id), { force: true });
    await updatePersonas((cur) => cur.map((p) => (p.id === id ? { ...p, avatar: undefined } : p)));
    return Response.json({ ok: true });
  });
}
