import type { FormSettings } from '@/store/settingsStore';
import {
  CharacterPromptEntry,
  GeneratedImage,
  NovelAIGenerateRequest,
  NovelAIModel,
  NovelAIParameters,
  NovelAISampler,
  PromptSource,
  WildcardPicks,
} from '@/types/novelai';
import { resolveRequestPrompts, ResolvedRequestPrompts } from '@/lib/wildcards';
import { joinPromptParts } from '@/lib/promptText';
import { addAutoText, hasAutoText } from '@/lib/autoText';
import { hasVariety, varietySigma } from '@/lib/variety';
import {
  composeNegativeWithUc,
  composeWithQuality,
  getQualityText,
  getUcText,
  QualityLevel,
  UcLevel,
} from '@/lib/naiPresets';

// Shared assembly for every /ai/generate-image request: main Generate (incl.
// Copies, sweeps and img2img), Enhance, Inpaint, Edit and Variations. Each
// flow supplies only what's specific to it; everything else lives here once.
// Fields mirror what NovelAI's own client sends (captured from novelai.net,
// 2026-09-18), and main Generate matches its images exactly (see
// docs/REVERSE_ENGINEERING.md). Change fields only against a fresh capture:
// some that look inert aren't (sending `qualityToggle` changed the image).

export const randomSeed = () => Math.floor(Math.random() * 4294967295);

export const isV3Model = (model: NovelAIModel) =>
  model.startsWith('nai-diffusion-3') || model.startsWith('nai-diffusion-furry-3');

type PromptModifiers = Pick<
  FormSettings,
  'furMode' | 'nsfwMode' | 'transparentBg' | 'model' | 'qualityPreset' | 'ucPreset'
>;

/** Rolls the form's selected base prompt, replaying an image's picks when
 *  reworking that image so it doesn't re-roll. */
export function resolveSelectedPrompt(form: FormSettings, replay?: WildcardPicks): ResolvedRequestPrompts {
  const selected = form.basePrompts.find((p) => p.selected);
  return resolveRequestPrompts(selected ?? { text: '' }, form.characters, { text: form.negativePrompt, tidbits: form.negativeTidbits }, form.tidbitLibrary, replay);
}

/**
 * The prompts for reworking an image (Enhance, Inpaint, Edit), replaying its
 * rolls. Like NovelAI, that's the sidebar's prompt. In Batch mode several
 * prompts are ticked, so it's the base prompt the image itself was made from
 * (as written, with its tidbits and rolls); characters and the negative
 * still come from the sidebar, which Batch shares across prompts.
 */
export function resolveReworkPrompt(form: FormSettings, image: GeneratedImage): ResolvedRequestPrompts {
  if (form.promptMode !== 'batch' || !image.source) return resolveSelectedPrompt(form, image.wildcardPicks);
  const resolved = resolveRequestPrompts(
    { text: image.source.prompt },
    form.characters,
    { text: form.negativePrompt, tidbits: form.negativeTidbits },
    form.tidbitLibrary,
    image.wildcardPicks,
  );
  // Keep the image's base-prompt rolls too, so reworking the result again
  // still doesn't re-roll.
  return { ...resolved, picks: { ...image.wildcardPicks, ...resolved.picks } };
}

/** Applies the prompt modifiers to resolved text as NovelAI's client does:
 *  fur/nsfw prefixes, then transparent background and the quality preset
 *  (see composeWithQuality for where they go), an optional flow-specific
 *  suffix, and the UC preset (whose `nsfw` rule reads the final prompt). */
export function composeFinalPrompts(
  form: PromptModifiers,
  resolved: ResolvedRequestPrompts,
  extraPositive?: string,
): { input: string; negativePrompt: string } {
  const prefixes: string[] = [];
  if (form.furMode) prefixes.push('fur dataset');
  if (form.nsfwMode) prefixes.push('nsfw');

  let input = composeWithQuality(
    joinPromptParts(...prefixes, resolved.baseText),
    form.model,
    form.qualityPreset,
    form.transparentBg,
  );
  if (extraPositive) input = joinPromptParts(input, extraPositive);

  const negativePrompt = composeNegativeWithUc(resolved.negativePrompt, form.model, form.ucPreset, input);
  return { input, negativePrompt };
}

/** What "Reuse" needs to restore a request's prompt as written: the resolved
 *  text before composeFinalPrompts adds anything, and the modifiers it used. */
export function promptSource(form: PromptModifiers, resolved: ResolvedRequestPrompts): PromptSource {
  return {
    prompt: resolved.baseText,
    negativePrompt: resolved.negativePrompt,
    modifiers: {
      furMode: form.furMode,
      nsfwMode: form.nsfwMode,
      transparentBg: form.transparentBg,
      qualityPreset: form.qualityPreset,
      ucPreset: form.ucPreset,
    },
  };
}

type SamplingKey =
  | 'params_version'
  | 'skip_cfg_above_sigma'
  | 'width'
  | 'height'
  | 'scale'
  | 'sampler'
  | 'steps'
  | 'sm'
  | 'sm_dyn'
  | 'cfg_rescale'
  | 'noise_schedule';

/** Size and sampling fields as the form has them, with a sweep cell's values
 *  (if any) taking precedence. */
