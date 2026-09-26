import type { EnhanceScale } from '@/lib/enhance';
import type { SweepAxisDraft } from '@/lib/sweeps';
import type { QualityLevel, UcLevel } from '@/lib/naiPresets';

// ─── Base prompt / mode types ─────────────────────────────────────────────────

/** A toggleable sub-prompt appended to its parent prompt's text when enabled —
 *  e.g. splitting an artist tag or location/composition details out of a base
 *  prompt, or appearance/clothing/actions out of a character prompt. UI-only;
 *  never sent to the API directly, only as composed text (see lib/promptTidbits.ts). */
export interface PromptTidbit {
  id: string;
  label: string;
  text: string;
  enabled: boolean;
  /** Links this tidbit to a shared library entry, whose text wins at compose
   *  time so editing the entry updates every prompt using it. `label`/`text`
   *  stay as a snapshot and are used as a fallback if the entry is deleted. */
  sourceId?: string;
}

/** A reusable tidbit saved once and linked into any number of prompts, or
 *  referenced inline as `__Label__`. A random entry holds one option per line
 *  of `text` and contributes one of them per image (see lib/wildcards.ts). */
export interface LibraryTidbit {
  id: string;
  label: string;
  text: string;
  /** Absent on entries saved before wildcards existed, which are fixed. */
  kind?: 'fixed' | 'random';
}

/** The option each random wildcard contributed to one request, keyed by
 *  `<field scope>|<library entry id>` and then by occurrence order within that
 *  field. Replaying it reproduces the rolls, e.g. when enhancing the image. */
export type WildcardPicks = Record<string, string[]>;

/** A named base prompt entry in the prompt list. */
export interface BasePrompt {
  id: string;
  label: string;
  text: string;
  selected: boolean;
  /** Optional — absent on prompts persisted before this feature existed. */
  tidbits?: PromptTidbit[];
}

/** Single: one prompt selected; Batch: each selected prompt generates one image. */
export type PromptMode = 'single' | 'batch';

// ─────────────────────────────────────────────────────────────────────────────

export type NovelAIModel =
  | 'nai-diffusion-5-full'
  | 'nai-diffusion-5-full-inpainting'
  | 'nai-diffusion-5-curated'
  | 'nai-diffusion-4-5-full'
  | 'nai-diffusion-4-5-full-inpainting'
  | 'nai-diffusion-4-5-curated'
  // No V5 Curated inpainting model exists server-side; NovelAI's client
  // inpaints V5 Curated with this one (see toInpaintingModel).
  | 'nai-diffusion-4-5-curated-inpainting'
  | 'nai-diffusion-4-curated-preview'
  | 'nai-diffusion-4-curated-inpainting'
  | 'nai-diffusion-4-full'
  | 'nai-diffusion-4-full-inpainting'
  | 'nai-diffusion-3'
  | 'nai-diffusion-3-inpainting'
  | 'nai-diffusion-furry-3'
  | 'nai-diffusion-furry-3-inpainting';

export type NovelAISampler =
  | 'k_euler'
  | 'k_euler_ancestral'
  | 'k_dpmpp_2s_ancestral'
  | 'k_dpmpp_2m'
  | 'k_dpmpp_2m_sde'
  | 'k_dpmpp_sde'
  | 'ddim_v3';

export type NovelAINoiseSchedule =
  | 'native'
  | 'karras'
  | 'exponential'
  | 'polyexponential';

// ─── Character prompt types ───────────────────────────────────────────────────

/** API-level character prompt (sent in the request body). */
export interface CharacterPrompt {
  prompt: string;
  uc: string;
  center: { x: number; y: number };
  enabled: boolean;
}

/** Form-state character prompt — includes UI-only fields not sent to the API.
 *  `id` is used as a React key; `label` is a user-visible name only. */
export interface CharacterPromptEntry extends CharacterPrompt {
  id: string;
  /** Display name shown in the editor header. Not sent to the API. */
  label?: string;
  /** Optional — absent on characters persisted before this feature existed. */
  tidbits?: PromptTidbit[];
  /** The same, for this character's negative prompt. */
  ucTidbits?: PromptTidbit[];
  /** Folded down to its header in the editor. UI-only. */
  collapsed?: boolean;
  /** Put away in the editor's Archive: kept, but out of the list and never
   *  sent. An archived character is always disabled too, so everything that
   *  filters on `enabled` leaves it out. */
  archived?: boolean;
}

// ─── V4 prompt structures ─────────────────────────────────────────────────────

export interface V4CharCaption {
  char_caption: string;
  centers: { x: number; y: number }[];
}

export interface V4Prompt {
  caption: {
    base_caption: string;
    char_captions: V4CharCaption[];
  };
  use_coords: boolean;
  use_order: boolean;
}

