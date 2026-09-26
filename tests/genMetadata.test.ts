import { describe, expect, it } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import { genInfoFromChunks, readStealth, genInfoFromStealth } from '@/lib/genMetadata';

const comment = {
  prompt: 'old prompt',
  seed: 123,
  steps: 28,
  scale: 5,
  sampler: 'k_euler',
  request_type: 'PromptGenerateRequest',
  v4_prompt: { caption: { base_caption: 'base', char_captions: [{ char_caption: 'girl' }] } },
  v4_negative_prompt: { caption: { base_caption: 'bad', char_captions: [{ char_caption: 'ugly' }] } },
};

describe('genInfoFromChunks', () => {
  it('reads NovelAI V4 metadata', () => {
    const info = genInfoFromChunks([
      { keyword: 'Comment', text: JSON.stringify(comment) },
      { keyword: 'Source', text: 'NovelAI Diffusion V4.5 4BDE2A90' },
    ]);
    expect(info).toMatchObject({ prompt: 'base', negative: 'bad', model: 'NovelAI Diffusion V4.5', seed: 123, requestType: 'txt2img', source: 'novelai' });
    expect(info.characters).toEqual([{ prompt: 'girl', uc: 'ugly' }]);
  });

  it('reads A1111 parameters', () => {
    const info = genInfoFromChunks([
      { keyword: 'parameters', text: 'a cat\nNegative prompt: dog\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 99, Model: foo' },
    ]);
    expect(info).toMatchObject({ prompt: 'a cat', negative: 'dog', seed: 99, steps: 20, sampler: 'Euler a', model: 'foo', source: 'a1111' });
  });
});

describe('stealth metadata', () => {
  it('reads the alpha-LSB copy, column by column', async () => {
    const payload = gzipSync(Buffer.from(JSON.stringify({ Comment: JSON.stringify(comment), Software: 'NovelAI' })));
    const bits: number[] = [];
    const push = (bytes: Uint8Array) => {
      for (const b of bytes) for (let k = 7; k >= 0; k--) bits.push((b >> k) & 1);
    };
    push(new TextEncoder().encode('stealth_pngcomp'));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, payload.length * 8);
    push(len);
    push(payload);
    const width = 64;
    const height = Math.ceil(bits.length / width) + 1;
    const data = new Uint8Array(width * height * 4).fill(255);
    bits.forEach((bit, i) => {
      const x = Math.floor(i / height);
      const y = i % height;
      data[(y * width + x) * 4 + 3] = 254 | bit;
    });
    const stealth = await readStealth({ width, height, data }, async (b) => gunzipSync(b));
    expect(genInfoFromStealth(stealth!)).toMatchObject({ prompt: 'base', seed: 123, source: 'novelai-stealth' });
  });
});
