import { NovelAIModel } from '@/types/novelai';

// Inpainting, as novelai.net's client does it (read 2026-09-24).

/** NovelAI's own base → inpainting model mapping. Not a simple suffix: V4
 *  Curated drops "-preview", and V5 Curated has no inpainting model of its
 *  own, so NovelAI's client uses V4.5 Curated's (both checked against the
 *  API on 2026-09-18). */
const INPAINTING_MODEL: Partial<Record<NovelAIModel, NovelAIModel>> = {
  'nai-diffusion-5-full': 'nai-diffusion-5-full-inpainting',
  'nai-diffusion-5-curated': 'nai-diffusion-4-5-curated-inpainting',
  'nai-diffusion-4-5-full': 'nai-diffusion-4-5-full-inpainting',
  'nai-diffusion-4-5-curated': 'nai-diffusion-4-5-curated-inpainting',
  'nai-diffusion-4-full': 'nai-diffusion-4-full-inpainting',
  'nai-diffusion-4-curated-preview': 'nai-diffusion-4-curated-inpainting',
  'nai-diffusion-3': 'nai-diffusion-3-inpainting',
  'nai-diffusion-furry-3': 'nai-diffusion-furry-3-inpainting',
};

export function toInpaintingModel(model: NovelAIModel): NovelAIModel {
  if (model.endsWith('-inpainting')) return model;
  return INPAINTING_MODEL[model] ?? 'nai-diffusion-4-5-curated-inpainting';
}

/**
 * Whether the model takes an inpainting strength (NovelAI's model table calls
 * it `img2imgInpainting`): V4 and later do; V3 always repaints the masked
 * area from scratch, so its panel has no slider.
 */
export const hasInpaintStrength = (model: NovelAIModel) =>
  !model.startsWith('nai-diffusion-3') && !model.startsWith('nai-diffusion-furry-3');

/**
 * The `img2img` block NovelAI's client adds to an inpainting request: only
 * when the model takes a strength and it's below 1, carrying that strength
 * with colour correction on. At 1 (the default) the field isn't sent at all.
 */
export function inpaintImg2Img(
  model: NovelAIModel,
  inpaintStrength: number,
): { strength: number; color_correct: true } | undefined {
  return hasInpaintStrength(model) && inpaintStrength !== 1
    ? { strength: inpaintStrength, color_correct: true }
    : undefined;
}
