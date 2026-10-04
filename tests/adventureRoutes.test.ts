import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardProject } from '@/types/project';
import type { AdventureSession, AdventureSummary } from '@/types/adventure';
import { json, routeFetch } from './helpers/routes';

// Adventures save beside a card's chats, and the card keeps its world.

describe('adventure routes', { timeout: 30_000 }, () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-adventures-'));
    process.env.UCCB_DATA_DIR = dir;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const adventure = (id: string, turns: number): AdventureSession => ({
    id,
    name: `Run ${id}`,
    opening: { kind: 'greeting', greeting: 0 },
    entries: Array.from({ length: turns + 1 }, (_, t) => ({ id: `e${t}`, turn: t, kind: 'narration' as const, text: `turn ${t}`, createdAt: 1 })),
    dice: true,
    createdAt: 1,
    updatedAt: 1,
  });

  it('saves, lists, reads and deletes adventures', async () => {
    const p = (await (await routeFetch('/api/projects', json('POST', {}))).json()) as CardProject;
    const base = `/api/projects/${p.id}/adventures`;
    expect(await (await routeFetch(base)).json()).toEqual([]);
    const saved = (await (await routeFetch(`${base}/a1`, json('PUT', { ...adventure('ignored', 2) }))).json()) as AdventureSession;
    expect(saved.id).toBe('a1');
    await routeFetch(`${base}/a2`, json('PUT', adventure('a2', 0)));
    const list = (await (await routeFetch(base)).json()) as AdventureSummary[];
    expect(list.map((a) => [a.id, a.turns]).sort()).toEqual([
      ['a1', 2],
      ['a2', 0],
    ]);
    const read = (await (await routeFetch(`${base}/a1`)).json()) as AdventureSession;
    expect(read.entries).toHaveLength(3);
    await routeFetch(`${base}/a1`, { method: 'DELETE' });
    expect((await routeFetch(`${base}/a1`)).status).toBe(404);
    expect(existsSync(path.join(dir, 'projects', p.id, 'adventures', 'a2.json'))).toBe(true);
  });

  it('refuses an adventure without entries', async () => {
    const p = (await (await routeFetch('/api/projects', json('POST', {}))).json()) as CardProject;
    expect((await routeFetch(`/api/projects/${p.id}/adventures/x`, json('PUT', { id: 'x', name: 'bad' }))).status).toBe(400);
  });

  it("keeps the card's world with the project, and copies adventures with a card's chats", async () => {
    const p = (await (await routeFetch('/api/projects', json('POST', {}))).json()) as CardProject;
    const world = { settings: [{ id: 's', name: 'Fort', text: 'Stone.' }], personae: [], rules: 'HP 10' };
    await routeFetch(`/api/projects/${p.id}`, json('PUT', { ...p, adventure: world }));
    expect(((await (await routeFetch(`/api/projects/${p.id}`)).json()) as CardProject).adventure).toEqual(world);
    await routeFetch(`/api/projects/${p.id}/adventures/a1`, json('PUT', adventure('a1', 1)));
    const copy = (await (await routeFetch(`/api/projects/${p.id}/duplicate`, json('POST', { chats: true }))).json()) as CardProject;
    expect(copy.adventure).toEqual(world);
    expect(((await (await routeFetch(`/api/projects/${copy.id}/adventures`)).json()) as AdventureSummary[]).map((a) => a.id)).toEqual(['a1']);
  });
});
