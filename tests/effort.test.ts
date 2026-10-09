import { describe, expect, it } from 'vitest';
import { hasEffort, isMediumEffort, MEDIUM_EFFORT, modelShortName, splitEffort, withEffort } from '@/lib/models';
import { buildImageRequest } from '@/lib/imageRequest';
import { buildEnhanceRequest, buildGenerateRequest, reuseFromMetadata } from '@/lib/genRequest';
import { calculateAnlasCost } from '@/lib/anlasCost';
import { toInpaintingModel } from '@/lib/inpaint';
import { composeNegativeWithUc, getUcText } from '@/lib/naiPresets';
import { readNaiMetadata, type ParsedNaiMetadata } from '@/lib/naiMetadata';
import { encodePng, withChunksAfterHeader } from '@/lib/requestImage';
import { useSettingsStore, type FormSettings } from '@/store/settingsStore';
import type { CharacterPromptEntry, GeneratedImage, NovelAIModel } from '@/types/novelai';

// V5 Full's Effort toggle (NovelAI, 2026-10-08), as zer0-novel-utilities read
// it from novelai.net's client and checked live: Medium is its own model,
// which fixes steps, sampler and the UC preset, has no CFG Rescale, and is
// priced with a factor on the per-step part.

describe('effort models', () => {
  it('only V5 Full has the toggle', () => {
    expect(hasEffort('nai-diffusion-5-full')).toBe(true);
    expect(hasEffort('nai-diffusion-5-full-medium')).toBe(true);
    expect(hasEffort('nai-diffusion-5-curated')).toBe(false);
    expect(hasEffort('nai-diffusion-4-5-full')).toBe(false);
  });

  it('switches V5 Full (and its inpainting model) to Medium and back, leaving others alone', () => {
    expect(withEffort('nai-diffusion-5-full', 'medium')).toBe('nai-diffusion-5-full-medium');
    expect(withEffort('nai-diffusion-5-full', 'high')).toBe('nai-diffusion-5-full');
    expect(withEffort('nai-diffusion-5-full-medium', 'high')).toBe('nai-diffusion-5-full');
    expect(withEffort('nai-diffusion-5-full-inpainting', 'medium')).toBe('nai-diffusion-5-full-medium-inpainting');
    expect(withEffort('nai-diffusion-5-curated', 'medium')).toBe('nai-diffusion-5-curated');
    expect(withEffort('nai-diffusion-5-full', undefined)).toBe('nai-diffusion-5-full');
  });

  it('inpaints Medium with its own inpainting model', () => {
    expect(toInpaintingModel('nai-diffusion-5-full-medium')).toBe('nai-diffusion-5-full-medium-inpainting');
    expect(isMediumEffort('nai-diffusion-5-full-medium-inpainting')).toBe(true);
  });

  it("reads an image's model back as V5 Full plus the effort, and names Medium after it", () => {
    expect(splitEffort('nai-diffusion-5-full-medium')).toEqual({ model: 'nai-diffusion-5-full', effort: 'medium' });
    expect(splitEffort('nai-diffusion-5-full')).toEqual({ model: 'nai-diffusion-5-full', effort: 'high' });
    expect(splitEffort('nai-diffusion-4-5-full')).toEqual({ model: 'nai-diffusion-4-5-full' });
    expect(modelShortName('nai-diffusion-5-full-medium')).toBe('V5 Full (Medium)');
  });
});

describe('a Medium effort request', () => {
  const character = (prompt: string, uc: string): CharacterPromptEntry => ({ id: prompt, prompt, uc, enabled: true, center: { x: 0.5, y: 0.5 } });
  const build = (model: NovelAIModel) =>
    buildImageRequest({
      input: '1girl, garden',
      negativePrompt: 'my own negative, hat',
      model,
      action: 'generate',
      characters: [character('girl', 'hat')],
      useCoords: false,
      presets: { quality: 'standard', uc: 'light' },
      parameters: {
        params_version: 4,
        width: 832,
        height: 1216,
        scale: 6,
        sampler: 'k_dpmpp_2m',
        steps: 28,
        cfg_rescale: 0.4,
        noise_schedule: 'exponential',
        n_samples: 1,
        seed: 1,
        add_original_image: true,
      },
    });

  it('fixes steps and sampler, leaves CFG Rescale out, and keeps the rest', () => {
    const p = build('nai-diffusion-5-full-medium').parameters;
    expect(p.steps).toBe(14);
    expect(p.sampler).toBe('k_euler_ancestral');
    // novelai.net's own Medium request has no cfg_rescale field at all.
    expect(p).not.toHaveProperty('cfg_rescale');
    expect(p.scale).toBe(6);
    expect(p.noise_schedule).toBe('exponential');
  });

  it("sends the Heavy UC preset's text alone, and no character negatives", () => {
    const r = build('nai-diffusion-5-full-medium');
    const heavy = composeNegativeWithUc('', 'nai-diffusion-5-full-medium', 'heavy', '1girl, garden');
    expect(getUcText('nai-diffusion-5-full-medium', 'heavy')).toBeTruthy();
    expect(r.parameters.negative_prompt).toBe(heavy);
    expect(r.parameters.v4_negative_prompt?.caption.char_captions[0].char_caption).toBe('');
    expect(r.parameters.characterPrompts?.[0].uc).toBe('');
    expect(r.parameters.characterPrompts?.[0].prompt).toBe('girl');
    expect(r.parameters.ucPresetId).toBe('heavy');
    expect(r.parameters.tag_hint_uc_preset).toBe(2);
    expect(r.parameters.qualityPresetId).toBe('standard');
  });

  it('changes nothing on High', () => {
    const p = build('nai-diffusion-5-full').parameters;
    expect([p.steps, p.sampler, p.cfg_rescale, p.negative_prompt, p.ucPresetId]).toEqual([28, 'k_dpmpp_2m', 0.4, 'my own negative, hat', 'light']);
  });
});

