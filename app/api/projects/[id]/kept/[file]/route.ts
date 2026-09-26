import { promises as fs } from 'node:fs';
import { galleryPath, updateProject, writeFileAtomic } from '@/lib/server/storage';
import { BadRequestError } from '@/lib/server/storage';
import { bytesResponse, handle } from '@/lib/server/http';
import type { KeptImage } from '@/types/project';

type Ctx = { params: Promise<{ id: string; file: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, file } = await params;
  return handle(async () => bytesResponse(await fs.readFile(galleryPath(id, file)), 'image/png', 'max-age=31536000, immutable'));
}

/** Keeps a gen with the project: the PNG in the body, its details in the
 *  `x-kept` header (JSON). */
export async function PUT(req: Request, { params }: Ctx) {
  const { id, file } = await params;
  return handle(async () => {
    let meta: KeptImage;
    try {
      meta = JSON.parse(decodeURIComponent(req.headers.get('x-kept') ?? ''));
    } catch {
      throw new BadRequestError('Missing x-kept header.');
    }
    await writeFileAtomic(galleryPath(id, file), Buffer.from(await req.arrayBuffer()));
    const entry: KeptImage = { ...meta, file };
    await updateProject(id, (p) => ({ ...p, kept: [...p.kept.filter((k) => k.file !== file), entry] }));
    return Response.json(entry);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, file } = await params;
  return handle(async () => {
    await fs.rm(galleryPath(id, file), { force: true });
    await updateProject(id, (p) => ({ ...p, kept: p.kept.filter((k) => k.file !== file) }));
    return Response.json({ ok: true });
  });
}

/** Changes a kept gen's details (its label, say) without re-sending it. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, file } = await params;
  return handle(async () => {
    const patch = (await req.json()) as Partial<KeptImage>;
    const saved = await updateProject(id, (p) => ({
      ...p,
      kept: p.kept.map((k) => (k.file === file ? { ...k, ...patch, file, id: k.id } : k)),
    }));
    return Response.json(saved.kept.find((k) => k.file === file) ?? null);
  });
}
