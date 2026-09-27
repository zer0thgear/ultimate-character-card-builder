import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recentPatch, toRecentMeta } from '@/lib/recentGens';

describe('toRecentMeta', () => {
  it('drops what only lives in the page, and embedded images', () => {
    const big = 'A'.repeat(50_000);
    const meta = toRecentMeta({
      id: 'g1',
      timestamp: 5,
      url: 'blob:x',
      blob: new Blob(['x']),
      sourceImageUrl: 'blob:y',
      stored: true,
      prompt: '1girl, smile',
      parameters: { width: 832, image: big, mask: big, reference_image_multiple: [big, big], v4_prompt: { caption: { base_caption: 'hi' } } },
    });
    expect(meta).toEqual({ id: 'g1', timestamp: 5, prompt: '1girl, smile', parameters: { width: 832, reference_image_multiple: [], v4_prompt: { caption: { base_caption: 'hi' } } } });
  });
});

describe('recentPatch', () => {
  it('keeps only what the server tracks, sending cleared fields as null', () => {
    expect(recentPatch({ savedPath: 'D:/x.png', selected: true })).toEqual({ savedPath: 'D:/x.png' });
    expect(recentPatch({ keptFile: undefined, pinned: false })).toEqual({ keptFile: null, pinned: false });
    expect(recentPatch({ url: 'blob:z' })).toBeNull();
  });
});

describe('recent gens on disk', () => {
  let dir: string;
  let storage: typeof import('@/lib/server/storage');
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-recent-'));
    process.env.UCCB_DATA_DIR = dir;
    storage = await import('@/lib/server/storage');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists newest first, patches, and deletes', async () => {
    const png = new Uint8Array([1, 2, 3]);
    await storage.addRecentGen({ id: 'a', timestamp: Date.now() - 1000, prompt: 'old' }, png);
    await storage.addRecentGen({ id: 'b', timestamp: Date.now(), prompt: 'new' }, png);
    expect((await storage.listRecentGens()).map((m) => m.id)).toEqual(['b', 'a']);
    await storage.patchRecentGen('a', { savedPath: 'D:/a.png', id: 'evil', timestamp: 0 });
    const a = (await storage.listRecentGens()).find((m) => m.id === 'a')!;
    expect(a.savedPath).toBe('D:/a.png');
    expect(a.timestamp).toBeGreaterThan(0); // id and timestamp can't be patched
    expect(await storage.recentGenStats()).toEqual({ count: 2, bytes: expect.any(Number) });
    await storage.deleteRecentGens(['a', 'b']);
    expect(await storage.listRecentGens()).toEqual([]);
  });

  it('cleans up gens past the configured days, or never with 0', async () => {
    const png = new Uint8Array([1]);
    await storage.setConfig({ recentGensDays: 3 });
    await storage.addRecentGen({ id: 'stale', timestamp: Date.now() - 4 * 86_400_000 }, png);
    await storage.addRecentGen({ id: 'fresh', timestamp: Date.now() - 2 * 86_400_000 }, png);
    expect((await storage.listRecentGens()).map((m) => m.id)).toEqual(['fresh']);
    expect(readdirSync(path.join(dir, 'recent-gens')).sort()).toEqual(['fresh.json', 'fresh.png']);

    await storage.setConfig({ recentGensDays: 0 });
    await storage.addRecentGen({ id: 'ancient', timestamp: 1 }, png);
    expect((await storage.listRecentGens()).map((m) => m.id)).toEqual(['fresh', 'ancient']);
  });

  it('refuses ids that could leave the folder', async () => {
    await expect(storage.addRecentGen({ id: '../x', timestamp: 1 }, new Uint8Array())).rejects.toThrow(/Bad id/);
  });
});
