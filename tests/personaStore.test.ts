import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Persona } from '@/types/project';
import { useLlmStore } from '@/store/llmStore';
import { usePersonaStore } from '@/store/personaStore';
import { routeFetch, routeLog } from './helpers/routes';

// Personas, saving through the real routes onto a temp data folder.

const store = () => usePersonaStore.getState();

describe('persona store', { timeout: 30_000 }, () => {
  let dir: string;
  const onDisk = () => JSON.parse(readFileSync(path.join(dir, 'personas', 'personas.json'), 'utf8')) as Persona[];
  const saves = () => routeLog.filter((r) => r === 'PUT /api/personas').length;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-personas-'));
    process.env.UCCB_DATA_DIR = dir;
    vi.stubGlobal('fetch', routeFetch);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    usePersonaStore.setState({ personas: [], loaded: false });
  });
  afterEach(() => vi.useRealTimers());

  it('saves the list once, after a burst of edits', async () => {
    const before = saves();
    const p = store().add({ name: 'Sam' });
    store().update(p.id, { description: 'A tall wanderer.' });
    store().update(p.id, { name: 'Samwise' });
    await vi.advanceTimersByTimeAsync(499);
    expect(saves()).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(onDisk()).toEqual([{ id: p.id, name: 'Samwise', description: 'A tall wanderer.' }]));
    expect(saves()).toBe(before + 1);

    usePersonaStore.setState({ personas: [], loaded: false });
    await store().load();
    expect(store()).toMatchObject({ loaded: true, personas: [{ id: p.id, name: 'Samwise' }] });
  });

  it('saves a new persona before giving it a picture', async () => {
    const p = store().add({ name: 'Kai' });
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#fa0' } }).png().toBuffer();
    await store().setAvatar(p.id, new Blob([new Uint8Array(png)]));
    const avatar = store().personas.find((x) => x.id === p.id)?.avatar;
    expect(avatar).toMatchObject({ width: 8, height: 8 });
    expect(onDisk().find((x) => x.id === p.id)?.avatar).toEqual(avatar);
    expect(existsSync(path.join(dir, 'personas', `${p.id}.png`))).toBe(true);

    await store().clearAvatar(p.id);
    expect(store().personas.find((x) => x.id === p.id)?.avatar).toBeUndefined();
    expect(existsSync(path.join(dir, 'personas', `${p.id}.png`))).toBe(false);
  });

  it('removes a persona with its picture, and stops using it', async () => {
    const p = store().add({ name: 'Lee' });
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#000' } }).png().toBuffer();
    await store().setAvatar(p.id, new Blob([new Uint8Array(png)]));
    useLlmStore.getState().setChatSettings({ personaId: p.id });

    await store().remove(p.id);
    expect(store().personas).toEqual([]);
    expect(onDisk()).toEqual([]);
    expect(existsSync(path.join(dir, 'personas', `${p.id}.png`))).toBe(false);
    expect(useLlmStore.getState().chatSettings.personaId).toBeNull();
  });
});
