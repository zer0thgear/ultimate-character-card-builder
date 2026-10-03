import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '@/types/project';
import { json, routeFetch } from './helpers/routes';

// The other routes that save into data/: personas, shared settings, the
// server config, and gens saved to the output folder.

describe('data routes', { timeout: 30_000 }, () => {
  let dir: string;
  let out: string;
  const read = (...p: string[]) => JSON.parse(readFileSync(path.join(dir, ...p), 'utf8'));

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-data-'));
    out = mkdtempSync(path.join(tmpdir(), 'uccb-out-'));
    process.env.UCCB_DATA_DIR = dir;
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  describe('/api/personas', () => {
    it('replaces the list, dropping bad ids and anything that is not a persona field', async () => {
      const res = await routeFetch(
        '/api/personas',
        json('PUT', [
          { id: 'p1', name: 'Sam', description: 'tall', extra: 'x' },
          { id: '../x', name: 'Bad' },
          { id: 'p2', name: 'Kai' },
        ]),
      );
      const saved = [
        { id: 'p1', name: 'Sam', description: 'tall' },
        { id: 'p2', name: 'Kai', description: '' },
      ];
      expect(await res.json()).toEqual(saved);
      expect(read('personas', 'personas.json')).toEqual(saved);
      expect(await (await routeFetch('/api/personas')).json()).toEqual(saved);
    });

    it('keeps the avatar on disk over the one in the list', async () => {
      await routeFetch('/api/personas', json('PUT', [{ id: 'p1', name: 'Sam', description: '' }]));
      const png = await sharp({ create: { width: 900, height: 600, channels: 4, background: '#36c' } }).png().toBuffer();
      const avatar = await (await routeFetch('/api/personas/p1/avatar', { method: 'PUT', body: new Uint8Array(png) })).json();
      // It's kept no bigger than 512px.
      expect(avatar).toMatchObject({ width: 512, height: 341 });
      // A tab that hasn't seen the new picture saves the list.
      await routeFetch('/api/personas', json('PUT', [{ id: 'p1', name: 'Sam (renamed)', description: '' }]));
      expect(read('personas', 'personas.json')).toEqual([{ id: 'p1', name: 'Sam (renamed)', description: '', avatar }]);

      await routeFetch('/api/personas/p1/avatar', { method: 'DELETE' });
      expect(existsSync(path.join(dir, 'personas', 'p1.png'))).toBe(false);
      expect(read('personas', 'personas.json')[0].avatar).toBeUndefined();
    });

    it('gives no picture to a persona that is not saved', async () => {
      await routeFetch('/api/personas', json('PUT', []));
      const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#000' } }).png().toBuffer();
      expect((await routeFetch('/api/personas/ghost/avatar', { method: 'PUT', body: new Uint8Array(png) })).status).toBe(404);
      expect(existsSync(path.join(dir, 'personas', 'ghost.png'))).toBe(false);
    });
  });

  describe('/api/settings', () => {
    it('saves each section on its own, and hands them all back together', async () => {
      // Sent at once (two stores saving together), neither is lost.
      await Promise.all([routeFetch('/api/settings/gen', json('PUT', { steps: 28 })), routeFetch('/api/settings/llm', json('PUT', { connections: [] }))]);
      await routeFetch('/api/settings/naiKey', json('PUT', 'pst-abc'));
      const all = { gen: { steps: 28 }, llm: { connections: [] }, naiKey: 'pst-abc' };
      expect(read('settings.json')).toEqual(all);
      expect(await (await routeFetch('/api/settings')).json()).toEqual(all);
    });

    it('refuses a section it does not know', async () => {
      const res = await routeFetch('/api/settings/ui', json('PUT', { x: 1 }));
      expect(res.status).toBe(400);
      expect(read('settings.json')).not.toHaveProperty('ui');
    });
  });

  describe('/api/config', () => {
    it('merges a change into the config, tidying folders and days', async () => {
      const res = await routeFetch('/api/config', json('PUT', { libraryFolders: [' D:/gens ', '', 'D:/gens', 'E:/more'], recentGensDays: '2.6' }));
      const cfg = (await res.json()) as AppConfig;
      expect(cfg.libraryFolders).toEqual(['D:/gens', 'E:/more']);
      expect(cfg.recentGensDays).toBe(3);
      await routeFetch('/api/config', json('PUT', { autoSaveGens: true }));
      expect(read('config.json')).toMatchObject({ libraryFolders: ['D:/gens', 'E:/more'], recentGensDays: 3, autoSaveGens: true });
    });
  });

  describe('/api/gens/save', () => {
    const save = (headers: Record<string, string>, body = new Uint8Array([1, 2, 3])) =>
      routeFetch('/api/gens/save', { method: 'POST', body, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, encodeURIComponent(v)])) });

    it('needs an output folder first', async () => {
      await routeFetch('/api/config', json('PUT', { outputDir: '' }));
      const res = await save({ 'x-filename': 'a.png' });
      expect(res.status).toBe(400);
    });

    it("saves into the card's folder, never over an existing file", async () => {
      await routeFetch('/api/config', json('PUT', { outputDir: out, outputPerCard: true }));
      const first = await (await save({ 'x-filename': 'gen.png', 'x-card': 'Aria: Knight?' })).json();
      const second = await (await save({ 'x-filename': 'gen.png', 'x-card': 'Aria: Knight?' })).json();
      const folder = path.join(out, 'Aria_ Knight_');
      expect(first.path).toBe(path.join(folder, 'gen.png'));
      expect(second.path).toBe(path.join(folder, 'gen (1).png'));
      expect(readdirSync(folder).sort()).toEqual(['gen (1).png', 'gen.png']);
      expect([...readFileSync(first.path)]).toEqual([1, 2, 3]);
    });

    it('keeps names that would climb out inside the output folder', async () => {
      await routeFetch('/api/config', json('PUT', { outputDir: out, outputPerCard: true }));
      const { path: saved } = await (await save({ 'x-filename': '../../escape.png', 'x-card': '../..' })).json();
      expect(path.relative(out, saved).startsWith('..')).toBe(false);
    });

    it('treats a backslash as a separator too (it is one on Windows)', async () => {
      await routeFetch('/api/config', json('PUT', { outputDir: out, outputPerCard: true }));
      const { path: saved } = await (await save({ 'x-filename': '..\\..\\escape.png', 'x-card': '..\\up' })).json();
      expect(path.relative(out, saved)).toBe(path.join('_up', '_.._escape.png'));
    });

    it('names a gen sent without a name', async () => {
      await routeFetch('/api/config', json('PUT', { outputDir: out, outputPerCard: false }));
      const { path: saved } = await (await save({})).json();
      expect(path.dirname(saved)).toBe(out);
      expect(path.basename(saved)).toMatch(/^gen_\d+\.png$/);
    });
  });
});