export interface V4NegativePrompt {
  caption: {
    base_caption: string;
    char_captions: V4CharCaption[];
  };
  legacy_uc: boolean;
}

// ─── Parameters ───────────────────────────────────────────────────────────────

export interface NovelAIParameters {
  width: number;
  height: number;
  scale: number;
  sampler: NovelAISampler;
  steps: number;
  n_samples: number;
  /** Legacy numeric UC preset. Not sent: NovelAI's client uses `ucPresetId`
   *  (and applies the preset text itself). Older images' metadata may carry it. */
  ucPreset?: number;
  /** NovelAI's named presets and their numeric hints (none 0, standard 1,
   *  heavy 2, light 3, humanFocus 4, furryFocus 5). The preset text itself is
   *  already in the prompt; these mirror what NovelAI's client sends. */
  qualityPresetId?: string;
  ucPresetId?: string;
  tag_hint_qt?: number;
  tag_hint_uc_preset?: number;
  /** V5 (transparency-capable) only; NovelAI's default setting is `true`. */
  straight_alpha?: boolean;
  /** Never sent. NovelAI's client dropped it for `qualityPresetId`, and
   *  sending `true` measurably changes the image (see
   *  docs/REVERSE_ENGINEERING.md). Older images' metadata may still carry it. */
  qualityToggle?: boolean;
  /** SMEA. Sent for V3 only (and as false on image edits), as NovelAI does. */
  sm?: boolean;
  sm_dyn?: boolean;
  dynamic_thresholding: boolean;
  controlnet_strength: number;
  legacy: boolean;
  add_original_image: boolean;
  cfg_rescale: number;
  noise_schedule: NovelAINoiseSchedule;
  /** NovelAI's "Variety+" boost. Omit (or null) for the API's default, off:
   *  a nonzero value forces increased output variance and is resolution/
   *  model-dependent, so never hardcode a constant here. */
  skip_cfg_above_sigma?: number | null;
  seed: number;
  negative_prompt: string;
  /** Vibe Transfer inputs; omitted when there are none, as NovelAI does. */
  reference_image_multiple?: string[];
  reference_information_extracted_multiple?: number[];
  reference_strength_multiple?: number[];
  // V4 fields — only included when using character prompts or v4 models
  params_version?: number;
  use_coords?: boolean;
  v4_prompt?: V4Prompt;
  v4_negative_prompt?: V4NegativePrompt;
  characterPrompts?: CharacterPrompt[];
  // img2img / enhance fields
  strength?: number;
  noise?: number;
  autoSmea?: boolean;
  image?: string;
  extra_noise_seed?: number;
  /** V5 "Max" enhance: re-render at the image's size, upscaled by the server. */
  upscaled_enhance?: boolean;
  inpaintImg2ImgStrength?: number;
  color_correct?: boolean;
  deliberate_euler_ancestral_bug?: boolean;
  prefer_brownian?: boolean;
  legacy_v3_extend?: boolean;
  normalize_reference_strength_multiple?: boolean;
  legacy_uc?: boolean;
  // inpainting fields
  mask?: string;
  img2img?: { strength: number; color_correct: boolean };
}

export interface NovelAIGenerateRequest {
  input: string;
  model: NovelAIModel;
  action: 'generate' | 'img2img' | 'infill';
  parameters: NovelAIParameters;
}

// ─── Director Tools (augment-image) ──────────────────────────────────────────

export type AugmentReqType =
  | 'bg-removal'
  | 'lineart'
  | 'sketch'
  | 'colorize'
  | 'emotion'
  | 'declutter';

/** Body for the `request` part of a multipart POST to /ai/augment-image.
 *  `image` is always the literal string "image" — it names the other form part. */
export interface AugmentRequest {
  req_type: AugmentReqType;
  use_new_shared_trial: false; // always pay normally; avoids the recaptcha_token requirement
  width: number;
  height: number;
  image: 'image';
  prompt?: string;
  defry?: number;
}

/** Body for the `request` part of a multipart POST to /ai/upscale. */
export interface UpscaleRequest {
  image: 'image';
  model: 'nai-diffusion-5-curated'; // dedicated upscaler model, independent of the source model
  declared_blur_sigma: number;
}

// ─── Subscription / Opus usage (GET /user/subscription) ──────────────────────

