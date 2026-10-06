import { beforeEach, describe, expect, it, vi } from 'vitest';

// An extension's data (uccb.storage): quick changes build on each other and
// reach the server in order, however slow its saves are.

const server = { data: {} as Record<string, unknown>, saves: [] as Record<string, unknown>[], delay: 20, fail: false };
vi.mock('@/lib/api', () => ({
  api: {
    getPackData: async () => structuredClone(server.data),
    savePackData: async (_id: string, data: Record<string, unknown>) => {
      await new Promise((r) => setTimeout(r, server.delay));
      if (server.fail) throw new Error('disk full');
      server.saves.push(data);
      server.data = structuredClone(data);
      return data;
    },
  },
}));

const set = (id: string, key: string, value: unknown) => updatePackData(id, (d) => ({ ...d, [key]: value }));
let updatePackData: typeof import('@/store/packDataCache').updatePackData;
let readPackData: typeof import('@/store/packDataCache').readPackData;

beforeEach(async () => {
  vi.resetModules();
  ({ updatePackData, readPackData } = await import('@/store/packDataCache'));
  Object.assign(server, { data: { kept: 1 }, saves: [], delay: 20, fail: false });
});

describe('pack data', () => {
  it('keeps every key when changes come at once', async () => {
    await Promise.all([set('p', 'a', 1), set('p', 'b', 2), set('p', 'c', 3)]);
    expect(server.data).toEqual({ kept: 1, a: 1, b: 2, c: 3 });
    expect(await readPackData('p')).toEqual({ kept: 1, a: 1, b: 2, c: 3 });
  });

  it('ends with the last value, and sends a burst as one save', async () => {
    const all = Array.from({ length: 10 }, (_, i) => set('p', 'step', i));
    await Promise.all(all);
    expect(server.data.step).toBe(9);
    // The first, then the rest together.
    expect(server.saves.length).toBe(2);
    expect(server.saves.map((s) => s.step)).toEqual([0, 9]);
  });

  it('saves a change made just as a save finishes', async () => {
    await set('p', 'step', 'review');
    const late = set('p', 'step', 'done');
    await late;
    expect(server.data.step).toBe('done');
  });

  it('says when a save fails', async () => {
    server.fail = true;
    await expect(set('p', 'a', 1)).rejects.toThrow('disk full');
    server.fail = false;
    await set('p', 'b', 2);
    expect(server.data).toEqual({ kept: 1, a: 1, b: 2 });
  });
});
