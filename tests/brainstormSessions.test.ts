import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cardContext } from '@/lib/assist';
import { newCard, newEntry, newLorebook } from '@/lib/cardSpec';

vi.mock('@/lib/api', () => ({ api: {} }));
import { sessionName } from '@/store/brainstormStore';

// Brainstorm sessions kept with the card, and a Brainstorm that leaves the
// lorebook out (its entries attached one by one instead).

describe('brainstorm sessions on the server', { timeout: 30_000 }, () => {
  let dir: string;
  let storage: typeof import('@/lib/server/storage');
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-brainstorm-'));
    process.env.UCCB_DATA_DIR = dir;
    storage = await import('@/lib/server/storage');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('saves, lists newest first, reads back and deletes', async () => {
    const p = await storage.createProject();
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    await storage.saveBrainstorm(p.id, { id: a, name: 'Names', messages: [{ role: 'user', content: 'Ideas?' }, { role: 'assistant', content: 'Three.' }], createdAt: 1, updatedAt: 1 });
    await new Promise((r) => setTimeout(r, 5));
    await storage.saveBrainstorm(p.id, { id: b, name: '', messages: [], createdAt: 2, updatedAt: 2 });
    const list = await storage.listBrainstorms(p.id);
    expect(list.map((s) => [s.id, s.name, s.messageCount])).toEqual([
      [b, 'Brainstorm', 0],
      [a, 'Names', 2],
    ]);
    expect((await storage.getBrainstorm(p.id, a)).messages[1].content).toBe('Three.');
    await storage.deleteBrainstorm(p.id, a);
    expect((await storage.listBrainstorms(p.id)).map((s) => s.id)).toEqual([b]);
    await expect(storage.getBrainstorm(p.id, a)).rejects.toThrow();
  });
});

describe('a new session', () => {
  it('is named after its first message, shortened', () => {
    expect(sessionName([{ role: 'user', content: '  What   would she wear\nto a funeral?' }], 0)).toBe('What would she wear to a funeral?');
    expect(sessionName([{ role: 'user', content: 'x'.repeat(80) }], 0)).toMatch(/^x{47}…$/);
    expect(sessionName([], 0)).toMatch(/^Brainstorm /);
  });
});

describe('the lorebook in Brainstorm', () => {
  it('can be left out of the card context', () => {
    const card = newCard().data;
    card.name = 'Ann';
    card.description = 'A knight.';
    const entry = { ...newEntry(), keys: ['sword'], content: 'The sword is cursed.' };
    card.character_book = { ...newLorebook(), entries: [entry] };
    expect(cardContext(card)).toContain('The sword is cursed.');
    expect(cardContext(card, undefined, 12000, { lorebook: false })).not.toContain('The sword is cursed.');
    expect(cardContext(card, undefined, 12000, { lorebook: false })).toContain('A knight.');
  });
});
