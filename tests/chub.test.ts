import { afterEach, describe, expect, it, vi } from 'vitest';
import { chubCharacter, chubCharacterId, chubLink, chubLinkCharacter } from '@/lib/server/chub';

describe('Chub links', () => {
  it('reads character links and bare paths, as SillyTavern does', () => {
    expect(chubCharacterId('https://chub.ai/characters/someone/a-knight-1234')).toBe('someone/a-knight-1234');
    expect(chubCharacterId('https://www.chub.ai/characters/someone/a-knight?tab=x#top')).toBe('someone/a-knight');
    expect(chubCharacterId('https://characterhub.org/characters/someone/a-knight')).toBe('someone/a-knight');
    expect(chubCharacterId('https://venus.chub.ai/characters/someone/a-knight')).toBe('someone/a-knight');
    expect(chubCharacterId('someone/a-knight')).toBe('someone/a-knight');
  });

  it("reads Cardbox's links (Chub's mirror) as the same characters", () => {
    expect(chubLink('https://cardbox.moe/characters/kenv/serene-white-mage-97239a087c03')).toEqual({ id: 'kenv/serene-white-mage-97239a087c03', source: 'Cardbox', apiBase: 'https://cardbox.moe/gateway' });
    expect(chubLink('https://chub.ai/characters/kenv/serene-white-mage-97239a087c03')).toEqual({ id: 'kenv/serene-white-mage-97239a087c03', source: 'Chub' });
    expect(chubLink('https://notcardbox.moe/characters/a/b')).toBeNull();
  });

  it('turns down other links, lorebooks and odd paths', () => {
    expect(chubCharacterId('https://example.com/characters/someone/a-knight')).toBeNull();
    expect(chubCharacterId('https://notchub.ai/characters/someone/a-knight')).toBeNull();
    expect(chubCharacterId('https://chub.ai/lorebooks/someone/a-world')).toBeNull();
    expect(chubCharacterId('https://chub.ai/characters/someone')).toBeNull();
    expect(chubCharacterId('https://chub.ai/characters/some/../../etc')).toBeNull();
  });
});

describe('a Chub character as a card', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps Chub's fields to the card's and fetches the picture from Chub only", async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const u = String(url);
      fetched.push(u);
      if (u.startsWith('https://api.chub.ai/')) {
        return Response.json({
          node: {
            topics: ['fantasy', 'knight'],
            max_res_url: 'https://avatars.charhub.io/avatars/someone/a-knight/chara_card_v2.png',
            definition: {
              name: 'Sir Test',
              personality: 'The description.',
              tavern_personality: 'Brave.',
              description: 'Creator notes here.',
              first_message: 'Hail!',
              alternate_greetings: ['Well met.'],
              embedded_lorebook: { entries: [] },
            },
          },
        });
      }
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    });
    const r = await chubCharacter('someone/a-knight');
    const data = (r.card as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ name: 'Sir Test', description: 'The description.', personality: 'Brave.', creator_notes: 'Creator notes here.', first_mes: 'Hail!', alternate_greetings: ['Well met.'], tags: ['fantasy', 'knight'], creator: 'someone', character_book: { entries: [] } });
    expect(r.avatar?.type).toBe('image/png');
    expect(fetched[0]).toBe('https://api.chub.ai/api/characters/someone/a-knight?full=true');
  });

  it('skips a picture that isn’t on Chub', async () => {
    vi.stubGlobal('fetch', async (url: string | URL) =>
      String(url).startsWith('https://api.chub.ai/') ? Response.json({ node: { definition: { name: 'X' }, max_res_url: 'https://evil.example/x.png' } }) : new Response('nope'),
    );
    const r = await chubCharacter('someone/x');
    expect(r.avatar).toBeUndefined();
  });
});

describe('fetching a link', () => {
  afterEach(() => vi.unstubAllGlobals());
  const node = { node: { definition: { name: 'Avery' } } };
  /** Answers each API (by its start) with a status; records what was asked. */
  const apis = (answers: Record<string, number>) => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const u = String(url);
      asked.push(u);
      const [, status] = Object.entries(answers).find(([start]) => u.startsWith(start)) ?? ['', 404];
      return status === 200 ? Response.json(node) : new Response('no', { status });
    });
    return asked;
  };

  it("fetches a Cardbox link through Cardbox, which has cards Chub hides", async () => {
    const asked = apis({ 'https://cardbox.moe/gateway/': 200, 'https://api.chub.ai/': 404 });
    const r = await chubLinkCharacter('https://cardbox.moe/characters/marcnen/avery-6dd5e06acae5');
    expect(r?.source).toBe('Cardbox');
    expect(asked).toEqual(['https://cardbox.moe/gateway/api/characters/marcnen/avery-6dd5e06acae5?full=true']);
  });

  it("falls back to Chub when Cardbox can't be reached, but not when it hasn't the card", async () => {
    apis({ 'https://cardbox.moe/gateway/': 502, 'https://api.chub.ai/': 200 });
    expect((await chubLinkCharacter('https://cardbox.moe/characters/a/b'))?.source).toBe('Cardbox (from Chub)');
    const asked = apis({ 'https://cardbox.moe/gateway/': 404, 'https://api.chub.ai/': 200 });
    await expect(chubLinkCharacter('https://cardbox.moe/characters/a/b')).rejects.toThrow('Cardbox has no character at a/b.');
    expect(asked).toHaveLength(1);
  });

  it('says a card Chub lacks may be hidden there, and leaves other links alone', async () => {
    apis({ 'https://api.chub.ai/': 404 });
    await expect(chubLinkCharacter('https://chub.ai/characters/a/b')).rejects.toThrow(/hidden where you are.*cardbox\.moe/);
    expect(await chubLinkCharacter('https://example.com/characters/a/b')).toBeNull();
  });
});
