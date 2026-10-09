import { Effort, NovelAIModel } from '@/types/novelai';

export const MODELS: { value: NovelAIModel; label: string }[] = [
  { value: 'nai-diffusion-5-full', label: 'NAI Diffusion V5 Full' },
  { value: 'nai-diffusion-5-curated', label: 'NAI Diffusion V5 Curated' },
  { value: 'nai-diffusion-4-5-full', label: 'NAI Diffusion V4.5 Full' },
  { value: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion V4.5 Curated' },
  { value: 'nai-diffusion-4-curated-preview', label: 'NAI Diffusion V4 Curated' },
  { value: 'nai-diffusion-4-full', label: 'NAI Diffusion V4 Full' },
  { value: 'nai-diffusion-3', label: 'NAI Diffusion V3 (Anime)' },
  { value: 'nai-diffusion-furry-3', label: 'NAI Diffusion V3 (Furry)' },
];

/** How many characters a model takes at once, from NovelAI's own model table
 *  (`maxCharacters`, read 2026-09-19). V5 raised this from the 22 it launched
 *  with; V4 and V4.5 take 6. */
export const maxCharacters = (model: NovelAIModel) => (model.startsWith('nai-diffusion-5') ? 32 : 6);

/** The picker label without the "NAI Diffusion" prefix, e.g. "V5 Full". */
export function modelShortName(model: NovelAIModel): string {
  if (isMediumEffort(model)) return `${modelShortName(withEffort(model, 'high'))} (Medium)`;
  const label = MODELS.find((m) => m.value === model)?.label ?? model;
  return label.replace(/^NAI Diffusion /, '');
}

// ─── Effort (V5 Full only) ───────────────────────────────────────────────────
//
// NovelAI's Effort toggle (announced 2026-10-08), as zer0-novel-utilities
// read it from novelai.net's client. High is V5 Full as it was. Medium is a
// separate, distilled model, `nai-diffusion-5-full-medium` (and its
// inpainting model), which the toggle switches to; it has V5 Full's
// capabilities except CFG Rescale, and fixes steps, sampler and the UC
// preset (MEDIUM_EFFORT).

const MEDIUM: Partial<Record<NovelAIModel, NovelAIModel>> = {
  'nai-diffusion-5-full': 'nai-diffusion-5-full-medium',
  'nai-diffusion-5-full-inpainting': 'nai-diffusion-5-full-medium-inpainting',
};
const HIGH: Partial<Record<NovelAIModel, NovelAIModel>> = {
  'nai-diffusion-5-full-medium': 'nai-diffusion-5-full',
  'nai-diffusion-5-full-medium-inpainting': 'nai-diffusion-5-full-inpainting',
};

/** Whether the model has the Effort toggle: V5 Full, at either effort. */
export const hasEffort = (model: NovelAIModel) => model in MEDIUM || model in HIGH;

/** Whether this is a Medium effort model (generation or inpainting). */
export const isMediumEffort = (model: NovelAIModel) => model in HIGH;

/** The model a request uses for this effort. Models without the toggle are
 *  returned as they are. */
export function withEffort(model: NovelAIModel, effort: Effort | undefined): NovelAIModel {
  return (effort === 'medium' ? MEDIUM[model] : HIGH[model]) ?? model;
}

/** How an image's model reads back into the form: its model in the list,
 *  and the effort, for V5 Full (undefined otherwise). */
export function splitEffort(model: NovelAIModel): { model: NovelAIModel; effort?: Effort } {
  if (isMediumEffort(model)) return { model: HIGH[model]!, effort: 'medium' };
  if (hasEffort(model)) return { model, effort: 'high' };
  return { model };
}

/** What Medium effort fixes, as NovelAI's model table has it
 *  (`fixedSettings`). Its request prep also sends the UC preset's text alone,
 *  with no custom Undesired Content (characters' included), and no
 *  `cfg_rescale` (the model has no CFG Rescale). */
export const MEDIUM_EFFORT = {
  steps: 14,
  sampler: 'k_euler_ancestral',
  ucPreset: 'heavy',
} as const;
