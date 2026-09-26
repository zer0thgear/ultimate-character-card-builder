import { describe, expect, it } from 'vitest';
import { calculateAnlasCost, directorToolCost, upscaleCost } from '@/lib/anlasCost';

// The prices NovelAI's own UI shows, which the formulas were checked against.
const base = { width: 832, height: 1216, smea: false, smeaDyn: false, isOpus: false };

describe('calculateAnlasCost', () => {
  it('matches the prices NovelAI displays', () => {
    expect(calculateAnlasCost({ ...base, model: 'nai-diffusion-5-curated', steps: 30 })).toBe(32);
    expect(calculateAnlasCost({ ...base, model: 'nai-diffusion-4-5-full', steps: 30 })).toBe(21);
  });

  it('prices the 4-image V5 batch that was generated live at 78', () => {
    // One free sample under Opus, three paid at 26 each.
    const cost = calculateAnlasCost({
      ...base,
      model: 'nai-diffusion-5-full',
      steps: 23,
      nSamples: 4,
      isOpus: true,
    });
    expect(cost).toBe(78);
  });

  it('charges V5 half as much again as V4.5', () => {
    const v45 = calculateAnlasCost({ ...base, model: 'nai-diffusion-4-5-full', steps: 28 });
    const v5 = calculateAnlasCost({ ...base, model: 'nai-diffusion-5-full', steps: 28 });
    expect(v5).toBe(Math.max(Math.ceil(v45 * 1.5), 2));
  });

  it('applies the SMEA factors', () => {
    const plain = calculateAnlasCost({ ...base, model: 'nai-diffusion-3', steps: 28 });
    const smea = calculateAnlasCost({ ...base, model: 'nai-diffusion-3', steps: 28, smea: true });
    const dyn = calculateAnlasCost({ ...base, model: 'nai-diffusion-3', steps: 28, smea: true, smeaDyn: true });
    expect(smea).toBe(Math.ceil(plain * 1.2));
    expect(dyn).toBe(Math.ceil(plain * 1.4));
  });

  it('scales with img2img strength, never below 2', () => {
    const full = calculateAnlasCost({ ...base, model: 'nai-diffusion-5-full', steps: 28 });
    const half = calculateAnlasCost({ ...base, model: 'nai-diffusion-5-full', steps: 28, strength: 0.5 });
    expect(half).toBe(Math.ceil(full * 0.5));
    expect(calculateAnlasCost({ ...base, model: 'nai-diffusion-3', steps: 1, strength: 0.01 })).toBe(2);
  });

  describe('the free Opus sample', () => {
    const opus = { ...base, model: 'nai-diffusion-5-full' as const, width: 1024, height: 1024, isOpus: true };

    it('makes a single image free at up to 1 MP and 28 steps', () => {
      expect(calculateAnlasCost({ ...opus, steps: 28 })).toBe(0);
    });

    it('covers exactly one image of a batch', () => {
      const one = calculateAnlasCost({ ...opus, steps: 28, isOpus: false });
      expect(calculateAnlasCost({ ...opus, steps: 28, nSamples: 4 })).toBe(one * 3);
    });

    it('does not apply past 28 steps or past 1 MP', () => {
      expect(calculateAnlasCost({ ...opus, steps: 29 })).toBeGreaterThan(0);
      expect(calculateAnlasCost({ ...opus, steps: 28, width: 1088 })).toBeGreaterThan(0);
    });

    it('stops covering V5 once the allowance is used up, but still covers V4.5', () => {
      expect(calculateAnlasCost({ ...opus, steps: 28, opusExhausted: true })).toBeGreaterThan(0);
      expect(
        calculateAnlasCost({ ...opus, model: 'nai-diffusion-4-5-full', steps: 28, opusExhausted: true }),
      ).toBe(0);
    });
  });
});

describe('upscaleCost', () => {
  it('is a flat price by input size', () => {
    expect(upscaleCost(1024, 1024)).toBe(1); // exactly 1 MP
    expect(upscaleCost(832, 1216)).toBe(1); // just under it
    expect(upscaleCost(1024, 1216)).toBe(2);
    expect(upscaleCost(1536, 2048)).toBe(4); // exactly 3.1 MP
  });

  it('is unavailable past 3.1 MP', () => {
    expect(upscaleCost(1536, 2112)).toBeNull();
  });
});

describe('directorToolCost', () => {
  it('prices a tool as a 28-step V3 generation, free for Opus at 1 MP', () => {
    expect(directorToolCost('lineart', 1024, 1024, { isOpus: true })).toBe(0);
    expect(directorToolCost('lineart', 1024, 1024, { isOpus: false })).toBe(
      calculateAnlasCost({
        model: 'nai-diffusion-3',
        width: 1024,
        height: 1024,
        steps: 28,
        smea: false,
        smeaDyn: false,
        isOpus: false,
      }),
    );
  });

  it('scales a small image up to 1 MP before pricing', () => {
    expect(directorToolCost('lineart', 512, 512, { isOpus: false })).toBe(
      directorToolCost('lineart', 1024, 1024, { isOpus: false }),
    );
  });

  it('charges background removal 3x plus 5, with no Opus discount', () => {
    const plain = directorToolCost('lineart', 1024, 1024, { isOpus: false });
    expect(directorToolCost('bg-removal', 1024, 1024, { isOpus: true })).toBe(plain * 3 + 5);
  });
});