describe("UCCB's requests follow the form's effort", () => {
  const form = (effort: 'medium' | 'high', model: NovelAIModel = 'nai-diffusion-5-full'): FormSettings => ({
    ...useSettingsStore.getState(),
    model,
    effort,
    basePrompts: [{ id: 'p', label: 'P', text: '1girl, garden', selected: true }],
    characters: [],
  });

  it('generates, and inpaints, with the Medium models', () => {
    expect(buildGenerateRequest(form('medium'), 1).request.model).toBe('nai-diffusion-5-full-medium');
    expect(buildGenerateRequest(form('high'), 1).request.model).toBe('nai-diffusion-5-full');
    const base = { image: 'AAAA', mask: 'BBBB', width: 832, height: 1216, strength: 1, noise: 0, inpaintStrength: 1 };
    expect(buildGenerateRequest(form('medium'), 1, base).request.model).toBe('nai-diffusion-5-full-medium-inpainting');
    // Other models ignore it.
    expect(buildGenerateRequest(form('medium', 'nai-diffusion-4-5-full'), 1).request.model).toBe('nai-diffusion-4-5-full');
  });

  it('enhances with the Medium model too', () => {
    const image = { parameters: { width: 832, height: 1216 }, source: 'gen' } as unknown as GeneratedImage;
    expect(buildEnhanceRequest(form('medium'), image, 1, 1.5, 'AAAA').request.model).toBe('nai-diffusion-5-full-medium');
  });

  it('reuses a Medium image as V5 Full at Medium', () => {
    const m = { prompt: '1girl', characters: [], width: 832, height: 1216, steps: 14, scale: 6, cfgRescale: 0, guessedModel: 'nai-diffusion-5-full-medium' } as unknown as ParsedNaiMetadata;
    const out = reuseFromMetadata(m, form('high'), { prompt: false, characters: false, negative: false, settings: true, seed: false });
    expect([out.model, out.effort]).toEqual(['nai-diffusion-5-full', 'medium']);
  });
});

describe('Medium effort price', () => {
  // NovelAI's own price function in its page, at Medium's 14 steps, against
  // High at its default 23 (non-Opus, one image).
  const cost = (model: NovelAIModel, width: number, height: number, steps: number, strength?: number) =>
    calculateAnlasCost({ model, width, height, steps, smea: false, smeaDyn: false, strength, isOpus: false });

  it.each([
    [832, 1216, 17, 26],
    [1024, 1024, 18, 26],
    [512, 768, 8, 11],
    [1472, 1472, 35, 54],
  ])('%ix%i: Medium %i, High %i', (w, h, medium, high) => {
    expect(cost('nai-diffusion-5-full-medium', w, h, 14)).toBe(medium);
    expect(cost('nai-diffusion-5-full', w, h, 23)).toBe(high);
  });

  it('always prices Medium at its own steps, an inpaint by its strength, and free on Opus', () => {
    expect(cost('nai-diffusion-5-full-medium', 832, 1216, 50)).toBe(17);
    expect(cost('nai-diffusion-5-full-medium-inpainting', 832, 1216, 14, 0.5)).toBe(9);
    expect(calculateAnlasCost({ model: 'nai-diffusion-5-full-medium', width: 832, height: 1216, steps: 14, smea: false, smeaDyn: false, isOpus: true })).toBe(0);
    expect(MEDIUM_EFFORT).toEqual({ steps: 14, sampler: 'k_euler_ancestral', ucPreset: 'heavy' });
  });
});

describe("a Medium image's metadata", () => {
  // NovelAI names V5 models by a hash in "Source".
  const pngWithSource = async (source: string) => {
    const png = await encodePng({ width: 8, height: 8, data: new Uint8ClampedArray(256).fill(255) });
    const chunk = (key: string, text: string) => {
      const data = new TextEncoder().encode(`${key}\0${text}`);
      const out = new Uint8Array(12 + data.length);
      new DataView(out.buffer).setUint32(0, data.length);
      out.set(new TextEncoder().encode('tEXt'), 4);
      out.set(data, 8);
      return out;
    };
    const comment = JSON.stringify({ prompt: '1girl', steps: 14, sampler: 'k_euler_ancestral', seed: 1, width: 8, height: 8 });
    return new Blob([withChunksAfterHeader(png, [chunk('Source', source), chunk('Comment', comment)]) as BlobPart]);
  };

  it.each([
    ['NovelAI Diffusion V5 93F4BD30', 'nai-diffusion-5-full-medium'],
    ['NovelAI Diffusion V5 70AB5786', 'nai-diffusion-5-full-medium'],
    ['NovelAI Diffusion V5 657484A5', 'nai-diffusion-5-full'],
    ['NovelAI Diffusion V5 DB276663', 'nai-diffusion-5-curated'],
  ])('%s is %s', async (source, model) => {
    const { parsed } = await readNaiMetadata(await pngWithSource(source));
    expect(parsed?.guessedModel).toBe(model);
  });
});
