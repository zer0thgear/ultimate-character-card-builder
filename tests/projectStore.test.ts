import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '@/types/card';
import type { CardProject } from '@/types/project';
import { useProjectStore } from '@/store/projectStore';
import { json, routeFetch, routeLog } from './helpers/routes';

// The open card's store, saving through the real routes onto a temp data
// folder: what it writes, when, and what it does when a save fails.

const named = (name: string) => (d: CardData) => ({ ...d, name });
const store = () => useProjectStore.getState();

describe('project store', { timeout: 30_000 }, () => {
  let dir: string;
  const onDisk = (id: string) => JSON.parse(readFileSync(path.join(dir, 'projects', id, 'project.json'), 'utf8')) as CardProject;
  const puts = (id: string) => routeLog.filter((r) => r === `PUT /api/projects/${id}`).length;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-store-'));
    process.env.UCCB_DATA_DIR = dir;
    vi.stubGlobal('fetch', routeFetch);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    useProjectStore.setState({ summaries: [], project: null, status: 'saved', error: null, past: [], future: [] });
  });
  afterEach(async () => {
    await store().flush();
    vi.useRealTimers();
  });

  it('creates a card on disk and opens it', async () => {
    const p = await store().create({ notes: 'new' });
    expect(store().project?.id).toBe(p.id);
    expect(store().status).toBe('saved');
    expect(store().summaries.map((s) => s.id)).toEqual([p.id]);
    expect(onDisk(p.id).notes).toBe('new');
  });

  it('saves an edit once the edits stop for a moment', async () => {
    const { id } = await store().create();
    store().updateCard(named('Ari'), 'name');
    await vi.advanceTimersByTimeAsync(500);
    store().updateCard(named('Aria'), 'name');
    expect(store().status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(799);
    expect(puts(id)).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await store().flush();
    expect(puts(id)).toBe(1);
    expect(store().status).toBe('saved');
    expect(onDisk(id).card.data.name).toBe('Aria');
    expect(store().summaries.find((s) => s.id === id)?.name).toBe('Aria');
  });

  it('makes quick edits of one field one undo step, and saves undo and redo too', async () => {
    const { id } = await store().create();
    store().updateCard(named('A'), 'name');
    await vi.advanceTimersByTimeAsync(100);
    store().updateCard(named('Ab'), 'name');
    store().updateCard((d) => ({ ...d, description: 'x' }), 'description');
    await vi.advanceTimersByTimeAsync(2000);
    store().updateCard((d) => ({ ...d, description: 'xy' }), 'description');
    expect(store().past.map((c) => [c.data.name, c.data.description])).toEqual([
      ['', ''],
      ['Ab', ''],
      ['Ab', 'x'],
    ]);

    store().undo();
    store().undo();
    expect(store().project?.card.data).toMatchObject({ name: 'Ab', description: '' });
    await store().flush();
    expect(onDisk(id).card.data).toMatchObject({ name: 'Ab', description: '' });

    store().redo();
    await store().flush();
    expect(onDisk(id).card.data).toMatchObject({ name: 'Ab', description: 'x' });
    expect(store().future).toHaveLength(1);
  });

  it("makes a card's first edit its own undo step, however soon after editing another", async () => {
    await store().create();
    store().updateCard(named('A'), 'name');
    await store().create();
    store().updateCard(named('B'), 'name');
    expect(store().past.map((c) => c.data.name)).toEqual(['']);
  });

  it('does nothing for a change that changes nothing', async () => {
    const { id } = await store().create();
    store().updateCard((d) => d, 'name');
    expect(store().status).toBe('saved');
    expect(store().past).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(puts(id)).toBe(0);
  });

  it('keeps an edit made while a save is on its way, and saves it next', async () => {
    const { id } = await store().create();
    store().updateCard(named('First'), 'name');
    const saving = store().flush();
    store().updateCard((d) => ({ ...d, description: 'Second' }), 'description');
    await saving;
    expect(store().status).toBe('dirty');
    expect(onDisk(id).card.data).toMatchObject({ name: 'First', description: '' });
    await store().flush();
    expect(store().status).toBe('saved');
    expect(onDisk(id).card.data).toMatchObject({ name: 'First', description: 'Second' });
  });

  it('says so when a save fails', async () => {
    const { id } = await store().create();
    // Deleted in another tab: saving mustn't bring it back.
    await routeFetch(`/api/projects/${id}`, { method: 'DELETE' });
    store().updateCard(named('Lost'), 'name');
    await store().flush();
    expect(store().status).toBe('error');
    expect(store().error).toBe(`No project ${id}`);
  });

  it('saves the open card before opening another', async () => {
    const a = await store().create();
    const b = (await (await routeFetch('/api/projects', json('POST', {}))).json()) as CardProject;
    store().updateCard(named('Saved on the way out'), 'name');
    const from = routeLog.length;
    await store().open(b.id);
    expect(routeLog.slice(from)).toEqual([`PUT /api/projects/${a.id}`, `GET /api/projects/${b.id}`]);
    expect(onDisk(a.id).card.data.name).toBe('Saved on the way out');
    expect(store().project?.id).toBe(b.id);
    expect(store().past).toEqual([]);
  });

  it('says why a card would not open', async () => {
    await store().open('missing');
    expect(store().project).toBeNull();
    expect(store().error).toBe('No project missing');
  });

  it('replaces the whole card as one undo step', async () => {
    const { id } = await store().create();
    const card = structuredClone(store().project!.card);
    card.data.name = 'From a file';
    store().replaceCard(card);
    await store().flush();
    expect(onDisk(id).card.data.name).toBe('From a file');
    store().undo();
    expect(store().project?.card.data.name).toBe('');
  });

  it('saves notes, which are not part of undo', async () => {
    const { id } = await store().create();
    store().setNotes('remember the sword');
    await store().flush();
    expect(onDisk(id).notes).toBe('remember the sword');
    expect(store().past).toEqual([]);
  });

  it('drops a pending save when the open card is deleted', async () => {
    const { id } = await store().create();
    store().updateCard(named('Doomed'), 'name');
    await store().remove(id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(puts(id)).toBe(0);
    expect(store().project).toBeNull();
    expect(store().summaries).toEqual([]);
    expect((await routeFetch(`/api/projects/${id}`)).status).toBe(404);
  });

  it('keeps and unkeeps gens with the card', async () => {
    const { id } = await store().create();
    const kept = await store().keep(new Blob([new Uint8Array([1, 2])], { type: 'image/png' }), { id: 'g1', width: 832, height: 1216, createdAt: 1, label: 'smile' });
    expect(kept.file).toBe('g1.png');
    expect(store().project?.kept).toEqual([kept]);
    expect(onDisk(id).kept).toEqual([kept]);

    store().updateKept('g1.png', { label: 'grin' });
    expect(store().project?.kept[0].label).toBe('grin');
    // Sent at once, not with the card's next save.
    await vi.waitFor(() => expect(onDisk(id).kept[0].label).toBe('grin'));

    await store().unkeep('g1.png');
    expect(store().project?.kept).toEqual([]);
    expect(onDisk(id).kept).toEqual([]);
  });

  it("doesn't let a card save drop a gen kept meanwhile", async () => {
    const { id } = await store().create();
    store().updateCard(named('Edited'), 'name');
    await store().keep(new Blob([new Uint8Array([1])]), { id: 'g2', width: 1, height: 1, createdAt: 1 });
    await store().flush();
    expect(onDisk(id)).toMatchObject({ card: { data: { name: 'Edited' } }, kept: [{ file: 'g2.png' }] });
  });

  it('moves a Chat-mode card into Builder', async () => {
    const { id } = await store().create({ chatOnly: true });
    expect(store().summaries[0].chatOnly).toBe(true);
    await store().close();
    await store().addToBuilder(id);
    expect(onDisk(id).chatOnly).toBe(false);
    expect(store().summaries.find((s) => s.id === id)?.chatOnly).toBeUndefined();
  });

  it('only updates the chat counts in the lists when they change, or by a minute or more', async () => {
    const { id } = await store().create();
    store().setChatStats(id, { chats: 1, messages: 2, lastChat: 1_000_000 });
    const summaries = store().summaries;
    store().setChatStats(id, { chats: 1, messages: 2, lastChat: 1_030_000 });
    expect(store().summaries).toBe(summaries);
    store().setChatStats(id, { chats: 1, messages: 3, lastChat: 1_030_000 });
    expect(store().summaries[0]).toMatchObject({ chats: 1, messages: 3, lastChat: 1_030_000 });
  });
});
