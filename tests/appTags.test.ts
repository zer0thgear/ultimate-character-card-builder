import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_TAG_DATA, addTagsToCard, applyAppTags, cleanTagData, cycleFilter, importCandidates, mergeTagBackup, openFolders, parseTagBackup, removeTag, tagUse, type AppTag, type AppTagData } from '@/lib/appTags';
import { routeFetch } from './helpers/routes';

const tag = (id: string, folder: AppTag['folder'] = 'none', order = 0): AppTag => ({ id, name: id.toUpperCase(), folder, order, createdAt: 0 });

const cards = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
// a: fantasy; b: fantasy + nsfw; c: nsfw; d: nothing
const data = (over: Partial<AppTagData> = {}): AppTagData => ({
  ...EMPTY_TAG_DATA,
  tags: [tag('fantasy', 'none', 0), tag('nsfw', 'none', 1)],
  map: { a: ['fantasy'], b: ['fantasy', 'nsfw'], c: ['nsfw'] },
  ...over,
});
const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe('app tag filter', () => {
  it('cycles a chip through show only, hide and off, as ST does', () => {
    let f = { include: [], exclude: [] } as { include: string[]; exclude: string[] };
    f = cycleFilter(f, 'x');
    expect(f).toEqual({ include: ['x'], exclude: [] });
    f = cycleFilter(f, 'x');
    expect(f).toEqual({ include: [], exclude: ['x'] });
    f = cycleFilter(f, 'x');
    expect(f).toEqual({ include: [], exclude: [] });
  });

  it('shows cards with every included tag and none excluded', () => {
    expect(ids(applyAppTags(cards, data(), { include: ['fantasy'], exclude: [] }).cards)).toEqual(['a', 'b']);
    expect(ids(applyAppTags(cards, data(), { include: ['fantasy'], exclude: ['nsfw'] }).cards)).toEqual(['a']);
    expect(ids(applyAppTags(cards, data(), { include: [], exclude: ['nsfw'] }).cards)).toEqual(['a', 'd']);
  });

  it('ignores tags that no longer exist', () => {
    expect(ids(applyAppTags(cards, data(), { include: ['gone'], exclude: [] }).cards)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('tags as folders', () => {
  it('an open folder shows, and its cards stay in the list too', () => {
    const d = data({ tags: [tag('fantasy', 'open'), tag('nsfw')] });
    const r = applyAppTags(cards, d, { include: [], exclude: [] });
    expect(r.folders.map((f) => [f.tag.id, f.count])).toEqual([['fantasy', 2]]);
    expect(ids(r.cards)).toEqual(['a', 'b', 'c', 'd']);
  });

  it("a closed folder's cards show only inside it", () => {
    const d = data({ tags: [tag('fantasy'), tag('nsfw', 'closed')] });
    const root = applyAppTags(cards, d, { include: [], exclude: [] });
    expect(root.folders.map((f) => [f.tag.id, f.count])).toEqual([['nsfw', 2]]);
    expect(ids(root.cards)).toEqual(['a', 'd']);
    const inside = applyAppTags(cards, d, { include: ['nsfw'], exclude: [] });
    expect(inside.folders).toEqual([]);
    expect(ids(inside.cards)).toEqual(['b', 'c']);
  });

  it('a card in two closed folders shows only once both are open', () => {
    const d = data({ tags: [tag('fantasy', 'closed', 0), tag('nsfw', 'closed', 1)] });
    const inFantasy = applyAppTags(cards, d, { include: ['fantasy'], exclude: [] });
    expect(ids(inFantasy.cards)).toEqual(['a']);
    expect(inFantasy.folders.map((f) => [f.tag.id, f.count])).toEqual([['nsfw', 1]]);
    expect(ids(applyAppTags(cards, d, { include: ['fantasy', 'nsfw'], exclude: [] }).cards)).toEqual(['b']);
  });

  it('hides empty and excluded folders, and none with folders off', () => {
    const d = data({ tags: [tag('fantasy', 'open'), tag('nsfw', 'closed'), tag('empty', 'open')] });
    expect(applyAppTags(cards, d, { include: [], exclude: ['nsfw'] }).folders.map((f) => f.tag.id)).toEqual(['fantasy']);
    const off = applyAppTags(cards, { ...d, folders: false }, { include: [], exclude: [] });
    expect(off.folders).toEqual([]);
    expect(ids(off.cards)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('the folders you are in are the included folder tags, in order', () => {
    const d = data({ tags: [tag('fantasy', 'open'), tag('nsfw', 'closed')] });
    expect(openFolders(d, { include: ['nsfw', 'fantasy'], exclude: [] }).map((t) => t.id)).toEqual(['nsfw', 'fantasy']);
    expect(openFolders({ ...d, folders: false }, { include: ['nsfw'], exclude: [] })).toEqual([]);
  });
});

describe('card tags on import', () => {
  it('splits a card’s tags into ones you have and new ones, as ST does', () => {
    const d = data();
    const r = importCandidates(['Fantasy', 'ROOT', 'Elf', 'elf', ' ', 'NSFW'], d, 'c');
    expect(r.existing.map((t) => t.id)).toEqual(['fantasy']);
    expect(r.fresh).toEqual(['Elf']);
  });

  it('adds tags to a card, making new ones unless only existing', () => {
    let n = 0;
    const make = () => `new${++n}`;
    const d = addTagsToCard(data(), 'd', ['fantasy', 'Elf'], make);
    expect(d.map.d).toEqual(['fantasy', 'new1']);
    expect(d.tags.find((t) => t.id === 'new1')).toMatchObject({ name: 'Elf', folder: 'none', order: 2 });
    expect(addTagsToCard(data(), 'd', ['Elf'], make, true).map.d).toEqual([]);
  });
});

describe('tag data', () => {
  it('cleans what it reads', () => {
    const d = cleanTagData({ tags: [{ id: 'x', name: ' X ', folder: 'CLOSED' }, { id: 'x', name: 'dup' }, { name: 'no id' }, { id: 'y', name: 'Y', folder: 'closed', color: '#f00' }], map: { c1: ['x', 'gone', 'x'], c2: ['gone'] }, folders: false });
    expect(d.tags).toEqual([
      { id: 'x', name: 'X', folder: 'none', order: 0, createdAt: 0 },
      { id: 'y', name: 'Y', folder: 'closed', order: 1, createdAt: 0, color: '#f00' },
    ]);
    expect(d.map).toEqual({ c1: ['x'] });
    expect(d).toMatchObject({ folders: false, importMode: 'ask' });
    expect(cleanTagData(null)).toEqual(EMPTY_TAG_DATA);
  });

  it('removing a tag takes it off every card', () => {
    const d = removeTag(data(), 'nsfw');
    expect(d.tags.map((t) => t.id)).toEqual(['fantasy']);
    expect(d.map).toEqual({ a: ['fantasy'], b: ['fantasy'] });
    expect(tagUse(d).get('fantasy')).toBe(2);
  });

  it("merges a SillyTavern tag backup by name", () => {
    const st = { tags: [{ id: 'st1', name: 'fantasy', folder_type: 'OPEN', color: '#123' }, { id: 'st2', name: 'Sci-fi', folder_type: 'CLOSED', is_hidden_on_character_card: true }], tag_map: { 'x.png': ['st1'] } };
    const parsed = parseTagBackup(st)!;
    expect(parsed.map).toBeUndefined();
    const { data: d, added } = mergeTagBackup(data(), parsed, new Set(['a']), () => 'n1');
    expect(added).toBe(1);
    expect(d.tags.find((t) => t.id === 'fantasy')).toMatchObject({ color: '#123', folder: 'open' });
    expect(d.tags.find((t) => t.id === 'n1')).toMatchObject({ name: 'Sci-fi', folder: 'closed', hideOnCard: true, order: 2 });
  });

  it("merges a UCCB backup's card assignments for cards you have", () => {
    const backup = { tags: [{ id: 'old', name: 'Elf', folder: 'none', order: 0, createdAt: 1 }], map: { a: ['old'], zz: ['old'] } };
    const { data: d } = mergeTagBackup(data(), parseTagBackup(backup)!, new Set(['a', 'b']), () => 'n1');
    expect(d.map.a).toEqual(['fantasy', 'n1']);
    expect(d.map.zz).toBeUndefined();
  });
});

describe('tags route', { timeout: 30_000 }, () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-tags-'));
    process.env.UCCB_DATA_DIR = dir;
    vi.stubGlobal('fetch', routeFetch);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty, and keeps what is saved (cleaned)', async () => {
    expect(await (await fetch('/api/tags')).json()).toEqual(EMPTY_TAG_DATA);
    const put = await fetch('/api/tags', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data(), map: { a: ['fantasy', 'bogus'] } }) });
    expect(put.ok).toBe(true);
    const got = (await (await fetch('/api/tags')).json()) as AppTagData;
    expect(got.map).toEqual({ a: ['fantasy'] });
    expect(got.tags.map((t) => t.id)).toEqual(['fantasy', 'nsfw']);
  });
});
