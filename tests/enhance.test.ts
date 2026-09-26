import { describe, expect, it } from 'vitest';
import {
  addEnhancePrompt,
  enhanceOutputSize,
  enhancePriceSize,
  enhanceRequestSize,
  enhanceScales,
  ENHANCE_LEVELS,
} from '@/lib/enhance';

describe('ENHANCE_LEVELS', () => {
  it('is NovelAI’s five magnitudes, only the last adding noise', () => {
    expect(ENHANCE_LEVELS.map((l) => l.strength)).toEqual([0.2, 0.4, 0.5, 0.6, 0.7]);
    expect(ENHANCE_LEVELS.map((l) => l.noise)).toEqual([0, 0, 0, 0, 0.1]);
  });
});

describe('enhanceScales', () => {
  it('offers only 1.5x and 1x for the two standard sizes', () => {
    expect(enhanceScales(832, 1216, 'nai-diffusion-4-5-full')).toEqual([1.5, 1]);
    expect(enhanceScales(1216, 832, 'nai-diffusion-4-5-full')).toEqual([1.5, 1]);
  });

  it('adds Max on V5, below about 2.5 MP', () => {
    expect(enhanceScales(832, 1216, 'nai-diffusion-5-full')).toEqual(['max', 1.5, 1]);
    // 1536x1664 is 2,555,904 px, over the Max threshold.
    expect(enhanceScales(1536, 1664, 'nai-diffusion-5-full')).not.toContain('max');
  });

  it('offers 2x for other sizes when it stays within 3.1 MP on a 64 grid', () => {
    expect(enhanceScales(640, 640, 'nai-diffusion-4-5-full')).toEqual([2, 1.5, 1]);
    // 1.5x of 1024 is 1536 (a multiple of 64) but 2x would be 4.2 MP.
    expect(enhanceScales(1024, 1024, 'nai-diffusion-4-5-full')).toEqual([1.5, 1]);
  });

  it('drops 1.5x when it would land off the 64 grid', () => {
    // 1.5x of 704 is 1056, not a multiple of 64.
    expect(enhanceScales(704, 704, 'nai-diffusion-4-5-full')).toEqual([2, 1]);
  });
});

describe('enhanceRequestSize', () => {
  it('multiplies and rounds down, leaving the 64 grid to finalizeRequest', () => {
    // The live-verified case: NovelAI resizes to 1248x1824 and sends 1280x1856.
    expect(enhanceRequestSize(832, 1216, 1.5)).toEqual({ width: 1248, height: 1824 });
    expect(enhancePriceSize(832, 1216, 1.5)).toEqual({ width: 1280, height: 1856 });
  });

  it('keeps the image’s own size for Max', () => {
    expect(enhanceRequestSize(832, 1216, 'max')).toEqual({ width: 832, height: 1216 });
  });
});

describe('Max enhance sizes', () => {
  it('prices Max at the server’s size, within 3.1 MP', () => {
    const price = enhancePriceSize(832, 1216, 'max');
    expect(price.width * price.height).toBeLessThanOrEqual(3145728);
    expect(price.width % 32).toBe(0);
    expect(price.height % 32).toBe(0);
  });

  it('expects up to 2x back, capped at 3.1 MP', () => {
    // 832x1216 doubled is 4 MP, so it comes back scaled into the cap.
    const out = enhanceOutputSize(832, 1216, 'max');
    expect(out.width * out.height).toBeLessThanOrEqual(3145728);
    expect(out.width).toBeGreaterThan(832);
    // A small image has room for the full 2x.
    expect(enhanceOutputSize(512, 512, 'max')).toEqual({ width: 1024, height: 1024 });
  });
});

describe('addEnhancePrompt', () => {
  const ADD = ', -2::upscaled, blurry::,';

  it('adds the negative weight on V4.5 and V5', () => {
    expect(addEnhancePrompt('1girl', 'nai-diffusion-5-full', 1.5)).toBe(`1girl${ADD}`);
    expect(addEnhancePrompt('1girl', 'nai-diffusion-4-5-full', 1.5)).toBe(`1girl${ADD}`);
  });

  it('leaves older models and Max alone', () => {
    expect(addEnhancePrompt('1girl', 'nai-diffusion-4-full', 1.5)).toBe('1girl');
    expect(addEnhancePrompt('1girl', 'nai-diffusion-3', 1.5)).toBe('1girl');
    expect(addEnhancePrompt('1girl', 'nai-diffusion-5-full', 'max')).toBe('1girl');
  });

  it('splices it in before a text: section', () => {
    // NovelAI splices at the match, which starts on the separator before
    // "text:", so its own output has the doubled comma too.
    expect(addEnhancePrompt('1girl, text: hello', 'nai-diffusion-5-full', 2)).toBe(`1girl,${ADD} text: hello`);
  });

  it('does not double up', () => {
    const once = addEnhancePrompt('1girl', 'nai-diffusion-5-full', 1.5);
    expect(addEnhancePrompt(once, 'nai-diffusion-5-full', 1.5)).toBe(once);
  });
});