export interface NovelAISubscription {
  tier: number; // 0=Paper, 1=Tablet, 2=Scroll, 3=Opus
  active: boolean;
  expiresAt: number; // unix seconds
  perks: {
    maxPriorityActions: number;
    startPriority: number;
    contextTokens: number;
    unlimitedMaxPriority: boolean;
    moduleTrainingSteps: number;
  };
  accountType: number;
  isGracePeriod: boolean;
  isPaypal: boolean;
  /** Opus's free V5 generation allowance (normal resolution, <=28 steps). */
  usage: {
    percent: number; // 0-100+, clamped display-side; recovery pauses above 100
    isNegative: boolean;
    /** Despite the name, seconds per 1% of refill (a rate, not a countdown):
     *  NovelAI's client shows 86400 / this as "% per day". */
    timeUntilNextPercent: number;
  };
  /** Despite the name, this is the Anlas balance — confirmed against NovelAI's own
   *  "Purchase Anlas" modal, which labels these two fields "Your Subscription Anlas"
   *  and "Your Paid Anlas" respectively. Total Anlas = the sum of both. */
  trainingStepsLeft: {
    fixedTrainingStepsLeft: number;
    purchasedTrainingSteps: number;
  };
}

export interface GeneratedImage {
  id: string;
  url: string; // object URL - freed on session clear / image removal
  blob: Blob;
  prompt: string;
  negativePrompt: string;
  model: NovelAIModel;
  parameters: NovelAIParameters;
  timestamp: number;
  seed: number;
  // Enhancement provenance — set when this image was produced by img2img/enhance
  sourceImageId?: string;   // ID of the source image in the session
  sourceImageUrl?: string;  // Separate object URL for the source (survives source deletion)
  // Shared across every image produced by one "Copies" request (true batch or
  // queued) — lets the gallery clump them visually. Absent for single generations.
  batchId?: string;
  /** Wildcard rolls that produced this image, replayed by Enhance/Inpaint/Edit/
   *  Variations so reworking an image doesn't re-roll it. */
  wildcardPicks?: WildcardPicks;
  /** Set on every image from an X/Y sweep: which grid cell it is. */
  sweep?: SweepCellInfo;
  /** The prompt as written, before the sidebar's modifiers were applied, so
   *  "Reuse" can restore it without doubling up quality tags, prefixes, etc.
   *  `prompt` / `negativePrompt` above are the final text actually sent. */
  source?: PromptSource;
  /** Set on every image a chain produced: which run and step made it. */
  chain?: ChainStepInfo;
  /** Kept when the session is cleared. History lives in memory only, so this
   *  is what stops a good one going with the rest. */
  pinned?: boolean;
}

// ─── Chained actions ─────────────────────────────────────────────────────────

export type ChainDirectorTool = 'bg-removal' | 'lineart' | 'sketch' | 'declutter' | 'colorize' | 'emotion';

/** One step of a chain. Each takes the previous step's image. */
export type ChainStep =
  | { kind: 'enhance'; level: 1 | 2 | 3 | 4 | 5; scale: EnhanceScale }
  | { kind: 'upscale' }
  | { kind: 'variations' }
  | {
      kind: 'director';
      tool: ChainDirectorTool;
      /** colorize: guidance prompt; emotion: extra prompt. */
      prompt?: string;
      /** colorize / emotion: 0–5. */
      defry?: number;
      /** emotion only, e.g. "happy". */
      emotion?: string;
    }
  | { kind: 'pixelSnap'; palettize: 'off' | 'auto' | 'custom'; colors?: number; avoidOverRefining?: boolean; upscale?: boolean }
  | { kind: 'download' }
  /** Adds tags to the prompt for this run's later steps only (Enhance and
   *  Variations); the sidebar's prompt is left alone. */
  | { kind: 'tags'; tags: string }
  /** Regenerates the image from its own prompt, seed and settings, one image
   *  per combination of the axes' values. Saved as the editor's drafts. */
  | { kind: 'sweep'; x: SweepAxisDraft; y: SweepAxisDraft };

export interface Chain {
  id: string;
  name: string;
  steps: ChainStep[];
}

export interface ChainStepInfo {
  /** One run of a chain on one source image; results share it as batchId. */
  runId: string;
  chainId: string;
  name: string;
  /** 1-based. */
  step: number;
  total: number;
  label: string;
}

export interface PromptSource {
  /** Base prompt with tidbits folded in and wildcards rolled, pre-modifiers. */
  prompt: string;
  /** Negative prompt before the UC preset was added. */
  negativePrompt: string;
  modifiers: {
    furMode: boolean;
    nsfwMode: boolean;
    transparentBg: boolean;
    qualityPreset: QualityLevel;
    ucPreset: UcLevel;
  };
}

export interface SweepAxisInfo {
  /** Display name, e.g. "CFG" or a wildcard's label. */
  name: string;
  /** Display values, in grid order. */
  values: string[];
}

export interface SweepCellInfo {
  /** Shared by every image in one sweep (also used as its batchId). */
  id: string;
  x: SweepAxisInfo;
  xIndex: number;
  y?: SweepAxisInfo;
  yIndex?: number;
}
