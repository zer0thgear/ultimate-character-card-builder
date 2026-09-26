import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, NovelAIError, novelAIError } from '@/lib/apiRetry';

/** A fetch that answers with the given statuses in order, then 200. */
function fakeFetch(statuses: (number | 'network')[], headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const next = statuses.shift();
    if (next === 'network') throw new TypeError('Failed to fetch');
    return new Response('{}', { status: next ?? 200, headers });
  });
  return { fn, calls };
}

const install = (fn: typeof fetch) => {
  globalThis.fetch = fn;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchWithRetry', () => {
  // The waits are handed in, so the tests don't actually sleep.
  const waited: number[] = [];
  const opts = () => {
    waited.length = 0;
    return { wait: async (ms: number) => void waited.push(ms) };
  };

  it('returns the first response when nothing needs retrying', async () => {
    const { fn } = fakeFetch([200]);
    install(fn as unknown as typeof fetch);
    const res = await fetchWithRetry('https://x/y', {}, opts());
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry an error that retrying cannot fix', async () => {
    for (const status of [400, 401, 402, 404, 500]) {
      const { fn } = fakeFetch([status]);
      install(fn as unknown as typeof fetch);
      const res = await fetchWithRetry('https://x/y', {}, opts());
      expect(res.status).toBe(status);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it('retries a rate limit and returns the eventual success', async () => {
    const { fn } = fakeFetch([429, 429, 200]);
    install(fn as unknown as typeof fetch);
    const options = opts();
    const res = await fetchWithRetry('https://x/y', {}, options);
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(waited).toEqual([2000, 5000]);
  });

  it('retries gateway errors too', async () => {
    for (const status of [502, 503, 504, 520, 522, 524]) {
      const { fn } = fakeFetch([status, 200]);
      install(fn as unknown as typeof fetch);
      await fetchWithRetry('https://x/y', {}, opts());
      expect(fn).toHaveBeenCalledTimes(2);
    }
  });

  it('gives up after the last attempt and returns the failure', async () => {
    const { fn } = fakeFetch([429, 429, 429, 429]);
    install(fn as unknown as typeof fetch);
    const options = opts();
    const res = await fetchWithRetry('https://x/y', {}, options);
    expect(res.status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(4); // the first try plus three retries
    expect(waited).toEqual([2000, 5000, 12000]);
  });

  it('honours a Retry-After it is willing to wait', async () => {
    const { fn } = fakeFetch([429, 200], { 'retry-after': '7' });
    install(fn as unknown as typeof fetch);
    const options = opts();
    await fetchWithRetry('https://x/y', {}, options);
    expect(waited).toEqual([7000]);
  });

  it('ignores a Retry-After that is absurd or unreadable', async () => {
    for (const header of ['600', 'soon', '-5']) {
      const { fn } = fakeFetch([429, 200], { 'retry-after': header });
      install(fn as unknown as typeof fetch);
      const options = opts();
      await fetchWithRetry('https://x/y', {}, options);
      expect(waited).toEqual([2000]);
    }
  });

  it('retries a dropped connection, and rethrows if it keeps dropping', async () => {
    const { fn } = fakeFetch(['network', 200]);
    install(fn as unknown as typeof fetch);
    await expect(fetchWithRetry('https://x/y', {}, opts())).resolves.toMatchObject({ status: 200 });

    const dead = fakeFetch(['network', 'network', 'network', 'network']);
    install(dead.fn as unknown as typeof fetch);
    await expect(fetchWithRetry('https://x/y', {}, opts())).rejects.toThrow('Failed to fetch');
  });

  it('passes an abort straight back, without retrying', async () => {
    const fn = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    install(fn as unknown as typeof fetch);
    await expect(fetchWithRetry('https://x/y', {}, opts())).rejects.toThrow('aborted');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when the run was stopped', async () => {
    const { fn } = fakeFetch([429, 429, 200]);
    install(fn as unknown as typeof fetch);
    const res = await fetchWithRetry('https://x/y', {}, { ...opts(), shouldStop: () => true });
    expect(res.status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reports each wait so the UI can say what it is doing', async () => {
    const { fn } = fakeFetch([429, 503, 200]);
    install(fn as unknown as typeof fetch);
    const notices: string[] = [];
    await fetchWithRetry('https://x/y', {}, {
      ...opts(),
      onRetry: (n) => notices.push(`${n.reason} ${n.attempt}/${n.of} in ${n.waitMs}`),
    });
    expect(notices).toEqual(['Rate limited 1/3 in 2000', 'Server error (503) 2/3 in 5000']);
  });
});

describe('novelAIError', () => {
  const res = (status: number, body: unknown = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('marks a bad key or an empty balance as fatal', async () => {
    expect(await novelAIError(res(401))).toMatchObject({ fatal: true, message: 'Invalid API key.' });
    expect(await novelAIError(res(402))).toMatchObject({ fatal: true });
  });

  it('marks a rejected request as fatal, and includes what it said', async () => {
    const err = await novelAIError(res(400, { message: 'bad size' }));
    expect(err.fatal).toBe(true);
    expect(err.message).toContain('bad size');
  });

  it('marks an exhausted rate limit as worth skipping past, not stopping for', async () => {
    expect(await novelAIError(res(429))).toMatchObject({ fatal: false });
    expect(await novelAIError(res(503))).toMatchObject({ fatal: false });
  });

  it('names what failed', async () => {
    expect((await novelAIError(res(400), 'Upscale')).message).toContain('Upscale failed');
  });

  it('survives a response that is not JSON', async () => {
    const err = await novelAIError(new Response('<html>oops</html>', { status: 400 }));
    expect(err).toBeInstanceOf(NovelAIError);
    expect(err.status).toBe(400);
  });
});
