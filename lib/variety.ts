import { NovelAIModel } from '@/types/novelai';
import { roundToSizeStep } from '@/lib/requestImage';

// Variety+ (`skip_cfg_above_sigma`), read from novelai.net's client on
// 2026-09-19 and confirmed against three of its own captured requests.
//
// NovelAI's model table calls it `cfgDelay` and gives each model the sigma it
// starts from (`cfgDelaySigma`). Its toggle just switches that number on or
// off; then, on the way out, the client scales it by how much bigger the
// request is than the standard 832×1216, measured on the model's 8-pixel
// latent grid, and deletes the field entirely for models that don't offer it.
//
// The scaling uses the size the request is actually sent at, i.e. after the
// rounding to multiples of 64: novelai.net asked for 1248×1824 on V4.5 and
// sent `width: 1280, height: 1856` with `skip_cfg_above_sigma:
// 88.87784456804029`, which is 58 × √(160·232 / 15808).

/** Each model's starting sigma. A model that isn't here doesn't offer
 *  Variety+ — V5 currently doesn't, which is NovelAI's own rule, not ours. */
const BASE_SIGMA: Partial<Record<NovelAIModel, number>> = {
  'nai-diffusion-4-5-full': 58,
  'nai-diffusion-4-5-curated': 58,
  'nai-diffusion-4-full': 19,
  'nai-diffusion-4-curated-preview': 19,
  'nai-diffusion-3': 19,
  'nai-diffusion-furry-3': 19,
  // The inpainting models, which decide whether an inpaint carries the field.
  // V5 Curated inpaints with V4.5 Curated's, which has it: its request sends
  // null, since the toggle it would come from doesn't exist on V5.
  'nai-diffusion-4-5-full-inpainting': 58,
  'nai-diffusion-4-5-curated-inpainting': 58,
  'nai-diffusion-4-full-inpainting': 19,
  'nai-diffusion-4-curated-inpainting': 19,
  'nai-diffusion-3-inpainting': 19,
  'nai-diffusion-furry-3-inpainting': 19,
};

/** The latent area of 832×1216, the size the scaling is relative to. */
const REFERENCE_LATENTS = (832 / 8) * (1216 / 8);
/** Every model's latent grid. */
const LATENT_STEP = 8;

/** Whether NovelAI offers Variety+ for this model. */
export const hasVariety = (model: NovelAIModel) => model in BASE_SIGMA;

/** How much the sigma grows for a request of this size. */
function sizeScale(width: number, height: number): number {
  const latents =
    Math.floor(roundToSizeStep(width) / LATENT_STEP) * Math.floor(roundToSizeStep(height) / LATENT_STEP);
  return Math.sqrt(latents / REFERENCE_LATENTS);
}

/**
 * The `skip_cfg_above_sigma` to send: the model's sigma scaled to the
 * request's size, or null (Variety+ off, or a model without it — NovelAI
 * sends null in the first case and nothing in the second, which
 * buildImageRequest sorts out).
 */
export function varietySigma(
  model: NovelAIModel,
  on: boolean,
  width: number,
  height: number,
): number | null {
  const base = BASE_SIGMA[model];
  if (!on || base === undefined) return null;
  return base * sizeScale(width, height);
}

/** Whether a request's `skip_cfg_above_sigma` means Variety+ was on, for
 *  reading a setting back off an image. */
export const varietyWasOn = (sigma: number | null | undefined) => typeof sigma === 'number' && sigma > 0;
