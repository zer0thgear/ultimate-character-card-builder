import { describe, expect, it } from 'vitest';
import { a1111Payload, builtInWorkflow, composeBackendPrompts, describeSlots, fillComfyWorkflow, findComfySlots, parseComfyWorkflow, unfilledPlaceholders } from '@/lib/imageBackends';
import { appearanceTagsMessages, setArtBackend } from '@/lib/assist';
import { newCard } from '@/lib/cardSpec';
import type { BackendGenRequest, ComfyWorkflow } from '@/types/imageBackend';

const req: BackendGenRequest = { prompt: 'p', negative: 'n', width: 896, height: 1152, steps: 30, cfg: 5.5, seed: 42, checkpoint: '', sampler: 'euler', scheduler: 'karras' };

describe('the prompt for other backends', () => {
  it('appends each character (as plain tags) after the style and scene, and their negatives', () => {
    const out = composeBackendPrompts(
      { stylePrompt: 'watercolor,\nflat color' },
      {
        baseText: '1girl, 1boy, forest',
        characters: [
          { id: 'a', prompt: 'girl, red hair, source#hug', uc: 'bad hands', center: { x: 0.5, y: 0.5 }, enabled: true },
          { id: 'b', prompt: 'boy, tall, target#hug', uc: '', center: { x: 0.5, y: 0.5 }, enabled: true },
        ],
        negativePrompt: 'lowres',
        picks: {},
      },
    );
    expect(out.prompt).toBe('watercolor, flat color, 1girl, 1boy, forest, girl, red hair, hug, boy, tall, hug');
    expect(out.negative).toBe('lowres, bad hands');
  });
});

describe('A1111', () => {
  it('sends txt2img, switching the checkpoint only when one is picked', () => {
    expect(a1111Payload(req)).toMatchObject({ prompt: 'p', negative_prompt: 'n', width: 896, height: 1152, steps: 30, cfg_scale: 5.5, seed: 42, sampler_name: 'euler', scheduler: 'karras', batch_size: 1 });
    expect(a1111Payload(req)).not.toHaveProperty('override_settings');
    expect(a1111Payload({ ...req, checkpoint: 'noob.safetensors' })).toMatchObject({ override_settings: { sd_model_checkpoint: 'noob.safetensors' }, override_settings_restore_afterwards: false });
  });
  it('adds the base for img2img', () => {
    expect(a1111Payload({ ...req, init: { image: 'AAAA', strength: 0.45 } })).toMatchObject({ init_images: ['AAAA'], denoising_strength: 0.45 });
  });
});

describe('ComfyUI', () => {
  it('fills the built-in workflow', () => {
    const wf = fillComfyWorkflow(builtInWorkflow(), { ...req, checkpoint: 'model.safetensors' });
    expect(wf['6'].inputs.text).toBe('p');
    expect(wf['7'].inputs.text).toBe('n');
    expect(wf['3'].inputs).toMatchObject({ seed: 42, steps: 30, cfg: 5.5, sampler_name: 'euler', scheduler: 'karras', model: ['4', 0] });
    expect(wf['5'].inputs).toMatchObject({ width: 896, height: 1152, batch_size: 1 });
    expect(wf['4'].inputs.ckpt_name).toBe('model.safetensors');
  });

  it("finds the prompts through combiners and a guider, and leaves the workflow's own sampler when none is picked", () => {
    const wf: ComfyWorkflow = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive', clip: ['9', 1] } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['9', 1] } },
      '3': { class_type: 'ConditioningConcat', inputs: { conditioning_to: ['1', 0], conditioning_from: ['1', 0] } },
      '4': { class_type: 'CFGGuider', inputs: { positive: ['3', 0], negative: ['2', 0], cfg: 7 } },
      '5': { class_type: 'SamplerCustomAdvanced', inputs: { guider: ['4', 0], noise: ['6', 0], latent_image: ['7', 0] } },
      '7': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 4 } },
      '9': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'mine.safetensors' } },
    };
    const slots = findComfySlots(wf);
    expect(slots).toMatchObject({ positive: ['1'], negative: ['2'], latent: '7', checkpoint: '9' });
    const out = fillComfyWorkflow(wf, { ...req, sampler: '', scheduler: '' });
    expect(out['1'].inputs.text).toBe('p');
    expect(out['7'].inputs).toMatchObject({ width: 896, height: 1152, batch_size: 1 });
    expect(out['9'].inputs.ckpt_name).toBe('mine.safetensors'); // none picked: the workflow's own
    expect(wf['1'].inputs.text).toBe('old positive'); // the saved workflow isn't changed
    expect(describeSlots(slots)).toEqual(['prompt', 'negative', 'seed, steps, CFG, sampler', 'size', 'checkpoint']);
  });

  it('fills %placeholders% wherever they are', () => {
    const wf: ComfyWorkflow = {
      '1': { class_type: 'SomeCustomPromptNode', inputs: { positive_text: '%prompt%', negative_text: '%negative%', seed_value: '%seed%' } },
    };
    const out = fillComfyWorkflow(wf, req);
    expect(out['1'].inputs).toEqual({ positive_text: 'p', negative_text: 'n', seed_value: 42 });
  });

  it('reads API-format files and turns away the editor format', () => {
    expect(parseComfyWorkflow(JSON.stringify(builtInWorkflow()))['3'].class_type).toBe('KSampler');
    expect(() => parseComfyWorkflow(JSON.stringify({ nodes: [], links: [] }))).toThrow(/Export \(API\)/);
    expect(() => parseComfyWorkflow('nope')).toThrow(/JSON/);
  });
});

describe('the art writers follow the backend', () => {
  const card = { ...newCard().data, name: 'Mira', description: 'An elf.' };
  it("tell NovelAI's syntax to NovelAI, and A1111's to the rest", () => {
    setArtBackend('novelai');
    const nai = appearanceTagsMessages(card, '')[0].content;
    expect(nai).toContain('Use {tag} to emphasise');
    expect(nai).toContain('fur dataset');
    setArtBackend('sd');
    const sd = appearanceTagsMessages(card, '')[0].content;
    expect(sd).toContain('Use (tag:1.2) to emphasise');
    expect(sd).not.toContain('fur dataset');
    setArtBackend('novelai');
  });
});

describe('ComfyUI placeholders with nothing to fill', () => {
  it('are left for the server to report, not filled with blanks', () => {
    const wf: ComfyWorkflow = { '1': { class_type: 'KSampler', inputs: { sampler_name: '%sampler%', seed: '%seed%' } } };
    const out = fillComfyWorkflow(wf, { ...req, sampler: '' });
    expect(out['1'].inputs).toEqual({ sampler_name: '%sampler%', seed: 42 });
    expect(unfilledPlaceholders(out)).toEqual(['sampler']);
  });
});
