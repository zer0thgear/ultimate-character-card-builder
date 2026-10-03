import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatStatsDetail, lastUsed, sortCards, sortDetail, tagCounts, withTags } from '@/lib/cardSort';

// The card lists' order, and the chat counts the server lists them with.

const card = (name: string, createdAt: number, updatedAt: number, more: { chats?: number; messages?: number; lastChat?: number; sent?: number; received?: number; tokens?: number } = {}) => ({ name, createdAt, updatedAt, ...more });

describe('sortCards', () => {
  const cards = [
    card('beta', 3, 30, { chats: 1, messages: 5, lastChat: 100, sent: 2, received: 3, tokens: 1234 }),
    card('Alpha 10', 1, 50),
    card('', 5, 60, { chats: 2, messages: 2, tokens: 40 }),
    card('alpha 2', 2, 40, { chats: 2, messages: 9, tokens: 900 }),
  ];
  const names = (by: Parameters<typeof sortCards>[1]) => sortCards(cards, by).map((c) => c.name);

  it('sorts by name either way, numbers in order, unnamed last', () => {
    expect(names({ by: 'name', desc: false })).toEqual(['alpha 2', 'Alpha 10', 'beta', '']);
    expect(names({ by: 'name', desc: true })).toEqual(['beta', 'Alpha 10', 'alpha 2', '']);
  });

  it('sorts by when made', () => {
    expect(names({ by: 'created', desc: true })).toEqual(['', 'beta', 'alpha 2', 'Alpha 10']);
    expect(names({ by: 'created', desc: false })).toEqual(['Alpha 10', 'alpha 2', 'beta', '']);
  });

  it('counts a chat as using the card', () => {
    expect(lastUsed(cards[0])).toBe(100);
    expect(names({ by: 'used', desc: true })).toEqual(['beta', '', 'Alpha 10', 'alpha 2']);
  });

  it('sorts by chats and messages, ties by name', () => {
    expect(names({ by: 'chats', desc: true })).toEqual(['alpha 2', '', 'beta', 'Alpha 10']);
    expect(names({ by: 'messages', desc: false })).toEqual(['Alpha 10', '', 'beta', 'alpha 2']);
  });

  it('sorts by tokens', () => {
    expect(names({ by: 'tokens', desc: true })).toEqual(['beta', 'alpha 2', '', 'Alpha 10']);
  });

  it("doesn't change the list it's given", () => {
    const before = cards.map((c) => c.name);
    sortCards(cards, { by: 'name', desc: false });
    expect(cards.map((c) => c.name)).toEqual(before);
  });

  it('says what the order is by', () => {
    expect(sortDetail(cards[0], 'chats')).toBe('1 chat · 5 messages');
    expect(sortDetail(cards[1], 'chats')).toBe('0 chats · 0 messages');
    expect(sortDetail(cards[0], 'messages')).toBe('5 messages · 2 sent · 3 received');
    expect(sortDetail(cards[0], 'tokens')).toBe('1.2k tokens · 5 messages');
    expect(sortDetail(cards[1], 'tokens')).toBe('0 tokens · 0 messages');
    expect(chatStatsDetail(cards[0])).toBe('1 chat · 2 sent · 3 received · 1.2k tokens');
    expect(sortDetail(cards[0], 'created')).toMatch(/^Created /);
  });
});

describe('card list chat counts', { timeout: 30_000 }, () => {
  let dir: string;
  let storage: typeof import('@/lib/server/storage');
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-cardsort-'));
    process.env.UCCB_DATA_DIR = dir;
    storage = await import('@/lib/server/storage');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists each card with its chats, messages and last chat', async () => {
    const p = await storage.createProject();
    const msg = (id: string) => ({ id, role: 'user' as const, swipes: ['hi'], swipe: 0, createdAt: 0 });
    const chat = (id: string, n: number) => ({ id, name: id, greeting: 0, messages: Array.from({ length: n }, (_, i) => msg(`m${i}`)), createdAt: 0, updatedAt: 0 });
    const summary = async () => (await storage.listProjects()).find((s) => s.id === p.id)!;
    expect((await summary()).chats).toBeUndefined();

    await storage.saveChat(p.id, chat('11111111-1111-4111-8111-111111111111', 3));
    const b = await storage.saveChat(p.id, chat('22222222-2222-4222-8222-222222222222', 4));
    let s = await summary();
    expect([s.chats, s.messages, s.lastChat]).toEqual([2, 7, b.updatedAt]);
    // Every message there is a one-token 'hi' sent by you.
    expect([s.sent, s.received, s.tokens]).toEqual([7, 0, 7]);

    // A chat that changes is read again; one deleted drops out.
    await new Promise((r) => setTimeout(r, 20));
    await storage.saveChat(p.id, chat('22222222-2222-4222-8222-222222222222', 6));
    expect((await summary()).messages).toBe(9);
    await storage.deleteChat(p.id, '11111111-1111-4111-8111-111111111111');
    s = await summary();
    expect([s.chats, s.messages]).toEqual([1, 6]);
  });
});

describe('tag filter', () => {
  const card = (tags: string[]) => ({ tags });
  it('counts tags across cards, any case, most used first', () => {
    expect(tagCounts([card(['Fantasy', 'elf']), card(['fantasy']), card(['fantasy', 'sci-fi'])])).toEqual([
      { tag: 'fantasy', count: 3 },
      { tag: 'elf', count: 1 },
      { tag: 'sci-fi', count: 1 },
    ]);
  });
  it('keeps cards that have every picked tag', () => {
    const cards = [card(['a', 'B']), card(['a']), card(['b'])];
    expect(withTags(cards, ['A', 'b'])).toEqual([cards[0]]);
    expect(withTags(cards, [])).toBe(cards);
  });
});
