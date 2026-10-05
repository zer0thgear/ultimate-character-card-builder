import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lorebook, LorebookEntry } from '@/types/card';
import type { BankLorebook, CardProject } from '@/types/project';
import { useProjectStore } from '@/store/projectStore';
import { useLorebookStore } from '@/store/lorebookStore';
import { useLlmStore } from '@/store/llmStore';
import { installLorebookSync } from '@/store/lorebookSync';
import { routeFetch } from './helpers/routes';

// A card's lorebook and its copy in the Lorebooks bank kept in step, both
// ways, through the real stores and routes (store/lorebookSync.ts).

const entry = (content: string): LorebookEntry => ({ keys: ['k'], content, extensions: {}, enabled: true, insertion_order: 100, use_regex: false });
const book = (name: string, content: string): Lorebook => ({ name, extensions: {}, entries: [entry(content)] });
const cards = () => useProjectStore.getState();
const bank = () => useLorebookStore.getState();
const copyOf = (id: string) => bank().books.find((b) => b.id === id)!;
const setSync = (syncCardLorebooks: boolean) => useLlmStore.getState().setChatSettings({ syncCardLorebooks });

describe('lorebook sync', { timeout: 30_000 }, () => {
  let dir: string;
  const onDisk = (id: string) => JSON.parse(readFileSync(path.join(dir, 'projects', id, 'project.json'), 'utf8')) as CardProject;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-sync-'));
    process.env.UCCB_DATA_DIR = dir;
    vi.stubGlobal('fetch', routeFetch);
    installLorebookSync();
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    useProjectStore.setState({ summaries: [], project: null, status: 'saved', error: null, past: [], future: [] });
    useLorebookStore.setState({ books: [], loaded: true });
  });
  afterEach(async () => {
    await cards().flush();
    await bank().flush();
  });

  /** A card with a lorebook, opened, and its copy in the bank. */
  async function cardWithCopy(init: Partial<CardProject> = {}): Promise<{ p: CardProject; copy: BankLorebook }> {
    const p = await cards().create(init);
    cards().updateCard((d) => ({ ...d, name: 'Ann', character_book: book('', 'Original.') }));
    const copy = (await bank().importFromCard(p.id, cards().project!.card.data))!;
    return { p, copy };
  }

  it('leaves the two apart when syncing is off', async () => {
    setSync(false);
    const { copy } = await cardWithCopy();
    cards().updateCard((d) => ({ ...d, character_book: book('', 'Card edit.') }));
    expect(copyOf(copy.id).book.entries[0].content).toBe('Original.');
    bank().setBook(copy.id, book(copy.book.name!, 'Bank edit.'));
    expect(cards().project!.card.data.character_book!.entries[0].content).toBe('Card edit.');
  });

  it('passes edits both ways when syncing is on, each side keeping its name', async () => {
    setSync(true);
    const { copy } = await cardWithCopy();
    expect(copy.book.name).toBe("Ann's Lorebook");

    cards().updateCard((d) => ({ ...d, character_book: book('', 'Card edit.') }));
    expect(copyOf(copy.id).book.entries[0].content).toBe('Card edit.');
    expect(copyOf(copy.id).book.name).toBe("Ann's Lorebook");

    bank().setBook(copy.id, book("Ann's Lorebook", 'Bank edit.'));
    expect(cards().project!.card.data.character_book!.entries[0].content).toBe('Bank edit.');
    expect(cards().project!.card.data.character_book!.name).toBe('');
    // The bank's edit is one undo step on the card.
    cards().undo();
    expect(cards().project!.card.data.character_book!.entries[0].content).toBe('Card edit.');
    expect(copyOf(copy.id).book.entries[0].content).toBe('Card edit.');
  });

  it("follows the card's own choice over the global one", async () => {
    setSync(true);
    const { copy } = await cardWithCopy();
    cards().setLorebookSync(false);
    cards().updateCard((d) => ({ ...d, character_book: book('', 'Card only.') }));
    expect(copyOf(copy.id).book.entries[0].content).toBe('Original.');

    setSync(false);
    cards().setLorebookSync(true);
    bank().setBook(copy.id, book("Ann's Lorebook", 'Both.'));
    expect(cards().project!.card.data.character_book!.entries[0].content).toBe('Both.');
  });

  it("changes a card that isn't open on the server", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      setSync(true);
      const { p, copy } = await cardWithCopy();
      await cards().flush();
      useProjectStore.setState({ project: null });
      bank().setBook(copy.id, book("Ann's Lorebook", 'Edited while closed.'));
      await vi.runAllTimersAsync();
      await vi.waitFor(() => expect(onDisk(p.id).card.data.character_book?.entries[0].content).toBe('Edited while closed.'));
      expect(onDisk(p.id).card.data.name).toBe('Ann');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the copy when the card drops its lorebook', async () => {
    setSync(true);
    const { copy } = await cardWithCopy();
    cards().updateCard((d) => {
      const next = { ...d };
      delete next.character_book;
      return next;
    });
    expect(copyOf(copy.id).book.entries[0].content).toBe('Original.');
  });
});
