import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Chat mode's storage: cards imported there are marked chat-only (Builder
// leaves them out), and pictures drawn in a chat go with it.

describe('chat mode storage', { timeout: 30_000 }, () => {
  let dir: string;
  let storage: typeof import('@/lib/server/storage');
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-chatmode-'));
    process.env.UCCB_DATA_DIR = dir;
    storage = await import('@/lib/server/storage');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists which cards are chat-only, until one is added to Builder', async () => {
    const mine = await storage.createProject();
    const imported = await storage.createProject({ chatOnly: true });
    const byId = async () => new Map((await storage.listProjects()).map((s) => [s.id, s]));
    expect((await byId()).get(mine.id)?.chatOnly).toBeUndefined();
    expect((await byId()).get(imported.id)?.chatOnly).toBe(true);
    await storage.saveProject({ ...(await storage.getProject(imported.id)), chatOnly: false });
    expect((await byId()).get(imported.id)?.chatOnly).toBeUndefined();
  });

  it("deletes a chat's pictures with it, and no other chat's", async () => {
    const p = await storage.createProject();
    const chat = (id: string) => ({ id, name: id, greeting: 0, messages: [], createdAt: 0, updatedAt: 0 });
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    await storage.saveChat(p.id, chat(a));
    await storage.saveChat(p.id, chat(b));
    const pic = (name: string) => {
      const file = storage.chatImagePath(p.id, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'png');
      return file;
    };
    const mineA = pic(`${a}-x.png`);
    const mineB = pic(`${b}-y.png`);
    await storage.deleteChat(p.id, a);
    expect(existsSync(mineA)).toBe(false);
    expect(existsSync(mineB)).toBe(true);
  });

  it('refuses picture names that could leave the folder', () => {
    expect(() => storage.chatImagePath('33333333-3333-4333-8333-333333333333', '../project.json')).toThrow();
    expect(() => storage.chatImagePath('33333333-3333-4333-8333-333333333333', 'a/b.png')).toThrow();
  });
});
