import { describe, expect, it } from 'vitest';
import { buildImageRequest, formSampling, isV3Model } from '@/lib/imageRequest';
import type { FormSettings } from '@/store/settingsStore';
import { CharacterPromptEntry, NovelAIModel } from '@/types/novelai';

// buildImageRequest is the single place request bodies are assembled, and the
// fields below are what novelai.net itself sends — captured from its own
// requests and matched field for field. Changing any of them changes what the
// server does, so they're pinned here.

const form = {
  model: 'nai-diffusion-5-full',
  width: 832,
  height: 1216,
  scale: 6,
  sampler: 'k_euler_ancestral',
  steps: 28,
  smea: true,
  smeaDyn: true,
  cfgRescale: 0.2,
  noiseSchedule: 'karras',
} as FormSettings;

const character = (prompt: string, uc = ''): CharacterPromptEntry => ({
  id: `c-${prompt}`,
  prompt,
  uc,
  enabled: true,
  center: { x: 0.5, y: 0.5 },
});

const build = (model: NovelAIModel, over: Partial<Parameters<typeof buildImageRequest>[0]> = {}) =>
  buildImageRequest({
    input: '1girl',
    negativePrompt: 'bad hands',
    model,
    action: 'generate',
    characters: [],
    useCoords: false,
    parameters: { ...formSampling({ ...form, model }), seed: 42, n_samples: 1, add_original_image: true },
    ...over,
  });

describe('isV3Model', () => {
  it('knows which models predate character prompts', () => {
    expect(isV3Model('nai-diffusion-3')).toBe(true);
    expect(isV3Model('nai-diffusion-furry-3')).toBe(true);
    expect(isV3Model('nai-diffusion-4-full')).toBe(false);
    expect(isV3Model('nai-diffusion-5-full')).toBe(false);
  });
});

describe('formSampling', () => {
  it('sends SMEA on V3 only', () => {
    expect(formSampling({ ...form, model: 'nai-diffusion-3' })).toMatchObject({ sm: true, sm_dyn: true });
    expect(formSampling(form)).not.toHaveProperty('sm');
    expect(formSampling(form)).not.toHaveProperty('sm_dyn');
  });

  it('sends no Variety+ sigma while the toggle is off', () => {
    expect(formSampling(form).skip_cfg_above_sigma).toBeNull();
  });

  it('sends the model’s Variety+ sigma when it is on', () => {
    const on = { ...form, model: 'nai-diffusion-4-5-full' as const, variety: true };
    // 832x1216 is the size the sigma is relative to, so it goes out unscaled.
    expect(formSampling(on).skip_cfg_above_sigma).toBe(58);
  });

  it('lets a sweep cell override the swept values only', () => {
    const swept = formSampling(form, { scale: 9, steps: 12, cfgRescale: 0.7, sampler: 'k_dpmpp_2m' });
    expect(swept).toMatchObject({ scale: 9, steps: 12, cfg_rescale: 0.7, sampler: 'k_dpmpp_2m' });
    expect(swept).toMatchObject({ width: 832, height: 1216, noise_schedule: 'karras', params_version: 4 });
  });
});

