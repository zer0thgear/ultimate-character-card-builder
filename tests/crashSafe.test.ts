import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A crash mid-save used to leave settings.json and a card's project.json
// full of zeros. Saves now flush before the rename and keep the previous
// version as .bak, which reading falls back to.

describe('crash-safe saving', { timeout: 30_000 }, () => {
  let dir: string;
  let storage: typeof import('@/lib/server/storage');
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-crash-'));
    process.env.UCCB_DATA_DIR = dir;
    storage = await import('@/lib/server/storage');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const zeroOut = (file: string) => writeFileSync(file, Buffer.alloc(readFileSync(file).length));

  it('keeps the previous version, and reads it when the file is damaged', async () => {
    await storage.setSettingsSection('naiKey', 'first');
    await storage.setSettingsSection('naiKey', 'second');
    const file = path.join(dir, 'settings.json');
    expect(JSON.parse(readFileSync(storage.backupOf(file), 'utf8'))).toEqual({ naiKey: 'first' });
    zeroOut(file);
    expect(await storage.getSettings()).toEqual({ naiKey: 'first' });
    // The next save writes a good file again, and doesn't copy the damage into the backup.
    await storage.setSettingsSection('naiKey', 'third');
    expect(await storage.getSettings()).toEqual({ naiKey: 'third' });
    expect(JSON.parse(readFileSync(storage.backupOf(file), 'utf8'))).toEqual({ naiKey: 'first' });
  });

  it('says so when a file is damaged with no backup, and a tab holding the card can save it back', async () => {
    const p = await storage.createProject();
    const file = path.join(dir, 'projects', p.id, 'project.json');
    rmSync(storage.backupOf(file), { force: true });
    zeroOut(file);
    await expect(storage.getProject(p.id)).rejects.toBeInstanceOf(storage.DamagedFileError);
    expect((await storage.listProjects()).some((s) => s.id === p.id)).toBe(false);
    const held = { ...p, card: { ...p.card, data: { ...p.card.data, name: 'New Eridu' } } };
    await storage.updateProject(p.id, (cur) => ({ ...held, avatar: cur.avatar }), held);
    expect((await storage.getProject(p.id)).card.data.name).toBe('New Eridu');
  });

  it('leaves no temp files behind', () => {
    const left = (d: string): string[] => (existsSync(d) ? readdirSync(d, { recursive: true }).map(String).filter((f) => f.endsWith('.tmp')) : []);
    expect(left(dir)).toEqual([]);
  });
});
