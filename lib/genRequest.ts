'use client';

import type { FormSettings } from '@/store/settingsStore';
import type { NovelAIGenerateRequest, CharacterPromptEntry, NovelAIModel, NovelAISampler } from '@/types/novelai';
import { buildImageRequest, composeFinalPrompts, formSampling, resolveSelectedPrompt, styleText } from '@/lib/imageRequest';
import { joinPromptParts } from '@/lib/promptText';
import { takeDatasetTags } from '@/lib/assist';
import { hasInpaintStrength, toInpaintingModel } from '@/lib/inpaint';
import { varietySigma } from '@/lib/variety';
import type { ParsedNaiMetadata } from '@/lib/naiMetadata';
import { MODELS } from '@/lib/models';
import { SAMPLERS } from '@/lib/samplers';
import { uuid } from '@/lib/uuid';

// One Generate's request, built the way novelai.net's own client builds
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

/** A reused prompt without the style in front, when it's this card's
 *  style (it'd be added again on the next gen). Dataset switches (fur
 *  dataset, nsfw) in front of it are kept as they are. */
export function withoutStyle(prompt: string, style: string | undefined): string {
  const tags = styleText(style);
  if (!tags) return prompt;
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  const want = tags.split(',').map(norm);
  const parts = prompt.split(',');
  // Find the style's run of tags, allowing a dataset switch or two before it.
  for (let start = 0; start <= Math.min(2, parts.length - want.length); start++) {
    if (want.every((w, i) => norm(parts[start + i]) === w)) {
      return joinPromptParts(...parts.slice(0, start), ...parts.slice(start + want.length));
    }
    if (!/^\s*(fur dataset|nsfw)\s*$/i.test(parts[start] ?? '')) break;
  }
  return prompt;
}

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
    // The dataset tags go onto their switches (which add them back, once).
    const { tags, nsfw, fur } = takeDatasetTags(withoutStyle(m.prompt, form.stylePrompt));
    out.basePrompts = [{ ...(first ?? { id: 'p-default', label: 'Prompt 1', selected: true }), text: tags, tidbits: [] }, ...rest];
    if (nsfw) out.nsfwMode = true;
    if (fur) out.furMode = true;
  }
  if (opts.characters && m.characters.length) {
    out.characters = m.characters.map(
      (c, i): CharacterPromptEntry => ({
        id: uuid(),
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
