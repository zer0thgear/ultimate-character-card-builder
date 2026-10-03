import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardProject, ChatImage, ChatMessage, ChatSession } from '@/types/project';
import { useChatStore } from '@/store/chatStore';
import { useProjectStore } from '@/store/projectStore';
import { json, routeFetch, routeLog } from './helpers/routes';

// The open card's test chats, saving through the real routes onto a temp
// data folder.

const store = () => useChatStore.getState();
const msg = (id: string, text = id): ChatMessage => ({ id, role: 'user', swipes: [text], swipe: 0, createdAt: 1 });
const image = (id: string, after: string | null, file: string): ChatImage => ({ id, after, file, width: 1, height: 1, scene: 'a field', characters: [], createdAt: 1 });

describe('chat store', { timeout: 30_000 }, () => {
  let dir: string;
  let projectId: string;
  const chatsDir = () => path.join(dir, 'projects', projectId, 'chats');
  const imagesDir = () => path.join(dir, 'projects', projectId, 'chat-images');
  const onDisk = (id: string) => JSON.parse(readFileSync(path.join(chatsDir(), `${id}.json`), 'utf8')) as ChatSession;
  const newProject = async () => ((await (await routeFetch('/api/projects', json('POST', {}))).json()) as CardProject).id;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-chats-'));
    process.env.UCCB_DATA_DIR = dir;
    vi.stubGlobal('fetch', routeFetch);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    projectId = await newProject();
    useChatStore.setState({ projectId: null, list: [], chat: null });
    useProjectStore.setState({ summaries: [{ id: projectId, name: '', tags: [], createdAt: 1, updatedAt: 1 }] });
  });
  afterEach(async () => {
    await store().flush();
    vi.useRealTimers();
  });

  it("opens a card's newest chat", async () => {
    await routeFetch(`/api/projects/${projectId}/chats/old`, json('PUT', { id: 'old', name: 'Old', greeting: 0, messages: [], createdAt: 1, updatedAt: 1 }));
    await vi.advanceTimersByTimeAsync(10);
    await routeFetch(`/api/projects/${projectId}/chats/new`, json('PUT', { id: 'new', name: 'New', greeting: 1, messages: [msg('m1')], createdAt: 2, updatedAt: 2 }));
    await store().loadFor(projectId);
    expect(store().list.map((c) => c.id)).toEqual(['new', 'old']);
    expect(store().chat?.id).toBe('new');
    expect(store().chat?.messages).toEqual([msg('m1')]);
  });

  it('saves a new chat at once, and its messages once the typing stops', async () => {
    await store().loadFor(projectId);
    await store().newChat(0);
    const id = store().chat!.id;
    expect(onDisk(id).messages).toEqual([]);

    store().setMessages((m) => [...m, msg('m1', 'hello')]);
    await vi.advanceTimersByTimeAsync(300);
    store().setMessages((m) => [...m, msg('m2', 'there')]);
    await vi.advanceTimersByTimeAsync(599);
    expect(onDisk(id).messages).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(onDisk(id).messages.map((m) => m.swipes[0])).toEqual(['hello', 'there']));
    expect(store().list[0]).toMatchObject({ id, messageCount: 2, sent: 2, received: 0 });
    // (Roughly, if the tokenizer's still loading.)
    expect(store().list[0].tokens).toBeGreaterThan(0);
    expect(useProjectStore.getState().summaries[0]).toMatchObject({ chats: 1, messages: 2, sent: 2, received: 0, tokens: store().list[0].tokens });
  });

  it("keeps the card list's chat counts up to date", async () => {
    await store().loadFor(projectId);
    await store().newChat(0);
    store().setMessages(() => [msg('a'), msg('b'), msg('c')]);
    expect(useProjectStore.getState().summaries[0]).toMatchObject({ chats: 1, messages: 3 });
  });

  it('saves a rename, greeting edits and a locked persona', async () => {
    await store().loadFor(projectId);
    await store().newChat(0);
    const id = store().chat!.id;
    store().rename('Tavern scene');
    store().setGreetingEdit(0, 'Hi, traveller.');
    store().setPersonaLock('p1');
    await store().flush();
    expect(onDisk(id)).toMatchObject({ name: 'Tavern scene', greetingEdits: { 0: 'Hi, traveller.' }, personaId: 'p1' });
    store().setGreetingEdit(0, undefined);
    await store().flush();
    expect(onDisk(id)).not.toHaveProperty('greetingEdits');
  });

  it('deletes the picture that followed a message when the message goes', async () => {
    await store().loadFor(projectId);
    await store().newChat(0);
    const id = store().chat!.id;
    for (const f of [`${id}-a.png`, `${id}-b.png`]) await routeFetch(`/api/projects/${projectId}/chat-images/${f}`, { method: 'PUT', body: new Uint8Array([1]) });
    store().setMessages(() => [msg('m1'), msg('m2')]);
    store().putImage(image('i1', 'm1', `${id}-a.png`));
    store().putImage(image('i2', 'm2', `${id}-b.png`));
    store().setMessages((m) => m.slice(0, 1));
    await store().flush();
    expect(onDisk(id).images?.map((i) => i.id)).toEqual(['i1']);
    await vi.waitFor(() => expect(readdirSync(imagesDir())).toEqual([`${id}-a.png`]));
  });

  it('branches a chat at a message, with copies of its pictures of its own', async () => {
    await store().loadFor(projectId);
    await store().newChat(0);
    const from = store().chat!;
    await routeFetch(`/api/projects/${projectId}/chat-images/${from.id}-a.png`, { method: 'PUT', body: new Uint8Array([7, 7]) });
    store().rename('Main');
    store().setMessages(() => [msg('m1'), msg('m2'), msg('m3')]);
    store().putImage(image('i1', 'm1', `${from.id}-a.png`));

    await store().branchFrom('m2');
    const branch = store().chat!;
    expect(branch.id).not.toBe(from.id);
    expect(branch.name).toBe('Main (branch at #2)');
    expect(onDisk(branch.id).messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    const copy = onDisk(branch.id).images![0].file;
    expect(copy.startsWith(`${branch.id}-`)).toBe(true);
    expect([...readFileSync(path.join(imagesDir(), copy))]).toEqual([7, 7]);
    // The chat it came from was saved first, and is left as it was.
    expect(onDisk(from.id).messages).toHaveLength(3);
    expect(store().list.map((c) => c.id)).toEqual([branch.id, from.id]);

    // Deleting the branch leaves the original's picture alone.
    await store().deleteChat(branch.id);
    expect(readdirSync(imagesDir())).toEqual([`${from.id}-a.png`]);
  });

  it('drops a pending save when the open chat is deleted', async () => {
    await store().loadFor(projectId);
    await store().newChat(0);
    const id = store().chat!.id;
    store().rename('Gone soon');
    await store().deleteChat(id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store().chat).toBeNull();
    expect(store().list).toEqual([]);
    expect(existsSync(path.join(chatsDir(), `${id}.json`))).toBe(false);
  });

  it("saves a chat's last edits before switching to another card's chats", async () => {
    await store().loadFor(projectId);
    await store().newChat(0);
    const id = store().chat!.id;
    const first = projectId;
    store().rename('Unsaved');
    const other = await newProject();
    const at = routeLog.length;
    await store().loadFor(other);
    expect(routeLog.slice(at)).toEqual([`PUT /api/projects/${first}/chats/${id}`, `GET /api/projects/${other}/chats`]);
    expect(JSON.parse(readFileSync(path.join(dir, 'projects', first, 'chats', `${id}.json`), 'utf8')).name).toBe('Unsaved');
    expect(store()).toMatchObject({ projectId: other, list: [], chat: null });
  });
});
