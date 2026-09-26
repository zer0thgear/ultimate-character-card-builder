import { NovelAIModel, NovelAISubscription } from '@/types/novelai';

// NovelAI's own Anlas price formulas, as its web client computes them (read
// from novelai.net's bundle on 2026-09-18 and checked against the prices its
// UI displays: V5 Curated 832x1216 @ 30 steps = 32, V4.5 Full = 21, plus the
// four V5 data points an earlier empirical fit was based on). The earlier fit
// used one curve for every model, which overstated V3/V4/V4.5 by about 1.5x,
// and ignored img2img strength, which does scale the price.

// Per-pixel constants for every model this app supports (V3 through V5).
const PER_PIXEL = 2951823174884865e-21;
const PER_PIXEL_STEP = 5753298233447344e-22;
const SMEA_FACTOR = 1.2;
const SMEA_DYN_FACTOR = 1.4;
/** The free Opus allowance covers images up to this size at ≤ 28 steps. */
const OPUS_FREE_PIXELS = 1048576;
const OPUS_FREE_STEPS = 28;

export interface AnlasCostInput {
  model: NovelAIModel;
  width: number;
  height: number;
  steps: number;
  smea: boolean;
  smeaDyn: boolean;
  nSamples?: number;
  /** img2img / Enhance / Variations strength: the price scales with it. */
  strength?: number;
  isOpus: boolean;
  /** V5's Opus allowance has a usage limit; once it's used up (the account's
   *  `usage.isNegative`), V5 generations stop being free. */
  opusExhausted?: boolean;
  /** Background removal never gets the Opus discount. */
  noOpusDiscount?: boolean;
}

export function calculateAnlasCost({
  model,
  width,
  height,
  steps,
  smea,
  smeaDyn,
  nSamples = 1,
  strength = 1,
  isOpus,
  opusExhausted = false,
  noOpusDiscount = false,
}: AnlasCostInput): number {
  const pixels = width * height;
  const isV5 = model.startsWith('nai-diffusion-5');
  const smeaFactor = smea && smeaDyn ? SMEA_DYN_FACTOR : smea ? SMEA_FACTOR : 1;
  let perSample = Math.ceil(PER_PIXEL * pixels + PER_PIXEL_STEP * pixels * steps) * smeaFactor;
  if (isV5) perSample *= 1.5;
  perSample = Math.max(Math.ceil(perSample * strength), 2);

  const free =
    isOpus &&
    pixels <= OPUS_FREE_PIXELS &&
    steps <= OPUS_FREE_STEPS &&
    !(isV5 && opusExhausted) &&
    !noOpusDiscount;
  return perSample * (Math.max(1, nSamples) - (free ? 1 : 0));
}

/** The Opus inputs to calculateAnlasCost for an account (or none if unknown). */
export function opusStatus(subscription: NovelAISubscription | null | undefined) {
  return { isOpus: subscription?.tier === 3, opusExhausted: subscription?.usage?.isNegative ?? false };
}

/** NovelAI refuses to generate (or img2img/inpaint/edit) past this size;
 *  its own client enforces the same limit. */
export const MAX_GENERATION_PIXELS = 3145728;

// ─── Upscale ──────────────────────────────────────────────────────────────────

/** NovelAI's own UI only offers Upscale for images up to this size. */
export const UPSCALE_MAX_PIXELS = 1048576;
const UPSCALE_PRICES: [maxPixels: number, anlas: number][] = [
  [1048576, 1],
  [1747627, 2],
  [2446678, 3],
  [3145728, 4],
];

/** Upscale's flat price by input size (no Opus discount), or null past 3.1 MP. */
export function upscaleCost(width: number, height: number): number | null {
  const pixels = width * height;
  return UPSCALE_PRICES.find(([max]) => pixels <= max)?.[1] ?? null;
}

// ─── Director Tools ───────────────────────────────────────────────────────────

const TOOL_MAX_PIXELS = 3145728;
const TOOL_MIN_PIXELS = 1048576;

/** Scales a size so its area is at most/at least `target`, as NovelAI does. */
function scaleArea(width: number, height: number, target: number, shrink: boolean) {
  const area = width * height;
  if (shrink ? area <= target : area >= target) return { width, height };
  const k = Math.sqrt(target / area);
  return { width: Math.floor(width * k), height: Math.floor(height * k) };
}

/**
 * A Director Tool's price. NovelAI prices them as a 28-step V3 generation at
 * the image's size clamped to 1–3.1 MP (so Opus gets them free at ≤ 1 MP).
 * Background removal costs 3× that plus 5, with no Opus discount.
 */
export function directorToolCost(
  tool: string,
  width: number,
  height: number,
  opus: { isOpus: boolean },
): number {
  const shrunk = scaleArea(width, height, TOOL_MAX_PIXELS, true);
  const size = scaleArea(shrunk.width, shrunk.height, TOOL_MIN_PIXELS, false);
  const bgRemoval = tool === 'bg-removal';
  const base = calculateAnlasCost({
    model: 'nai-diffusion-3',
    ...size,
    steps: 28,
    smea: false,
    smeaDyn: false,
    isOpus: opus.isOpus,
    noOpusDiscount: bgRemoval,
  });
  return bgRemoval ? base * 3 + 5 : base;
}
