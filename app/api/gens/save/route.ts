import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getConfig } from '@/lib/server/storage';
import { BadRequestError } from '@/lib/server/storage';
import { handle } from '@/lib/server/http';

const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);

/**
 * POST /api/gens/save — writes a gen (the body, a PNG) to the output
 * folder, or a subfolder of it named after the card (`x-card` header). An
 * existing file is never overwritten; a number is added instead.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const cfg = await getConfig();
    if (!cfg.outputDir) throw new BadRequestError('Set an output folder in Settings first.');
    const name = safe(decodeURIComponent(req.headers.get('x-filename') ?? '')) || `gen_${Date.now()}.png`;
    const card = safe(decodeURIComponent(req.headers.get('x-card') ?? ''));
    const dir = cfg.outputPerCard && card ? path.join(cfg.outputDir, card) : cfg.outputDir;
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(name) || '.png';
    const stem = name.slice(0, name.length - path.extname(name).length);
    const bytes = Buffer.from(await req.arrayBuffer());
    for (let n = 0; n < 1000; n++) {
      const file = path.join(dir, n ? `${stem} (${n})${ext}` : `${stem}${ext}`);
      try {
        await fs.writeFile(file, bytes, { flag: 'wx' });
        return Response.json({ path: file });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }
    throw new Error('Could not find a free file name.');
  });
}
