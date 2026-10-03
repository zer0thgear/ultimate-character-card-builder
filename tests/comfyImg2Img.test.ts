import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { backendGenerate } = await import('@/lib/server/imageBackends');

afterEach(() => vi.unstubAllGlobals());

describe('ComfyUI Img2Img on the server', () => {
  it('uploads the base, then queues the workflow with it', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        if (url.endsWith('/upload/image')) return Response.json({ name: 'uccb-base.png', subfolder: '', type: 'input' });
        if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'p1' });
        if (url.includes('/history/')) return Response.json({ p1: { status: { completed: true, status_str: 'success' }, outputs: { '9': { images: [{ filename: 'o.png', subfolder: '', type: 'temp' }] } } } });
        if (url.includes('/view?')) return new Response(new Uint8Array([137, 80, 78, 71]));
        return new Response('?', { status: 404 });
      }),
    );
    const out = await backendGenerate(
      { kind: 'comfyui', baseUrl: 'http://127.0.0.1:8188', auth: '', workflow: null },
      { prompt: 'p', negative: 'n', width: 512, height: 768, steps: 20, cfg: 5, seed: 1, checkpoint: 'm.safetensors', sampler: '', scheduler: '', init: { image: Buffer.from('png').toString('base64'), strength: 0.4 } },
    );
    expect(out[0][0]).toBe(137);
    const upload = calls[0];
    expect(upload.url).toBe('http://127.0.0.1:8188/upload/image');
    expect(upload.init.body).toBeInstanceOf(FormData);
    expect((upload.init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    const queued = JSON.parse(String(calls[1].init.body)).prompt;
    expect(queued.uccb_base.inputs.image).toBe('uccb-base.png');
    expect(queued['3'].inputs.denoise).toBe(0.4);
  }, 10_000);
});
