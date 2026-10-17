import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanHeaders, headerAllowed } from '@/lib/connectionHeaders';
import { listModels, streamChat } from '@/lib/server/llm';
import { backendOptions } from '@/lib/server/imageBackends';

afterEach(() => vi.unstubAllGlobals());

const ACCESS = { 'CF-Access-Client-Id': 'id.access', 'CF-Access-Client-Secret': 'shh' };

describe("connections' extra headers", () => {
  it('keeps the ones that can be sent', () => {
    expect(cleanHeaders({ ...ACCESS, 'X-Blank': '  ' })).toEqual({ ...ACCESS, 'X-Blank': '' });
    // UCCB sets these itself; bad names and values that could split the request go.
    expect(cleanHeaders({ Host: 'evil', 'content-type': 'x', 'Bad Name': 'v', 'X-Split': 'a\r\nInjected: 1', 'X-Num': 3 })).toEqual({});
    expect(cleanHeaders(null)).toEqual({});
    expect(cleanHeaders(['x'])).toEqual({});
    expect(headerAllowed('CF-Access-Client-Id')).toBe(true);
    expect(headerAllowed('Content-Length')).toBe(false);
  });

  it('sends them with LLM requests, under the key', async () => {
    const fetch = vi.fn(async () => new Response('data: [DONE]\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const connection = { kind: 'openai' as const, baseUrl: 'https://kobold.example.com/v1', apiKey: 'k', model: 'm', params: { max_tokens: 5 }, headers: { ...ACCESS, Authorization: 'not this', 'Content-Type': 'nor this' } };
    for await (const e of streamChat({ connection, messages: [{ role: 'user', content: 'Hi' }] }, new AbortController().signal)) void e;
    const sent = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(sent).toMatchObject({ ...ACCESS, Authorization: 'Bearer k', 'Content-Type': 'application/json' });

    fetch.mockImplementation(async () => Response.json({ data: [{ id: 'b' }, { id: 'a' }] }));
    expect(await listModels(connection)).toEqual(['a', 'b']);
    expect((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toMatchObject(ACCESS);
  });

  it('sends them to image servers too', async () => {
    const fetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', fetch);
    await backendOptions({ kind: 'a1111', baseUrl: 'https://forge.example.com', auth: 'me:pw', workflow: null, headers: ACCESS });
    for (const call of fetch.mock.calls) {
      const sent = (call as unknown as [string, RequestInit])[1].headers as Record<string, string>;
      expect(sent).toMatchObject({ ...ACCESS, Authorization: `Basic ${Buffer.from('me:pw').toString('base64')}` });
    }
    expect(fetch).toHaveBeenCalled();
  });
});