describe('buildImageRequest', () => {
  it('always sends the determinism-critical flags', () => {
    for (const model of ['nai-diffusion-5-full', 'nai-diffusion-4-5-full', 'nai-diffusion-3'] as NovelAIModel[]) {
      expect(build(model).parameters).toMatchObject({
        dynamic_thresholding: false,
        controlnet_strength: 1,
        legacy: false,
        deliberate_euler_ancestral_bug: false,
        prefer_brownian: true,
        legacy_v3_extend: false,
      });
    }
  });

  describe('Variety+', () => {
    it('carries the field on models that offer it, null when off', () => {
      for (const model of ['nai-diffusion-4-5-full', 'nai-diffusion-4-full', 'nai-diffusion-3'] as NovelAIModel[]) {
        const request = build(model);
        expect(request.parameters).toHaveProperty('skip_cfg_above_sigma');
        expect(request.parameters.skip_cfg_above_sigma).toBeNull();
      }
    });

    it('leaves the field out entirely on V5, which does not offer it', () => {
      expect(build('nai-diffusion-5-full').parameters).not.toHaveProperty('skip_cfg_above_sigma');
      expect(build('nai-diffusion-5-curated').parameters).not.toHaveProperty('skip_cfg_above_sigma');
    });

    it('passes a flow’s own sigma through', () => {
      const request = build('nai-diffusion-4-5-full', {
        parameters: { ...formSampling({ ...form, model: 'nai-diffusion-4-5-full', variety: true }), seed: 1, n_samples: 1, add_original_image: true },
      });
      expect(request.parameters.skip_cfg_above_sigma).toBe(58);
    });
  });

  it('puts the negative prompt in its own field', () => {
    expect(build('nai-diffusion-5-full').parameters.negative_prompt).toBe('bad hands');
  });

  describe('V3', () => {
    const request = build('nai-diffusion-3');

    it('sends neither caption structure, which the API answers with a 500', () => {
      expect(request.parameters).not.toHaveProperty('v4_prompt');
      expect(request.parameters).not.toHaveProperty('v4_negative_prompt');
      expect(request.parameters).not.toHaveProperty('use_coords');
      expect(request.parameters).not.toHaveProperty('legacy_uc');
    });

    it('sends the V3-only fields instead', () => {
      expect(request.parameters).toMatchObject({ skip_cfg_above_sigma: null, characterPrompts: [] });
    });

    it('leaves out the newer flags', () => {
      expect(request.parameters).not.toHaveProperty('autoSmea');
      expect(request.parameters).not.toHaveProperty('normalize_reference_strength_multiple');
      expect(request.parameters).not.toHaveProperty('straight_alpha');
    });
  });

  describe('V4 and later', () => {
    it('mirrors the prompt into the caption structure', () => {
      const request = build('nai-diffusion-4-5-full', { characters: [character('1boy', 'bad anatomy')] });
      expect(request.parameters.v4_prompt).toEqual({
        caption: {
          base_caption: '1girl',
          char_captions: [{ char_caption: '1boy', centers: [{ x: 0.5, y: 0.5 }] }],
        },
        use_coords: false,
        use_order: true,
      });
      expect(request.parameters.v4_negative_prompt).toEqual({
        caption: {
          base_caption: 'bad hands',
          char_captions: [{ char_caption: 'bad anatomy', centers: [{ x: 0.5, y: 0.5 }] }],
        },
        legacy_uc: false,
      });
      expect(request.parameters.characterPrompts).toEqual([
        { prompt: '1boy', uc: 'bad anatomy', center: { x: 0.5, y: 0.5 }, enabled: true },
      ]);
    });

    it('carries use_coords in both places', () => {
      const request = build('nai-diffusion-4-5-full', { useCoords: true });
      expect(request.parameters.use_coords).toBe(true);
      expect(request.parameters.v4_prompt?.use_coords).toBe(true);
    });

    it('sends straight_alpha on V5 only', () => {
      expect(build('nai-diffusion-5-full').parameters.straight_alpha).toBe(true);
      expect(build('nai-diffusion-4-5-full').parameters).not.toHaveProperty('straight_alpha');
    });
  });

  describe('V5 automatic text', () => {
    it('adds the teXt: section to both the prompt and its caption', () => {
      const request = build('nai-diffusion-5-full', { input: 'a sign saying "Hi"' });
      expect(request.input).toBe('a sign saying "Hi", teXt: Hi');
      expect(request.parameters.v4_prompt?.caption.base_caption).toBe('a sign saying "Hi", teXt: Hi');
    });

    it('leaves older models alone', () => {
      expect(build('nai-diffusion-4-5-full', { input: 'a sign saying "Hi"' }).input).toBe('a sign saying "Hi"');
    });
  });

  describe('preset fields', () => {
    it('sends the level ids and NovelAI’s numeric hints', () => {
      const request = build('nai-diffusion-5-full', { presets: { quality: 'standard', uc: 'heavy' } });
      expect(request.parameters).toMatchObject({
        qualityPresetId: 'standard',
        ucPresetId: 'heavy',
        tag_hint_qt: 1,
        tag_hint_uc_preset: 2,
      });
    });

    it('counts a level the model does not have as none', () => {
      const request = build('nai-diffusion-furry-3', { presets: { quality: 'standard', uc: 'humanFocus' } });
      expect(request.parameters).toMatchObject({ ucPresetId: 'none', tag_hint_uc_preset: 0 });
    });

    it('sends none of them when the levels are unknown', () => {
      expect(build('nai-diffusion-5-full').parameters).not.toHaveProperty('qualityPresetId');
    });
  });

  it('lets a flow override the defaults it sends first', () => {
    const request = build('nai-diffusion-5-full', {
      parameters: {
        ...formSampling(form),
        seed: 42,
        n_samples: 1,
        add_original_image: true,
        legacy_v3_extend: true,
        autoSmea: true,
      },
    });
    expect(request.parameters).toMatchObject({ legacy_v3_extend: true, autoSmea: true });
  });
});
