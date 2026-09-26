'use client';

import type { FormSettings } from '@/store/settingsStore';
import type { NovelAIGenerateRequest, CharacterPromptEntry, NovelAIModel, NovelAISampler } from '@/types/novelai';
import { buildImageRequest, composeFinalPrompts, formSampling, resolveSelectedPrompt } from '@/lib/imageRequest';
import { hasInpaintStrength, toInpaintingModel } from '@/lib/inpaint';
import { varietySigma } from '@/lib/variety';
import type { ParsedNaiMetadata } from '@/lib/naiMetadata';
import { MODELS } from '@/lib/models';
import { SAMPLERS } from '@/lib/samplers';

// One Generate's request, built the way NovelFrontEnd's PromptForm builds
// it, so gens here match novelai.net's: a plain generation, Image2Image
// from a base, or an inpaint when the base has a mask.

export interface Img2ImgBase {
  image: string; // base64
  /** Black and white, white where to regenerate: an inpaint. */
  mask?: string;
  width: number;
  height: number;
  strength: number;
  noise: number;
  /** An inpaint's strength (V4+; 1 repaints the masked area from scratch). */
  inpaintStrength: number;
}

export function buildGenerateRequest(form: FormSettings, seed: number, base?: Img2ImgBase) {
  const resolved = resolveSelectedPrompt(form);
  // An inpaint goes to the model's inpainting model, whose presets are the
  // ones that apply (V5 Curated's is V4.5 Curated's).
  const inpainting = !!base?.mask;
  const model = inpainting ? toInpaintingModel(form.model) : form.model;
  const { input, negativePrompt } = composeFinalPrompts({ ...form, model }, resolved);
  const size = base ? { width: base.width, height: base.height } : null;
  const request: NovelAIGenerateRequest = buildImageRequest({
    input,
    negativePrompt,
    model,
    action: inpainting ? 'infill' : base ? 'img2img' : 'generate',
    characters: resolved.characters,
    useCoords: form.useCoords,
    presets: { quality: form.qualityPreset, uc: form.ucPreset },
    parameters: {
      ...formSampling(form),
      ...(hasInpaintStrength(form.model) ? { inpaintImg2ImgStrength: inpainting ? base!.inpaintStrength : 1 } : {}),
      ...(size ? { ...size, skip_cfg_above_sigma: varietySigma(form.model, form.variety, size.width, size.height) } : {}),
      n_samples: 1,
      // NovelAI sends false for an inpaint: the result is pasted over the
      // original through a feathered edge afterwards (lib/inpaintComposite.ts).
      add_original_image: !inpainting,
      seed,
      ...(base ? { strength: base.strength, noise: base.noise, image: base.image } : {}),
      ...(base?.mask ? { mask: base.mask } : {}),
    },
  });
  return { request, resolved };
}

/** Size presets, as NovelAI offers them (normal size, Opus-free). */
export const SIZE_PRESETS = [
  { label: 'Portrait', width: 832, height: 1216 },
  { label: 'Landscape', width: 1216, height: 832 },
  { label: 'Square', width: 1024, height: 1024 },
  { label: 'Tall', width: 704, height: 1472 },
  { label: 'Wide', width: 1472, height: 704 },
];

/** Grid positions for V4+ characters (NovelAI's 5×5 grid centres). */
export const POSITIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

/** The form fields "Reuse" sets from an image's metadata. Only what the
 *  image actually carries is replaced. */
export function reuseFromMetadata(
  m: ParsedNaiMetadata,
  form: FormSettings,
  opts: { prompt: boolean; characters: boolean; negative: boolean; settings: boolean; seed: boolean },
): Partial<FormSettings> {
  const out: Partial<FormSettings> = {};
  if (opts.prompt) {
    const [first, ...rest] = form.basePrompts;
    out.basePrompts = [{ ...(first ?? { id: 'p-default', label: 'Prompt 1', selected: true }), text: m.prompt, tidbits: [] }, ...rest];
  }
  if (opts.characters && m.characters.length) {
    out.characters = m.characters.map(
      (c, i): CharacterPromptEntry => ({
        id: crypto.randomUUID(),
        label: form.characters[i]?.label ?? `Character ${i + 1}`,
        prompt: c.prompt,
        uc: c.uc,
        center: c.center,
        enabled: true,
      }),
    );
  }
  if (opts.negative) out.negativePrompt = m.negativePrompt;
  if (opts.settings) {
    Object.assign(out, {
      width: m.width,
      height: m.height,
      steps: m.steps,
      scale: m.scale,
      cfgRescale: m.cfgRescale,
      variety: m.variety,
      smea: m.smea,
      smeaDyn: m.smeaDyn,
      ...(m.sampler && SAMPLERS.some((s) => s.value === m.sampler) ? { sampler: m.sampler as NovelAISampler } : {}),
      ...(m.guessedModel && MODELS.some((x) => x.value === m.guessedModel) ? { model: m.guessedModel as NovelAIModel } : {}),
      ...(m.modifiers ?? {}),
    });
  }
  if (opts.seed) out.seed = m.seed;
  return out;
}
