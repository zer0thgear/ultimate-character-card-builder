import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardProject, KeptImage } from '@/types/project';
import type { LibraryItem } from '@/lib/librarySearch';
import { json, routeFetch } from './helpers/routes';

// Gen-library images kept with a card: they land in its gallery, the same
// picture is never kept twice (from the library or the generator), and
// the library learns which of its images the card already has.

describe('library images in a card gallery', { timeout: 30_000 }, () => {
  let dir: string;
  let gens: string;
  let p: CardProject;
  let items: LibraryItem[];
  const png = (color: string) => sharp({ create: { width: 8, height: 12, channels: 4, background: color } }).png().toBuffer();
  const onDisk = () => JSON.parse(readFileSync(path.join(dir, 'projects', p.id, 'project.json'), 'utf8')) as CardProject;
  const gallery = () => readdirSync(path.join(dir, 'projects', p.id, 'gallery')).sort();
  const add = async (ids: string[]) => (await (await routeFetch(`/api/projects/${p.id}/library-gens`, json('POST', { ids }))).json()) as { added: KeptImage[]; already: number };
  const linked = async () => ((await (await routeFetch(`/api/projects/${p.id}/library-gens`)).json()) as { ids: string[] }).ids.sort();
  const byName = (name: string) => items.find((i) => i.name === name)!.id;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-libgal-'));
    gens = mkdtempSync(path.join(tmpdir(), 'uccb-gens-'));
    process.env.UCCB_DATA_DIR = dir;
    mkdirSync(path.join(gens, 'sub'));
    writeFileSync(path.join(gens, 'red.png'), await png('#f00'));
    // The same picture twice, in two folders.
    writeFileSync(path.join(gens, 'blue.png'), await png('#00f'));
    writeFileSync(path.join(gens, 'sub', 'blue copy.png'), await png('#00f'));
    writeFileSync(path.join(gens, 'green.jpg'), await sharp({ create: { width: 8, height: 12, channels: 3, background: '#0f0' } }).jpeg().toBuffer());
    await routeFetch('/api/config', json('PUT', { libraryFolders: [gens] }));
    p = (await (await routeFetch('/api/projects', json('POST', {}))).json()) as CardProject;
    for (let tries = 0; tries < 50; tries++) {
      const r = (await (await routeFetch('/api/library/images?limit=100&rescan=1')).json()) as { items: LibraryItem[]; scan: { scanning: boolean } };
      items = r.items;
      if (!r.scan.scanning && items.length === 4) break;
    }
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(gens, { recursive: true, force: true });
  });

  it('keeps a library image with the card, once', async () => {
    expect(items).toHaveLength(4);
    const first = await add([byName('red.png')]);
    expect(first.already).toBe(0);
    expect(first.added).toHaveLength(1);
    expect(first.added[0]).toMatchObject({ width: 8, height: 12, hash: expect.any(String), size: expect.any(Number) });
    expect(readFileSync(path.join(dir, 'projects', p.id, 'gallery', first.added[0].file)).equals(readFileSync(path.join(gens, 'red.png')))).toBe(true);
    expect(await add([byName('red.png')])).toEqual({ added: [], already: 1 });
    expect(onDisk().kept).toHaveLength(1);
  });

  it('treats the same picture in two folders as one, and converts a JPEG to PNG', async () => {
    const r = await add([byName('blue.png'), byName('blue copy.png'), byName('green.jpg')]);
    expect(r.added).toHaveLength(2);
    expect(r.already).toBe(1);
    expect(onDisk().kept).toHaveLength(3);
    for (const f of gallery()) expect([...readFileSync(path.join(dir, 'projects', p.id, 'gallery', f)).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // Every library copy of a kept picture is marked, the JPEG too.
    expect(await linked()).toEqual(items.map((i) => i.id).sort());
  });

  it("doesn't keep a gen from the generator that the card already has", async () => {
    const red = readFileSync(path.join(gens, 'red.png'));
    const meta = { id: 'session1', width: 8, height: 12, createdAt: 1 };
    const res = await routeFetch(`/api/projects/${p.id}/kept/session1.png`, { method: 'PUT', body: new Uint8Array(red), headers: { 'x-kept': encodeURIComponent(JSON.stringify(meta)) } });
    const kept = (await res.json()) as KeptImage;
    expect(kept.file).toMatch(/^lib-/);
    expect(gallery()).not.toContain('session1.png');
    expect(onDisk().kept).toHaveLength(3);
  });

  it('recognises gens kept before hashes existed, and forgets removed ones', async () => {
    // A gen kept by an older version: no hash on the entry.
    const yellow = await png('#ff0');
    writeFileSync(path.join(dir, 'projects', p.id, 'gallery', 'old.png'), yellow);
    const cur = onDisk();
    writeFileSync(path.join(dir, 'projects', p.id, 'project.json'), JSON.stringify({ ...cur, kept: [...cur.kept, { id: 'old', file: 'old.png', width: 8, height: 12, createdAt: 2 }] }));
    writeFileSync(path.join(gens, 'yellow.png'), yellow);
    for (let tries = 0; tries < 50; tries++) {
      const r = (await (await routeFetch('/api/library/images?limit=100&rescan=1')).json()) as { items: LibraryItem[]; scan: { scanning: boolean } };
      items = r.items;
      if (!r.scan.scanning && items.length === 5) break;
    }
    expect(await linked()).toContain(byName('yellow.png'));
    expect(await add([byName('yellow.png')])).toEqual({ added: [], already: 1 });

    const red = onDisk().kept.find((k) => k.size === readFileSync(path.join(gens, 'red.png')).length && k.file.startsWith('lib-'))!;
    await routeFetch(`/api/projects/${p.id}/kept/${red.file}`, { method: 'DELETE' });
    expect(await linked()).not.toContain(byName('red.png'));
  });

  it('turns away a body without a list of ids', async () => {
    expect((await routeFetch(`/api/projects/${p.id}/library-gens`, json('POST', { ids: 'x' }))).status).toBe(400);
  });
});
