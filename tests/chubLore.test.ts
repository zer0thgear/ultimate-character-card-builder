import { afterEach, describe, expect, it, vi } from 'vitest';
import { bankCopyOf, chubLoreLinks, missingChubLore } from '@/lib/chubLore';
import { combineLorebooks, lorebooksInPlay, newBankLorebook } from '@/lib/lorebookBank';
import { newEntry, newLorebook } from '@/lib/cardSpec';
import { chubLorebook } from '@/lib/server/chub';
import type { BankLorebook } from '@/types/project';

afterEach(() => vi.unstubAllGlobals());

const link = (path: string, id = 1) => ({ id, book: null, path, version: 'main', commit_ref: 'main' });
const card = { extensions: { chub: { related_lorebooks: [link('lorebooks/arachnutron/diary-0867', 4743152), link('lorebooks/arachnutron/disorders-d3ae'), link('lorebooks/arachnutron/diary-0867'), link('characters/x/y'), { path: 3 }] } } };
const book = (name: string, content = name) => ({ ...newLorebook(), name, entries: [{ ...newEntry(), keys: ['k'], content }] });

describe("Chub's linked lorebooks", () => {
  it('reads the lorebooks a card links, each once', () => {
    expect(chubLoreLinks(card)).toEqual([{ path: 'lorebooks/arachnutron/diary-0867', id: 4743152 }, { path: 'lorebooks/arachnutron/disorders-d3ae', id: 1 }]);
    expect(chubLoreLinks({})).toEqual([]);
    expect(chubLoreLinks({ extensions: { chub: { related_lorebooks: [] } } })).toEqual([]);
  });

  it("knows which aren't fetched or linked yet", () => {
    const diary: BankLorebook = { ...newBankLorebook(book('Diary')), chub: { path: 'lorebooks/arachnutron/diary-0867' } };
    expect(bankCopyOf([diary], 'lorebooks/ARACHNUTRON/diary-0867')).toBe(diary);
    // In the bank but not linked: still missing; linked: not.
    expect(missingChubLore(card, [], [diary]).map((m) => m.path)).toEqual(['lorebooks/arachnutron/diary-0867', 'lorebooks/arachnutron/disorders-d3ae']);
    expect(missingChubLore(card, [diary.id], [diary]).map((m) => m.path)).toEqual(['lorebooks/arachnutron/disorders-d3ae']);
  });

  it("puts a card's linked lorebooks in its chats, after its own", () => {
    const linked = newBankLorebook(book('Linked'));
    const global = newBankLorebook(book('Global'));
    const persona = newBankLorebook(book('Persona'));
    const attached = lorebooksInPlay([linked, global, persona], { personaLorebookId: persona.id, cardLorebookIds: [linked.id, 'deleted'], globalIds: [global.id, linked.id] });
    expect(attached.map((a) => [a.name, a.source])).toEqual([
      ['Persona', 'persona'],
      ['Linked', 'card'],
      ['Global', 'global'],
    ]);
    const all = combineLorebooks(book('Own'), attached);
    expect(all?.entries.map((e) => e.content)).toEqual(['Persona', 'Own', 'Linked', 'Global']);
  });

  it('fetches a lorebook from Chub, or from Cardbox when Chub won’t give it', async () => {
    const reply = { node: { id: 4743152, name: "Sachiko's Diary", definition: { embedded_lorebook: { entries: [{ keys: ['diary'], content: 'An entry.' }] } } } };
    const fetch = vi.fn(async (url: string) => (url.startsWith('https://api.chub.ai') ? new Response('This service is not available in your country.', { status: 403 }) : Response.json(reply)));
    vi.stubGlobal('fetch', fetch);
    const got = await chubLorebook('lorebooks/arachnutron/sachiko-s-diary-08671d164ada');
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://api.chub.ai/api/lorebooks/arachnutron/sachiko-s-diary-08671d164ada?full=true',
      'https://cardbox.moe/gateway/api/lorebooks/arachnutron/sachiko-s-diary-08671d164ada?full=true',
    ]);
    expect(got.book.name).toBe("Sachiko's Diary");
    expect(got.book.entries[0].content).toBe('An entry.');
    expect(got.id).toBe(4743152);
    expect(got.source).toMatch(/^Cardbox/);
    await expect(chubLorebook('characters/a/b')).rejects.toThrow(/isn't a Chub lorebook path/);
  });

  it("says Chub's refusal when neither has it", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(chubLorebook('lorebooks/a/b')).rejects.toThrow('Chub has no lorebook at lorebooks/a/b.');
  });
});
