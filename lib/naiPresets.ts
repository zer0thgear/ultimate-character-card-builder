import { NovelAIModel } from '@/types/novelai';
import { joinPromptParts } from '@/lib/promptText';

// Quality Tags / UC Preset literal text, per model, and how NovelAI splices it
// into a request. The text and the rules both match NovelAI's own web client
// (its bundled preset tables and request builder, read 2026-09-18), which
// differs from docs.novelai.net in places; see docs/REVERSE_ENGINEERING.md,
// "Quality Tags / UC Presets". Its token counter composes the same way.

export type ModelFamily = 'v5' | 'v45full' | 'v45curated' | 'v4full' | 'v4curated' | 'v3anime' | 'v3furry';

export function getModelFamily(model: NovelAIModel): ModelFamily {
  if (model.startsWith('nai-diffusion-5')) return 'v5';
  // Not in the model picker, but V5 Curated inpaints with its inpainting model.
  if (model.startsWith('nai-diffusion-4-5-curated')) return 'v45curated';
  if (model.startsWith('nai-diffusion-4-5')) return 'v45full';
  if (model.startsWith('nai-diffusion-4-curated')) return 'v4curated';
  if (model.startsWith('nai-diffusion-4')) return 'v4full';
  if (model === 'nai-diffusion-furry-3' || model === 'nai-diffusion-furry-3-inpainting') return 'v3furry';
  return 'v3anime';
}

export type QualityLevel = 'none' | 'light' | 'standard';

// Every family exposes 'standard' as its single on/off toggle's text, except v5
// which has a real Light/Standard split.
const QUALITY_TEXT: Record<ModelFamily, Partial<Record<QualityLevel, string>>> = {
  v5: {
    light: ', very aesthetic, amazing quality, no text',
    standard: ', very aesthetic, masterpiece, no text',
  },
  v45full: {
    standard: ', very aesthetic, masterpiece, no text',
  },
  v45curated: {
    standard: ', very aesthetic, masterpiece, no text, -0.8::feet::, rating:general',
  },
  v4full: {
    standard: ', no text, best quality, very aesthetic, absurdres',
  },
  v4curated: {
    standard: ', rating:general, best quality, very aesthetic, absurdres',
  },
  v3anime: {
    standard: ', best quality, amazing quality, very aesthetic, absurdres',
  },
  v3furry: {
    standard: ', {best quality}, {amazing quality}',
  },
};

export function getAvailableQualityLevels(model: NovelAIModel): QualityLevel[] {
  const levels = Object.keys(QUALITY_TEXT[getModelFamily(model)]) as QualityLevel[];
  return ['none', ...levels];
}

export function getQualityText(model: NovelAIModel, level: QualityLevel): string {
  if (level === 'none') return '';
  return QUALITY_TEXT[getModelFamily(model)][level] ?? '';
}

export type UcLevel = 'none' | 'light' | 'heavy' | 'furryFocus' | 'humanFocus';

const UC_TEXT: Record<ModelFamily, Partial<Record<UcLevel, string>>> = {
  v5: {
    heavy:
      'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
    light:
      'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
    furryFocus:
      '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic',
    humanFocus:
      'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy',
  },
  v45full: {
    heavy:
      'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
    light:
      'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    furryFocus:
      '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic',
    humanFocus:
      'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy',
  },
  v45curated: {
    heavy:
      'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
    light:
      'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
    humanFocus:
      'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page',
  },
  v4full: {
    heavy:
      'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page',
    light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page',
  },
  v4curated: {
    heavy:
      'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page',
    light:
      'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page',
  },
  v3anime: {
    heavy:
      'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]',
    light: 'lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing',
    humanFocus:
      'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes',
  },
  v3furry: {
    heavy:
      '{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast',
    light: '{worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text',
  },
};

export function getAvailableUcLevels(model: NovelAIModel): UcLevel[] {
  const levels = Object.keys(UC_TEXT[getModelFamily(model)]) as UcLevel[];
  return ['none', ...levels];
}

export function getUcText(model: NovelAIModel, level: UcLevel): string {
  if (level === 'none') return '';
  return UC_TEXT[getModelFamily(model)][level] ?? '';
}

export const QUALITY_LEVEL_LABELS: Record<QualityLevel, string> = {
  none: 'None',
  light: 'Light',
  standard: 'Standard',
};

export const UC_LEVEL_LABELS: Record<UcLevel, string> = {
  none: 'None',
  light: 'Light',
  heavy: 'Heavy',
  furryFocus: 'Furry Focus',
  humanFocus: 'Human Focus',
};