export function formSampling(
  form: FormSettings,
  overrides: { scale?: number; cfgRescale?: number; steps?: number; sampler?: NovelAISampler } = {},
): Pick<NovelAIParameters, SamplingKey> {
  return {
    params_version: 4,
    width: form.width,
    height: form.height,
    scale: overrides.scale ?? form.scale,
    sampler: overrides.sampler ?? form.sampler,
    steps: overrides.steps ?? form.steps,
    // SMEA only exists on V3; NovelAI doesn't send it for newer models.
    ...(isV3Model(form.model) ? { sm: form.smea, sm_dyn: form.smeaDyn } : {}),
    cfg_rescale: overrides.cfgRescale ?? form.cfgRescale,
    noise_schedule: form.noiseSchedule,
    // Variety+, scaled to the size this request is sent at. Flows that render
    // at a different size (Enhance, Inpaint, Edit) recompute it for theirs.
    skip_cfg_above_sigma: varietySigma(form.model, form.variety, form.width, form.height),
  };
}

/** Fields NovelAI's client sends on its image-editing requests (Enhance,
 *  Inpaint, Edit, Variations) but not on a plain generation. */
export const EDIT_REQUEST_FLAGS = {
  autoSmea: false,
  sm: false,
  sm_dyn: false,
  legacy_v3_extend: false,
  normalize_reference_strength_multiple: true,
} as const;

// NovelAI's numeric ids for preset levels (its `tag_hint_*` fields).
const PRESET_HINT: Record<QualityLevel | UcLevel, number> = {
  none: 0,
  standard: 1,
  heavy: 2,
  light: 3,
  humanFocus: 4,
  furryFocus: 5,
};

/** The preset fields NovelAI's client sends alongside the composed text.
 *  A level the model doesn't have counts as none, as in NovelAI. */
function presetFields(model: NovelAIModel, presets: { quality: QualityLevel; uc: UcLevel }) {
  const quality = getQualityText(model, presets.quality) ? presets.quality : 'none';
  const uc = getUcText(model, presets.uc) ? presets.uc : 'none';
  return {
    qualityPresetId: quality,
    ucPresetId: uc,
    tag_hint_qt: PRESET_HINT[quality],
    tag_hint_uc_preset: PRESET_HINT[uc],
  };
}

type SharedKey =
  | 'dynamic_thresholding'
  | 'controlnet_strength'
  | 'legacy'
  | 'use_coords'
  | 'deliberate_euler_ancestral_bug'
  | 'prefer_brownian'
  | 'negative_prompt'
  | 'legacy_uc'
  | 'v4_prompt'
  | 'v4_negative_prompt'
  | 'characterPrompts';

/** Wraps flow-specific parameters with the fields every request shares: the
 *  defaults and preset fields NovelAI's client sends, the determinism-critical
 *  sampler flags, and the V4+ caption structure. */
export function buildImageRequest(args: {
  input: string;
  negativePrompt: string;
  model: NovelAIModel;
  action: NovelAIGenerateRequest['action'];
  /** Enabled characters with final text (see resolveRequestPrompts). */
  characters: CharacterPromptEntry[];
  useCoords: boolean;
  /** The preset levels the text was composed with, for NovelAI's preset
   *  fields. Omitted when unknown (e.g. Variations of an imported image). */
  presets?: { quality: QualityLevel; uc: UcLevel };
  parameters: Omit<NovelAIParameters, SharedKey>;
}): NovelAIGenerateRequest {
  const { negativePrompt, model, action, characters, useCoords, presets, parameters } = args;
  // Variety+ is carried in `parameters`, but only some models have the field
  // at all, so it's taken out here and put back below for the ones that do.
  const { skip_cfg_above_sigma: variety, ...rest } = parameters;
  const isV3 = isV3Model(model);
  // V5 gathers quoted text into a "teXt:" section, as NovelAI's client does
  // just before sending (after quality tags and any Enhance addition).
  const input = hasAutoText(model) ? addAutoText(args.input, characters, useCoords) : args.input;
  return {
    input,
    model,
    action,
    parameters: {
      // Defaults NovelAI's client always sends; flows may override them.
      legacy_v3_extend: false,
      ...(isV3 ? {} : { autoSmea: false, normalize_reference_strength_multiple: true }),
      ...(model.startsWith('nai-diffusion-5') ? { straight_alpha: true } : {}),
      ...(presets ? presetFields(model, presets) : {}),
      ...rest,
      // As NovelAI does: models that don't offer Variety+ don't carry the
      // field at all, and the ones that do send null when it's off.
      ...(hasVariety(model) ? { skip_cfg_above_sigma: variety ?? null } : {}),
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true,
      negative_prompt: negativePrompt,
      // V3 predates character prompts and the V4 caption format: the API
      // answers V3 requests carrying v4_prompt/v4_negative_prompt with a 500,
      // and NovelAI sends neither (verified live, 2026-09-18).
      ...(isV3
        ? { characterPrompts: [] }
        : {
            use_coords: useCoords,
            legacy_uc: false,
            v4_prompt: {
              caption: {
                base_caption: input,
                char_captions: characters.map((c) => ({ char_caption: c.prompt, centers: [c.center] })),
              },
              use_coords: useCoords,
              use_order: true,
            },
            v4_negative_prompt: {
              caption: {
                base_caption: negativePrompt,
                char_captions: characters.map((c) => ({ char_caption: c.uc, centers: [c.center] })),
              },
              legacy_uc: false,
            },
            characterPrompts: characters.map((c) => ({
              prompt: c.prompt,
              uc: c.uc,
              center: c.center,
              enabled: c.enabled,
            })),
          }),
    },
  };
}
