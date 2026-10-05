import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardProject, ChatSession, KeptImage } from '@/types/project';
import { json, routeFetch } from './helpers/routes';

// The routes that save a card and what goes with it (avatar, kept gens,
// chats) into data/projects/, against a temp data folder.

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Real disk writes, each flushed (crash-safe), can be slow in the temp folder.
describe('card project routes', { timeout: 30_000 }, () => {
  let dir: string;
  const projectFile = (id: string) => path.join(dir, 'projects', id, 'project.json');
  const onDisk = (id: string) => JSON.parse(readFileSync(projectFile(id), 'utf8')) as CardProject;
  const create = async (init: Partial<CardProject> = {}) => (await (await routeFetch('/api/projects', json('POST', init))).json()) as CardProject;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-routes-'));
    process.env.UCCB_DATA_DIR = dir;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  describe('/api/projects/:id/lorebook', () => {
    const book = { name: 'Synced', extensions: {}, entries: [{ keys: ['k'], content: 'From the bank.', extensions: {}, enabled: true, insertion_order: 100, use_regex: false }] };
    const sync = (id: string, syncByDefault: boolean) => routeFetch(`/api/projects/${id}/lorebook`, json('PUT', { book, syncByDefault }));

    it("sets a synced card's lorebook and leaves the rest of the card alone", async () => {
      const p = await create({ notes: 'keep me' });
      const res = await (await sync(p.id, true)).json();
      expect(res.synced).toBe(true);
      expect(onDisk(p.id).card.data.character_book?.entries[0].content).toBe('From the bank.');
      expect(onDisk(p.id).notes).toBe('keep me');
    });

    it("follows the card's own choice over the global one, and writes nothing when not synced", async () => {
      const off = await create({ lorebookSync: false });
      expect((await (await sync(off.id, true)).json()).synced).toBe(false);
      expect(onDisk(off.id).card.data.character_book).toBeUndefined();
      expect(onDisk(off.id).updatedAt).toBe(off.updatedAt);
      const on = await create({ lorebookSync: true });
      expect((await (await sync(on.id, false)).json()).synced).toBe(true);
      const plain = await create();
      expect((await (await sync(plain.id, false)).json()).synced).toBe(false);
    });

    it('refuses a body without a book', async () => {
      const p = await create();
      expect((await routeFetch(`/api/projects/${p.id}/lorebook`, json('PUT', {}))).status).toBe(400);
    });
  });

  describe('/api/projects', () => {
    it('creates a project on disk, seeded from the body, with an id of its own', async () => {
      const seed = await create({ id: 'mine', notes: 'from an import' });
      expect(seed.id).not.toBe('mine');
      expect(seed.notes).toBe('from an import');
      expect(seed.card.spec).toBeTruthy();
      expect(onDisk(seed.id)).toEqual(seed);
    });

    it('creates a blank project from an empty body', async () => {
      const res = await routeFetch('/api/projects', { method: 'POST', headers: { 'content-length': '0' } });
      expect(res.status).toBe(200);
      const p = (await res.json()) as CardProject;
      expect(p.kept).toEqual([]);
      expect(existsSync(projectFile(p.id))).toBe(true);
    });

    it('lists projects, last saved first', async () => {
      const a = await create();
      const b = await create();
      await new Promise((r) => setTimeout(r, 5));
      await routeFetch(`/api/projects/${a.id}`, json('PUT', { ...a, card: { ...a.card, data: { ...a.card.data, name: 'Edited' } } }));
      const list = (await (await routeFetch('/api/projects')).json()) as { id: string; name: string }[];
      const ids = list.map((s) => s.id);
      expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
      expect(list.find((s) => s.id === a.id)?.name).toBe('Edited');
    });
  });

  describe('/api/projects/:id', () => {
    it('saves the card, and reads back what was saved', async () => {
      const p = await create();
      const edited = { ...p, card: { ...p.card, data: { ...p.card.data, name: 'Aria', description: 'A knight.' } }, notes: 'n' };
      const res = await routeFetch(`/api/projects/${p.id}`, json('PUT', edited));
      expect(res.status).toBe(200);
      const saved = (await res.json()) as CardProject;
      expect(saved.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
      expect(onDisk(p.id).card.data).toMatchObject({ name: 'Aria', description: 'A knight.' });
      const read = (await (await routeFetch(`/api/projects/${p.id}`)).json()) as CardProject;
      expect(read.card.data.name).toBe('Aria');
      expect(read.notes).toBe('n');
    });

    it('saves under the id in the URL, whatever the body says', async () => {
      const p = await create();
      await routeFetch(`/api/projects/${p.id}`, json('PUT', { ...p, id: 'elsewhere' }));
      expect(onDisk(p.id).id).toBe(p.id);
      expect(existsSync(projectFile('elsewhere'))).toBe(false);
    });

    it('keeps the avatar and kept gens on disk over a stale copy from another tab', async () => {
      const p = await create();
      const kept: KeptImage = { id: 'k1', file: 'k1.png', width: 1, height: 1, createdAt: 1 };
      await routeFetch(`/api/projects/${p.id}/kept/k1.png`, { method: 'PUT', body: new Uint8Array(PNG_SIG), headers: { 'x-kept': encodeURIComponent(JSON.stringify(kept)) } });
      // The tab still has the project as it was before the gen was kept.
      await routeFetch(`/api/projects/${p.id}`, json('PUT', { ...p, avatar: { width: 9, height: 9, version: 9 }, notes: 'stale tab' }));
      const saved = onDisk(p.id);
      expect(saved.notes).toBe('stale tab');
      expect(saved.kept.map((k) => k.file)).toEqual(['k1.png']);
      expect(saved.avatar).toBeUndefined();
    });

    it('answers 404 for a project that is not there, and 400 for a bad id or body', async () => {
      expect((await routeFetch('/api/projects/nope')).status).toBe(404);
      expect((await routeFetch('/api/projects/..%2F..%2Fconfig')).status).toBe(400);
      const p = await create();
      const bad = await routeFetch(`/api/projects/${p.id}`, { method: 'PUT', body: '{not json' });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({ error: 'Expected a JSON body.' });
    });

    it('will not save a card that was deleted meanwhile (it would come back)', async () => {
      const p = await create();
      await routeFetch(`/api/projects/${p.id}`, { method: 'DELETE' });
      expect((await routeFetch(`/api/projects/${p.id}`, json('PUT', p))).status).toBe(404);
      expect(existsSync(projectFile(p.id))).toBe(false);
    });

    it('moves a deleted project to the trash rather than deleting it', async () => {
      const p = await create({ notes: 'keep me' });
      expect(await (await routeFetch(`/api/projects/${p.id}`, { method: 'DELETE' })).json()).toEqual({ ok: true });
      expect((await routeFetch(`/api/projects/${p.id}`)).status).toBe(404);
      const trashed = readdirSync(path.join(dir, 'trash')).find((d) => d.startsWith(`${p.id}-`))!;
      expect(JSON.parse(readFileSync(path.join(dir, 'trash', trashed, 'project.json'), 'utf8')).notes).toBe('keep me');
    });

    it('lists the trash, restores from it, and deletes from it for good', async () => {
      const p = await create({ notes: 'back again' });
      await routeFetch(`/api/projects/${p.id}`, json('PUT', { ...p, card: { ...p.card, data: { ...p.card.data, name: 'Binned' } } }));
      await routeFetch(`/api/projects/${p.id}`, { method: 'DELETE' });
      const list = (await (await routeFetch('/api/trash')).json()) as { entry: string; id: string; name: string }[];
      const t = list.find((x) => x.id === p.id)!;
      expect(t.name).toBe('Binned');
      const back = (await (await routeFetch(`/api/trash/${t.entry}`, { method: 'POST' })).json()) as CardProject;
      expect(back.id).toBe(p.id);
      expect(onDisk(p.id).notes).toBe('back again');

      await routeFetch(`/api/projects/${p.id}`, { method: 'DELETE' });
      const again = ((await (await routeFetch('/api/trash')).json()) as { entry: string; id: string }[]).find((x) => x.id === p.id)!;
      expect((await routeFetch(`/api/trash/${again.entry}`, { method: 'DELETE' })).status).toBe(200);
      expect(existsSync(path.join(dir, 'trash', again.entry))).toBe(false);
      expect((await routeFetch('/api/trash/..%2Fprojects', { method: 'DELETE' })).status).toBe(400);
    });

    it('duplicates a project, with its chats only when asked', async () => {
      const p = await create({ notes: 'original' });
      await routeFetch(`/api/projects/${p.id}`, json('PUT', { ...p, card: { ...p.card, data: { ...p.card.data, name: 'Ann' } } }));
      const chat: ChatSession = { id: 'c1', name: 'C', greeting: 0, messages: [], createdAt: 1, updatedAt: 1 };
      await routeFetch(`/api/projects/${p.id}/chats/c1`, json('PUT', chat));
      const bare = (await (await routeFetch(`/api/projects/${p.id}/duplicate`, json('POST', {}))).json()) as CardProject;
      expect(bare.id).not.toBe(p.id);
      expect(bare.card.data.name).toBe('Ann (copy)');
      expect(onDisk(bare.id).notes).toBe('original');
      expect(existsSync(path.join(dir, 'projects', bare.id, 'chats'))).toBe(false);
      const full = (await (await routeFetch(`/api/projects/${p.id}/duplicate`, json('POST', { chats: true }))).json()) as CardProject;
      expect(readdirSync(path.join(dir, 'projects', full.id, 'chats'))).toContain('c1.json');
    });

    it('keeps versions of a card, skipping repeats and pruning the oldest unnamed', async () => {
      await routeFetch('/api/config', json('PUT', { versionHistory: true, versionsToKeep: 3 }));
      const p = await create();
      const v = (name: string, label?: string, reason = 'session') =>
        routeFetch(`/api/projects/${p.id}/versions`, json('POST', { card: { ...p.card, data: { ...p.card.data, name } }, reason, label })).then((r) => r.json());
      const first = await v('one', 'Named');
      expect(first).toMatchObject({ name: 'one', label: 'Named', reason: 'session' });
      await v('two');
      expect(await v('two')).toBeNull();
      await v('three');
      await v('four');
      const list = (await (await routeFetch(`/api/projects/${p.id}/versions`)).json()) as { name: string; label?: string; id: string }[];
      // Three kept: the named one survives the pruning, "two" doesn't.
      expect(list.map((x) => x.name).sort()).toEqual(['four', 'one', 'three']);
      const full = await (await routeFetch(`/api/projects/${p.id}/versions/${list[0].id}`)).json();
      expect(full.card.data.name).toBe(list[0].name);
      await routeFetch(`/api/projects/${p.id}/versions/${first.id}`, json('PATCH', { label: '' }));
      expect(((await (await routeFetch(`/api/projects/${p.id}/versions`)).json()) as { id: string; label?: string }[]).find((x) => x.id === first.id)?.label).toBeUndefined();
      await routeFetch(`/api/projects/${p.id}/versions/${first.id}`, { method: 'DELETE' });
      expect(((await (await routeFetch(`/api/projects/${p.id}/versions`)).json()) as unknown[]).length).toBe(2);

      // Off: only versions saved by hand are kept.
      await routeFetch('/api/config', json('PUT', { versionHistory: false }));
      expect(await v('five')).toBeNull();
      expect(await v('six', 'by hand', 'manual')).toMatchObject({ label: 'by hand' });
      await routeFetch('/api/config', json('PUT', { versionHistory: true, versionsToKeep: 20 }));
    });

    it('lets saves that arrive together all land, one after another', async () => {
      const p = await create();
      const kept = (n: number): KeptImage => ({ id: `g${n}`, file: `g${n}.png`, width: 1, height: 1, createdAt: n });
      await Promise.all([
        // Each a different picture (the same one is only kept once).
        ...[1, 2, 3, 4].map((n) =>
          routeFetch(`/api/projects/${p.id}/kept/g${n}.png`, { method: 'PUT', body: new Uint8Array([...PNG_SIG, n]), headers: { 'x-kept': encodeURIComponent(JSON.stringify(kept(n))) } }),
        ),
        routeFetch(`/api/projects/${p.id}`, json('PUT', { ...p, notes: 'edited meanwhile' })),
      ]);
      const saved = onDisk(p.id);
      expect(saved.kept.map((k) => k.file).sort()).toEqual(['g1.png', 'g2.png', 'g3.png', 'g4.png']);
      expect(saved.notes).toBe('edited meanwhile');
    });
  });

  describe('/api/projects/:id/avatar', () => {
    it('stores any image as a PNG, with its size on the project', async () => {
      const p = await create();
      const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c33' } }).jpeg().toBuffer();
      const res = await routeFetch(`/api/projects/${p.id}/avatar`, { method: 'PUT', body: new Uint8Array(jpeg) });
      expect(await res.json()).toMatchObject({ width: 40, height: 30, version: expect.any(Number) });
      const stored = readFileSync(path.join(dir, 'projects', p.id, 'avatar.png'));
      expect([...stored.subarray(0, 8)]).toEqual(PNG_SIG);
      expect(onDisk(p.id).avatar).toMatchObject({ width: 40, height: 30 });

      const got = await routeFetch(`/api/projects/${p.id}/avatar`);
      expect(got.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await got.arrayBuffer()).equals(stored)).toBe(true);
    });

    it('shrinks a copy for export, leaving the stored one alone', async () => {
      const p = await create();
      const png = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#3c3' } }).png().toBuffer();
      await routeFetch(`/api/projects/${p.id}/avatar`, { method: 'PUT', body: new Uint8Array(png) });
      const small = Buffer.from(await (await routeFetch(`/api/projects/${p.id}/avatar?max=50`)).arrayBuffer());
      expect(await sharp(small).metadata()).toMatchObject({ width: 50, height: 25 });
      expect(onDisk(p.id).avatar).toMatchObject({ width: 200, height: 100 });
    });

    it('removes the picture and the project forgets it', async () => {
      const p = await create();
      const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#000' } }).png().toBuffer();
      await routeFetch(`/api/projects/${p.id}/avatar`, { method: 'PUT', body: new Uint8Array(png) });
      await routeFetch(`/api/projects/${p.id}/avatar`, { method: 'DELETE' });
      expect(existsSync(path.join(dir, 'projects', p.id, 'avatar.png'))).toBe(false);
      expect(onDisk(p.id).avatar).toBeUndefined();
      expect((await routeFetch(`/api/projects/${p.id}/avatar`)).status).toBe(404);
    });
  });

  describe('/api/projects/:id/kept/:file', () => {
    const put = (id: string, file: string, meta: Partial<KeptImage>, body: BodyInit = new Uint8Array(PNG_SIG)) =>
      routeFetch(`/api/projects/${id}/kept/${file}`, { method: 'PUT', body, headers: { 'x-kept': encodeURIComponent(JSON.stringify(meta)) } });

    it('writes the PNG to the gallery and its details to the project', async () => {
      const p = await create();
      const res = await put(p.id, 'a.png', { id: 'a', width: 832, height: 1216, createdAt: 5, prompt: '1girl, ☆ smile', file: 'ignored.png' });
      expect(await res.json()).toMatchObject({ id: 'a', file: 'a.png', prompt: '1girl, ☆ smile' });
      expect([...readFileSync(path.join(dir, 'projects', p.id, 'gallery', 'a.png'))]).toEqual(PNG_SIG);
      // With the file's hash and size, worked out on the server.
      expect(onDisk(p.id).kept).toEqual([{ id: 'a', file: 'a.png', width: 832, height: 1216, createdAt: 5, prompt: '1girl, ☆ smile', hash: expect.stringMatching(/^[0-9a-f]{32}$/), size: 8 }]);
      const got = await routeFetch(`/api/projects/${p.id}/kept/a.png`);
      expect(got.headers.get('cache-control')).toContain('immutable');
    });

    it('replaces a gen kept again under the same file, rather than listing it twice', async () => {
      const p = await create();
      await put(p.id, 'a.png', { id: 'a', width: 1, height: 1, createdAt: 1, label: 'old' });
      await put(p.id, 'a.png', { id: 'a', width: 1, height: 1, createdAt: 1, label: 'new' });
      expect(onDisk(p.id).kept.map((k) => k.label)).toEqual(['new']);
    });

    it('changes its details, but never its file or id', async () => {
      const p = await create();
      await put(p.id, 'a.png', { id: 'a', width: 1, height: 1, createdAt: 1 });
      const res = await routeFetch(`/api/projects/${p.id}/kept/a.png`, json('PATCH', { label: 'happy', file: 'b.png', id: 'b' }));
      expect(await res.json()).toMatchObject({ id: 'a', file: 'a.png', label: 'happy' });
      expect(onDisk(p.id).kept).toEqual([expect.objectContaining({ id: 'a', file: 'a.png', label: 'happy' })]);
    });

    it('unkeeps: the file and its entry both go', async () => {
      const p = await create();
      await put(p.id, 'a.png', { id: 'a', width: 1, height: 1, createdAt: 1 });
      await put(p.id, 'b.png', { id: 'b', width: 1, height: 1, createdAt: 2 }, new Uint8Array([...PNG_SIG, 2]));
      await routeFetch(`/api/projects/${p.id}/kept/a.png`, { method: 'DELETE' });
      expect(onDisk(p.id).kept.map((k) => k.file)).toEqual(['b.png']);
      expect(readdirSync(path.join(dir, 'projects', p.id, 'gallery'))).toEqual(['b.png']);
    });

    it('refuses a gen with no details, or a file name that could leave the gallery', async () => {
      const p = await create();
      expect((await routeFetch(`/api/projects/${p.id}/kept/a.png`, { method: 'PUT', body: new Uint8Array(PNG_SIG) })).status).toBe(400);
      expect((await put(p.id, '..%2Fproject.json', { id: 'x' })).status).toBe(400);
      expect(onDisk(p.id).kept).toEqual([]);
    });
  });

  describe('chats', () => {
    const chat = (id: string, n: number, extra: Partial<ChatSession> = {}): ChatSession => ({
      id,
      name: `Chat ${id}`,
      greeting: 0,
      messages: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', swipes: [`hi ${i}`], swipe: 0, createdAt: i })),
      createdAt: 1,
      updatedAt: 1,
      ...extra,
    });

    it('saves a chat under the id in the URL and lists it, newest first', async () => {
      const p = await create();
      await routeFetch(`/api/projects/${p.id}/chats/c1`, json('PUT', chat('c1', 2)));
      await routeFetch(`/api/projects/${p.id}/chats/c2`, json('PUT', chat('wrong', 3)));
      const list = (await (await routeFetch(`/api/projects/${p.id}/chats`)).json()) as { id: string; messageCount: number }[];
      expect(list.map(({ id, messageCount }) => ({ id, messageCount }))).toEqual([
        { id: 'c2', messageCount: 3 },
        { id: 'c1', messageCount: 2 },
      ]);
      const c2 = (await (await routeFetch(`/api/projects/${p.id}/chats/c2`)).json()) as ChatSession;
      expect(c2.id).toBe('c2');
      expect(c2.messages[2].swipes).toEqual(['hi 2']);
    });

    it('creates a chat with POST, too', async () => {
      const p = await create();
      const res = await routeFetch(`/api/projects/${p.id}/chats`, json('POST', chat('c9', 1)));
      expect((await res.json()).id).toBe('c9');
      expect(existsSync(path.join(dir, 'projects', p.id, 'chats', 'c9.json'))).toBe(true);
    });

    it("counts a card's chats and messages in the card list", async () => {
      const p = await create();
      await routeFetch(`/api/projects/${p.id}/chats/c1`, json('PUT', chat('c1', 2)));
      await routeFetch(`/api/projects/${p.id}/chats/c2`, json('PUT', chat('c2', 5)));
      const list = (await (await routeFetch('/api/projects')).json()) as { id: string; chats?: number; messages?: number }[];
      expect(list.find((s) => s.id === p.id)).toMatchObject({ chats: 2, messages: 7 });
    });

    it("deletes a chat along with its own pictures, and no other chat's", async () => {
      const p = await create();
      await routeFetch(`/api/projects/${p.id}/chats/c1`, json('PUT', chat('c1', 1)));
      for (const file of ['c1-a.png', 'c1-b.png', 'c10-a.png']) {
        const res = await routeFetch(`/api/projects/${p.id}/chat-images/${file}`, { method: 'PUT', body: new Uint8Array(PNG_SIG) });
        expect(await res.json()).toEqual({ file });
      }
      await routeFetch(`/api/projects/${p.id}/chats/c1`, { method: 'DELETE' });
      expect((await routeFetch(`/api/projects/${p.id}/chats/c1`)).status).toBe(404);
      expect(readdirSync(path.join(dir, 'projects', p.id, 'chat-images'))).toEqual(['c10-a.png']);
    });

    it('refuses chat ids and picture names that could leave the folder', async () => {
      const p = await create();
      expect((await routeFetch(`/api/projects/${p.id}/chats/..%2F..%2Fproject`, json('PUT', chat('x', 0)))).status).toBe(400);
      expect((await routeFetch(`/api/projects/${p.id}/chat-images/..%2Fx.png`, { method: 'PUT', body: new Uint8Array(PNG_SIG) })).status).toBe(400);
    });
  });

  it('a damaged project.json is a 409 to read, and the tab that has the card open can save it back', async () => {
    const p = await create();
    writeFileSync(projectFile(p.id), '\0\0\0\0');
    expect((await routeFetch(`/api/projects/${p.id}`)).status).toBe(409);
    expect((await routeFetch(`/api/projects/${p.id}`, json('PUT', { ...p, notes: 'rescued' }))).status).toBe(200);
    expect(onDisk(p.id).notes).toBe('rescued');
  });
});