// ─── Composition helpers ──────────────────────────────────────────────────────
// Centralized since every request-building site (PromptForm, useEnhance,
// useVariations) needs the same logic.

/** V4 and later: base + character captions (and the `text:` feature). */
const hasCharacterPrompts = (model: NovelAIModel) =>
  !model.startsWith('nai-diffusion-3') && !model.startsWith('nai-diffusion-furry-3');
/** Only V5 renders `transparent background`. */
const supportsTransparency = (model: NovelAIModel) => model.startsWith('nai-diffusion-5');
/** NovelAI never adds `nsfw` to these models' UC (see composeNegativeWithUc). */
const isCuratedModel = (model: NovelAIModel) => model.includes('curated');

// Where a text-rendering section starts ("…, text: Hello"), as NovelAI finds it.
export const TEXT_SECTION = /(?:^|\s|[,.:[\]{}、。])text:(?!:)/i;

/** Index of the first prompt-mix `|` (outside `||a|b||` random groups), or
 *  the end of the text. On V4+ NovelAI applies presets to the first part only. */
function firstMixPart(text: string): number {
  let offset = 0;
  const segments = text.split('||');
  for (let i = 0; i < segments.length; i++) {
    const bar = i % 2 === 0 ? segments[i].indexOf('|') : -1;
    if (bar >= 0) return offset + bar;
    offset += segments[i].length + 2;
  }
  return text.length;
}

/**
 * Adds the quality preset (and, on V5, "transparent background" ahead of it)
 * where NovelAI puts them: after the prompt, but on V4+ before a `text:`
 * section so the tags aren't rendered as text, and before any prompt-mix `|`.
 * V3 prompt mixing gets them on every part, ahead of its `:weight`.
 */
export function composeWithQuality(
  text: string,
  model: NovelAIModel,
  level: QualityLevel,
  transparentBg = false,
): string {
  const quality = joinPromptParts(
    transparentBg && supportsTransparency(model) ? 'transparent background' : '',
    getQualityText(model, level),
  );
  return insertTags(text, model, quality);
}

/**
 * Adds tags to the end of a prompt, placed the way NovelAI places quality
 * tags: on V4+ before a `text:` section (so they aren't rendered as text) and
 * before any prompt-mix `|`; on V3, onto every mix part ahead of its weight.
 */
export function insertTags(text: string, model: NovelAIModel, tags: string): string {
  const suffix = joinPromptParts(tags);
  if (!suffix) return text;
  if (!hasCharacterPrompts(model)) {
    return text
      .split('|')
      .map((part) => {
        const weight = part.match(/:[\d.]+$/)?.[0] ?? '';
        return joinPromptParts(part.slice(0, part.length - weight.length), suffix) + weight;
      })
      .join('|');
  }
  const cut = firstMixPart(text);
  const head = text.slice(0, cut);
  const textSection = TEXT_SECTION.exec(head);
  const composed = textSection
    ? joinPromptParts(head.slice(0, textSection.index), suffix, head.slice(textSection.index))
    : joinPromptParts(head, suffix);
  return composed + text.slice(cut);
}

/**
 * Adds whichever of `tags` (comma-separated) the prompt doesn't already
 * have, placed like insertTags. For a chain's Add Tags step: its tags apply
 * to every later render in the run, and a later step may start from an image
 * whose prompt already has them.
 */
export function addMissingTags(text: string, model: NovelAIModel, tags: string): string {
  const have = new Set(text.split(/[,|]/).map((t) => t.trim().toLowerCase()));
  const missing = tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => {
      const key = t.toLowerCase();
      if (!t || have.has(key)) return false;
      have.add(key);
      return true;
    });
  return insertTags(text, model, missing.join(', '));
}

/**
 * Prepends the model's UC preset tags to a negative prompt (its first
 * prompt-mix part on V4+). As NovelAI does, a Full (non-Curated) model with
 * any UC preset also gets `nsfw` in its UC unless the final positive prompt
 * mentions "nsfw"; asking for nsfw in the prompt turns that off.
 */
export function composeNegativeWithUc(
  negativePrompt: string,
  model: NovelAIModel,
  level: UcLevel,
  finalPositive: string,
): string {
  const presetText = getUcText(model, level);
  if (!presetText) return negativePrompt;
  const cut = hasCharacterPrompts(model) ? firstMixPart(negativePrompt) : negativePrompt.length;
  const uc = joinPromptParts(presetText, negativePrompt.slice(0, cut)) + negativePrompt.slice(cut);
  return !isCuratedModel(model) && !finalPositive.toLowerCase().includes('nsfw') ? joinPromptParts('nsfw', uc) : uc;
}
