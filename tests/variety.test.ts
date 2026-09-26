import { describe, expect, it } from 'vitest';
import { hasVariety, varietySigma, varietyWasOn } from '@/lib/variety';
import { NovelAIModel } from '@/types/novelai';

describe('hasVariety', () => {
  it('follows NovelAI’s model table', () => {
    for (const model of [
      'nai-diffusion-4-5-full',
      'nai-diffusion-4-5-curated',
      'nai-diffusion-4-full',
      'nai-diffusion-4-curated-preview',
      'nai-diffusion-3',
      'nai-diffusion-furry-3',
    ] as NovelAIModel[]) {
      expect(hasVariety(model)).toBe(true);
    }
    // V5 doesn't offer it, which is NovelAI's rule.
    expect(hasVariety('nai-diffusion-5-full')).toBe(false);
    expect(hasVariety('nai-diffusion-5-curated')).toBe(false);
  });
});

describe('varietySigma', () => {
  it('is null while the toggle is off', () => {
    expect(varietySigma('nai-diffusion-4-5-full', false, 832, 1216)).toBeNull();
  });

  it('is null on a model without it, even when on', () => {
    expect(varietySigma('nai-diffusion-5-full', true, 832, 1216)).toBeNull();
  });

  it('is the model’s own sigma at the reference size', () => {
    // Captured from novelai.net: V3 at 832x1216 sends exactly 19.
    expect(varietySigma('nai-diffusion-3', true, 832, 1216)).toBe(19);
    expect(varietySigma('nai-diffusion-4-full', true, 832, 1216)).toBe(19);
    expect(varietySigma('nai-diffusion-4-5-full', true, 832, 1216)).toBe(58);
    // Portrait or landscape, it's the same area.
    expect(varietySigma('nai-diffusion-4-5-full', true, 1216, 832)).toBe(58);
  });

  it('matches the value novelai.net sent for a 1248x1824 request', () => {
    // Its client rounds the size to 1280x1856 first, then scales:
    // 58 * sqrt(160*232 / 15808). Captured 2026-09-19.
    expect(varietySigma('nai-diffusion-4-5-full', true, 1248, 1824)).toBe(88.87784456804029);
  });

  it('rounds the size to the 64 grid before scaling, as the request is sent', () => {
    expect(varietySigma('nai-diffusion-4-5-full', true, 1248, 1824)).toBe(
      varietySigma('nai-diffusion-4-5-full', true, 1280, 1856),
    );
  });

  it('grows with the area', () => {
    const small = varietySigma('nai-diffusion-4-5-full', true, 512, 512)!;
    const big = varietySigma('nai-diffusion-4-5-full', true, 1536, 1536)!;
    expect(small).toBeLessThan(58);
    expect(big).toBeGreaterThan(58);
    // Doubling both sides doubles the sigma.
    expect(varietySigma('nai-diffusion-4-5-full', true, 1024, 1024)!).toBeCloseTo(
      varietySigma('nai-diffusion-4-5-full', true, 512, 512)! * 2,
      10,
    );
  });
});

describe('varietyWasOn', () => {
  it('reads the setting back off a request', () => {
    expect(varietyWasOn(88.87784456804029)).toBe(true);
    expect(varietyWasOn(null)).toBe(false);
    expect(varietyWasOn(undefined)).toBe(false);
    expect(varietyWasOn(0)).toBe(false);
  });
});
