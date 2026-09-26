import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { countPromptParts, countPromptTokens, loadTokenCounter, tokenBudget } from '@/lib/tokenCount';

// The counters load their vocab over fetch from /tokenizers/. In node there's
// no server, so serve public/ off the disk instead.
beforeAll(() => {
  globalThis.fetch = (async (input: string | URL) => {
    const path = fileURLToPath(new URL(`../public${String(input)}`, import.meta.url));
    const body = await readFile(path, 'utf8');
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) } as Response;
  }) as typeof fetch;
});

describe('tokenBudget', () => {
  it('is NovelAI’s tokenizer and limit per model', () => {
    expect(tokenBudget('nai-diffusion-5-full')).toEqual({ kind: 'qwen', limit: 1471 });
    expect(tokenBudget('nai-diffusion-5-curated')).toEqual({ kind: 'qwen', limit: 703 });
    expect(tokenBudget('nai-diffusion-4-5-full')).toEqual({ kind: 't5', limit: 512 });
    expect(tokenBudget('nai-diffusion-4-full')).toEqual({ kind: 't5', limit: 512 });
    expect(tokenBudget('nai-diffusion-3')).toEqual({ kind: 'clip', limit: 225, perPart: true });
    expect(tokenBudget('nai-diffusion-furry-3')).toEqual({ kind: 'clip', limit: 225, perPart: true });
  });
});

describe('countPromptParts', () => {
  // A stand-in counter, so this covers the splitting rules on their own.
  const byLength = (text: string) => text.length;

  it('counts one part for a plain prompt', () => {
    expect(countPromptParts(byLength, 'abcde')).toEqual([5]);
  });

  it('splits on single bars', () => {
    expect(countPromptParts(byLength, 'ab|cde')).toEqual([2, 3]);
  });

  it('keeps only the longest option of a random group, as NovelAI does', () => {
    // "x" plus the longest of "a" / "bbb".
    expect(countPromptParts(byLength, 'x||a|bbb||')).toEqual([4]);
  });

  it('stops at six parts, the rest counting as the last one', () => {
    expect(countPromptParts(byLength, 'a|b|c|d|e|f|g')).toEqual([1, 1, 1, 1, 1, 3]);
  });
});

describe('countPromptTokens', () => {
  const byLength = (text: string) => text.length;

  it('adds the parts up on V4+', () => {
    expect(countPromptTokens(byLength, 'ab|cde', tokenBudget('nai-diffusion-5-full')!)).toBe(5);
  });

  it('takes the largest part on V3, where each part has its own limit', () => {
    expect(countPromptTokens(byLength, 'ab|cde', tokenBudget('nai-diffusion-3')!)).toBe(3);
  });

  it('is 0 for empty text', () => {
    expect(countPromptTokens(byLength, '', tokenBudget('nai-diffusion-3')!)).toBe(0);
  });
});

// These counts come from the tokenizers as they stand, which were checked
// against NovelAI's own worker on 1,552 prompts (0 mismatches). They're here
// to catch the vocab files or the tokenizer code drifting, which would
// silently put the meters out of step with NovelAI's.
describe('the real tokenizers', () => {
  const prompt = '1girl, blue hair, {smile}, looking at viewer, masterpiece';

  it('counts with Qwen on V5', async () => {
    const count = await loadTokenCounter('qwen');
    expect(count(prompt)).toBe(15);
    expect(count('')).toBe(0);
  });

  it('counts with T5 on V4 and V4.5', async () => {
    const count = await loadTokenCounter('t5');
    expect(count(prompt)).toBe(14);
    // T5 always ends with its own sentinel, so even empty text counts as 1.
    expect(count('')).toBe(1);
  });

  it('counts with CLIP on V3', async () => {
    const count = await loadTokenCounter('clip');
    expect(count(prompt)).toBe(13);
    expect(count('')).toBe(0);
  });

  it('decodes HTML entities before counting, as NovelAI does, on CLIP', async () => {
    const count = await loadTokenCounter('clip');
    expect(count('&amp;')).toBe(count('&'));
  });

  it('caches the loaded counter', async () => {
    expect(await loadTokenCounter('qwen')).toBe(await loadTokenCounter('qwen'));
  });
});
