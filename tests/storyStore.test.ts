import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardProject, StorySession } from '@/types/project';
import { useStoryStore } from '@/store/storyStore';
import { json, routeFetch } from './helpers/routes';

// The open card's stories (Writing mode), saving through the real routes
// onto a temp data folder.

const store = () => useStoryStore.getState();

describe('story store', { timeout: 30_000 }, () => {
  let dir: string;
  let projectId: string;
  const onDisk = (id: string) => JSON.parse(readFileSync(path.join(dir, 'projects', projectId, 'stories', `${id}.json`), 'utf8')) as StorySession;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-stories-'));
    process.env.UCCB_DATA_DIR = dir;
    vi.stubGlobal('fetch', routeFetch);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    projectId = ((await (await routeFetch('/api/projects', json('POST', {}))).json()) as CardProject).id;
    useStoryStore.setState({ projectId: null, list: [], story: null, past: [], future: [] });
  });
  afterEach(async () => {
    await store().flush();
    vi.useRealTimers();
  });

  it('starts a story with the card and you in its Dramatis Personae, and saves edits', async () => {
    await store().loadFor(projectId);
    await store().newStory({ text: 'Once.', memory: 'A tale.' });
    const id = store().story!.id;
    expect(onDisk(id)).toMatchObject({ text: 'Once.', memory: 'A tale.', proofread: false, useLorebook: true });
    expect(onDisk(id).personae.map((p) => p.link)).toEqual(['char', 'user']);

    store().update({ text: 'Once upon a time.' });
    await vi.advanceTimersByTimeAsync(600);
    await vi.waitFor(() => expect(onDisk(id).text).toBe('Once upon a time.'));
    expect(store().list[0]).toMatchObject({ id, words: 4 });
  });

  it('undoes and redoes generations', async () => {
    await store().loadFor(projectId);
    await store().newStory({ text: 'A', memory: '' });
    store().commitText('A B');
    store().commitText('A B C');
    store().undo();
    expect(store().story!.text).toBe('A B');
    store().undo();
    expect(store().story!.text).toBe('A');
    store().redo();
    expect(store().story!.text).toBe('A B');
    store().commitText('A B D');
    expect(store().future).toEqual([]);
  });

  it('opens the newest story and deletes one', async () => {
    await routeFetch(`/api/projects/${projectId}/stories/old`, json('PUT', { id: 'old', name: 'Old', text: 'x' }));
    await vi.advanceTimersByTimeAsync(10);
    await routeFetch(`/api/projects/${projectId}/stories/new`, json('PUT', { id: 'new', name: 'New', text: 'two words' }));
    await store().loadFor(projectId);
    expect(store().list.map((s) => [s.id, s.words])).toEqual([
      ['new', 2],
      ['old', 1],
    ]);
    // Settings it never saved are filled in.
    expect(store().story).toMatchObject({ id: 'new', personae: [], scanDepth: 6 });
    await store().deleteStory('new');
    expect(store().list.map((s) => s.id)).toEqual(['old']);
    expect(store().story?.id).toBe('old');
    await store().deleteStory('old');
    expect(store().story).toBeNull();
    expect((await routeFetch(`/api/projects/${projectId}/stories/new`)).status).toBe(404);
  });
});
