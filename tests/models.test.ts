import { describe, expect, it } from 'vitest';
import { MODELS, maxCharacters, modelShortName } from '@/lib/models';

describe('MODELS', () => {
  it('lists every model the app supports, newest first', () => {
    expect(MODELS[0].value).toBe('nai-diffusion-5-full');
    expect(MODELS.map((m) => m.value)).toHaveLength(new Set(MODELS.map((m) => m.value)).size);
  });
});

describe('modelShortName', () => {
  it('drops the shared prefix', () => {
    expect(modelShortName('nai-diffusion-5-full')).toBe('V5 Full');
    expect(modelShortName('nai-diffusion-furry-3')).toBe('V3 (Furry)');
  });

  it('falls back to the id for anything unknown', () => {
    expect(modelShortName('nai-diffusion-9' as never)).toBe('nai-diffusion-9');
  });
});

describe('maxCharacters', () => {
  it('matches NovelAI’s model table', () => {
    expect(maxCharacters('nai-diffusion-5-full')).toBe(32);
    expect(maxCharacters('nai-diffusion-5-curated')).toBe(32);
    expect(maxCharacters('nai-diffusion-4-5-full')).toBe(6);
    expect(maxCharacters('nai-diffusion-4-full')).toBe(6);
  });
});
