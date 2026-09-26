import { NovelAIModel } from '@/types/novelai';
import { MAX_GENERATION_PIXELS } from '@/lib/anlasCost';
import { TEXT_SECTION } from '@/lib/naiPresets';
import { roundToSizeStep } from '@/lib/requestImage';

// Enhance as NovelAI's client does it (from its bundle, 2026-09-18).

/** Strength and noise per level (NovelAI's "Magnitude" 1–5). */
export const ENHANCE_LEVELS = [
  { level: 1 as const, strength: 0.2, noise: 0 },
  { level: 2 as const, strength: 0.4, noise: 0 },
  { level: 3 as const, strength: 0.5, noise: 0 },
  { level: 4 as const, strength: 0.6, noise: 0 },
  { level: 5 as const, strength: 0.7, noise: 0.1 },
];
export type EnhanceLevelNum = 1 | 2 | 3 | 4 | 5;

/** A size multiplier, or "max": V5 re-renders at the image's size and the
 *  server upscales it as far as it can (about 3.1 MP). */
export type EnhanceScale = 1 | 1.5 | 2 | 'max';

// Every model's size step is 64.
const STEP = 64;
// "Max" is offered below this many pixels.
const MAX_ENHANCE_BELOW = 2516582.4;

const isV5 = (model: NovelAIModel) => model.startsWith('nai-diffusion-5');
const isV45 = (model: NovelAIModel) => model.startsWith('nai-diffusion-4-5');

/**
 * The scales NovelAI offers for an image, largest first (its default is the
 * first). The two standard portrait/landscape sizes get 1.5× and 1×; other
 * sizes get whichever of 2×, 1.5× and 1× stay within 3.1 MP on multiples of
 * 64. V5 adds Max for images under about 2.5 MP.
 */
export function enhanceScales(width: number, height: number, model: NovelAIModel): EnhanceScale[] {
  const standard = (width === 832 && height === 1216) || (width === 1216 && height === 832);
  let scales: EnhanceScale[] = standard
    ? [1.5, 1]
    : ([2, 1.5, 1] as const).filter(
        (s) => width * s * height * s <= MAX_GENERATION_PIXELS && (width * s) % STEP === 0 && (height * s) % STEP === 0,
      );
  if (isV5(model) && width * height > 0 && width * height < MAX_ENHANCE_BELOW) scales = ['max', ...scales];
  return scales;
}

export const scaleLabel = (scale: EnhanceScale) => (scale === 'max' ? 'Max' : `${scale}×`);

/** The size NovelAI resizes the image to: plain multiplication, rounded
 *  down (1.5× of 832×1216 is 1248×1824). The request itself then goes out
 *  at the nearest multiples of 64 (1280×1856; see finalizeRequest). Max uses
 *  the image's own size. */
export function enhanceRequestSize(width: number, height: number, scale: EnhanceScale) {
  return scale === 'max'
    ? { width, height }
    : { width: Math.floor(width * scale), height: Math.floor(height * scale) };
}

/** The server's size for a Max enhance, as NovelAI's client prices it: 2× on
 *  a 16 px grid, scaled into 3.1 MP on a 32 px grid. */
function maxEnhancePriceSize(width: number, height: number) {
  const w2 = Math.floor(width / 16) * 16 * 2;
  const h2 = Math.floor(height / 16) * 16 * 2;
  const k = Math.min(1, Math.sqrt(MAX_GENERATION_PIXELS / (w2 * h2)));
  let w = 32 * Math.round((w2 * k) / 32);
  let h = 32 * Math.round((h2 * k) / 32);
  if (w * h > MAX_GENERATION_PIXELS) {
    w = 32 * Math.floor((w2 * k) / 32);
    h = 32 * Math.floor((h2 * k) / 32);
  }
  return { width: w, height: h };
}

/** The size NovelAI prices an enhance at: the size it's rendered at, or for
 *  Max the server's size as NovelAI's client estimates it. */
export function enhancePriceSize(width: number, height: number, scale: EnhanceScale) {
  if (scale === 'max') return maxEnhancePriceSize(width, height);
  const size = enhanceRequestSize(width, height, scale);
  return { width: roundToSizeStep(size.width), height: roundToSizeStep(size.height) };
}

/** The result's size: the rendered size, or for Max the size NovelAI's
 *  client expects back (up to 2×, within 3.1 MP). The real size is read
 *  from the image once it arrives. */
export function enhanceOutputSize(width: number, height: number, scale: EnhanceScale) {
  if (scale !== 'max') return enhancePriceSize(width, height, scale);
  const k = Math.min(2, Math.sqrt(MAX_GENERATION_PIXELS / (width * height)));
  return { width: Math.floor(width * k), height: Math.floor(height * k) };
}

const PROMPT_ADD = ', -2::upscaled, blurry::,';

/**
 * NovelAI's enhance prompt addition, on V4.5 and V5 only, and not for Max:
 * unless the prompt already mentions "upscaled, blurry", it adds
 * ", -2::upscaled, blurry::," before a text: section, or at the end. Spliced
 * as raw text, exactly as NovelAI does.
 */
export function addEnhancePrompt(prompt: string, model: NovelAIModel, scale: EnhanceScale): string {
  if (scale === 'max' || !(isV5(model) || isV45(model)) || prompt.includes('upscaled, blurry')) return prompt;
  const text = TEXT_SECTION.exec(prompt);
  return text ? prompt.slice(0, text.index) + PROMPT_ADD + prompt.slice(text.index) : prompt + PROMPT_ADD;
}
