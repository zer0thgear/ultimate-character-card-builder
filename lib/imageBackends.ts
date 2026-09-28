import type { BackendGenRequest, ComfyWorkflow, ImageBackendKind, ImageConnection } from '@/types/imageBackend';
import type { ResolvedRequestPrompts } from '@/lib/wildcards';
import { joinPromptParts } from '@/lib/promptText';
import { styleText } from '@/lib/imageRequest';
import { uuid } from '@/lib/uuid';

// The parts of A1111 and ComfyUI support that don't need a server: the
// prompt as those backends take it, their request bodies, and finding the
// nodes to fill in a ComfyUI workflow. Used by the browser (building a gen)
// and UCCB's server (sending it, lib/server/imageBackends.ts).

export const IMAGE_KIND_LABELS: Record<ImageBackendKind, string> = {
  novelai: 'NovelAI',
  a1111: 'A1111 / Forge',
  comfyui: 'ComfyUI',
};

export const DEFAULT_URLS: Record<Exclude<ImageBackendKind, 'novelai'>, string> = {
  a1111: 'http://127.0.0.1:7860',
  comfyui: 'http://127.0.0.1:8188',
};

export function newImageConnection(kind: ImageBackendKind): ImageConnection {
  return {
    id: uuid(),
    name: IMAGE_KIND_LABELS[kind],
    kind,
    baseUrl: kind === 'novelai' ? '' : DEFAULT_URLS[kind],
    auth: '',
    checkpoint: '',
    sampler: '',
    scheduler: '',
    workflow: null,
  };
}

/** A negative that suits most SD checkpoints (NovelAI's uses its own
 *  {emphasis} syntax). */
export const SD_DEFAULT_NEGATIVE = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry';

/**
 * The prompt for a backend without NovelAI's character prompts: the style
 * first, then the scene, then each character's prompt appended; their
 * negatives are appended to the negative the same way.
 */
export function composeBackendPrompts(form: { stylePrompt?: string }, resolved: ResolvedRequestPrompts): { prompt: string; negative: string } {
  // NovelAI's interaction tags (source#hug on one character, target#hug on
  // the other) are plain tags anywhere else.
  const plain = (tags: string) => tags.replace(/\b(?:source|target|mutual)#/gi, '');
  return {
    prompt: joinPromptParts(styleText(form.stylePrompt), resolved.baseText, ...resolved.characters.map((c) => plain(c.prompt))),
    negative: joinPromptParts(resolved.negativePrompt, ...resolved.characters.map((c) => c.uc)),
  };
}

// ─── A1111 ───────────────────────────────────────────────────────────────────

/** The body of A1111's /sdapi/v1/txt2img (or img2img, with an init image). */
export function a1111Payload(r: BackendGenRequest): Record<string, unknown> {
  return {
    prompt: r.prompt,
    negative_prompt: r.negative,
    width: r.width,
    height: r.height,
    steps: r.steps,
    cfg_scale: r.cfg,
    seed: r.seed,
    batch_size: 1,
    n_iter: 1,
    ...(r.sampler ? { sampler_name: r.sampler } : {}),
    ...(r.scheduler ? { scheduler: r.scheduler } : {}),
    // Switches the loaded checkpoint, and leaves it loaded for the next gen
    // (switching back each time would reload it every gen).
    ...(r.checkpoint ? { override_settings: { sd_model_checkpoint: r.checkpoint }, override_settings_restore_afterwards: false } : {}),
    ...(r.init ? { init_images: [r.init.image], denoising_strength: r.init.strength } : {}),
    send_images: true,
    save_images: false,
  };
}

// ─── ComfyUI ─────────────────────────────────────────────────────────────────

/** UCCB's own txt2img workflow, for a checkpoint picked from the server:
 *  the one ComfyUI starts with. The output is a preview, so gens don't pile
 *  up in ComfyUI's output folder too (UCCB keeps them). */
export function builtInWorkflow(): ComfyWorkflow {
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] }, _meta: { title: 'Positive' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] }, _meta: { title: 'Negative' } },
    '3': {
      class_type: 'KSampler',
      inputs: { seed: 0, steps: 28, cfg: 6, sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'PreviewImage', inputs: { images: ['8', 0] } },
  };
}

/** Where a workflow's settings go: node ids, found by walking from its sampler. */
export interface ComfySlots {
  sampler?: string;
  /** Node ids whose `text` is the prompt / the negative. */
  positive: string[];
  negative: string[];
  latent?: string;
  checkpoint?: string;
  /** Inputs holding %prompt% / %negative% etc., which win over the walk. */
  placeholders: { node: string; input: string; name: string }[];
}

const SAMPLER_TYPES = ['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced'];
const PLACEHOLDER = /^%(prompt|negative|seed|steps|cfg|width|height|sampler|scheduler|checkpoint)%$/;
const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';

/** The text nodes feeding a conditioning input, through any combiners. */
function textNodes(wf: ComfyWorkflow, link: unknown, seen = new Set<string>()): string[] {
  if (!isLink(link) || seen.has(link[0])) return [];
  seen.add(link[0]);
  const node = wf[link[0]];
  if (!node) return [];
  if (typeof node.inputs.text === 'string' || /TextEncode/i.test(node.class_type)) return [link[0]];
  return Object.values(node.inputs).flatMap((v) => textNodes(wf, v, seen));
}

/** Finds where the prompt, negative, size, seed and so on go in a workflow. */
export function findComfySlots(wf: ComfyWorkflow): ComfySlots {
  const slots: ComfySlots = { positive: [], negative: [], placeholders: [] };
  for (const [id, node] of Object.entries(wf)) {
    for (const [input, v] of Object.entries(node.inputs ?? {})) {
      const m = typeof v === 'string' ? v.trim().match(PLACEHOLDER) : null;
      if (m) slots.placeholders.push({ node: id, input, name: m[1] });
    }
  }
  const samplerId = Object.keys(wf).find((id) => SAMPLER_TYPES.includes(wf[id].class_type));
  if (samplerId) {
    slots.sampler = samplerId;
    let s = wf[samplerId];
    // SamplerCustomAdvanced takes a guider; the prompts hang off that.
    if (isLink(s.inputs.guider) && wf[s.inputs.guider[0]]) s = wf[s.inputs.guider[0]];
    slots.positive = textNodes(wf, s.inputs.positive ?? s.inputs.conditioning);
    slots.negative = textNodes(wf, s.inputs.negative);
    const latent = wf[samplerId].inputs.latent_image;
    if (isLink(latent) && wf[latent[0]] && 'width' in wf[latent[0]].inputs) slots.latent = latent[0];
  }
  // No sampler to walk from: go by the nodes' titles.
  if (!slots.positive.length) {
    const titled = (re: RegExp) => Object.keys(wf).filter((id) => typeof wf[id].inputs?.text === 'string' && re.test(wf[id]._meta?.title ?? ''));
    slots.positive = titled(/positive|prompt/i).filter((id) => !/negative/i.test(wf[id]._meta?.title ?? ''));
    slots.negative = titled(/negative/i);
  }
  slots.latent ??= Object.keys(wf).find((id) => /EmptyLatent|EmptySD3Latent|EmptyHunyuanLatent/i.test(wf[id].class_type));
  slots.checkpoint = Object.keys(wf).find((id) => /CheckpointLoader/i.test(wf[id].class_type) && 'ckpt_name' in wf[id].inputs);
  return slots;
}

/** What a workflow will take from UCCB, for Settings to show. */
export function describeSlots(slots: ComfySlots): string[] {
  const found: string[] = [];
  const names = new Set(slots.placeholders.map((p) => p.name));
  if (slots.positive.length || names.has('prompt')) found.push('prompt');
  if (slots.negative.length || names.has('negative')) found.push('negative');
  if (slots.sampler) found.push('seed, steps, CFG, sampler');
  if (slots.latent || names.has('width')) found.push('size');
  if (slots.checkpoint || names.has('checkpoint')) found.push('checkpoint');
  return found;
}

/** A copy of the workflow with this gen's settings put in. */
export function fillComfyWorkflow(wf: ComfyWorkflow, r: BackendGenRequest): ComfyWorkflow {
  const out: ComfyWorkflow = JSON.parse(JSON.stringify(wf));
  const slots = findComfySlots(out);
  const set = (id: string | undefined, input: string, value: unknown) => {
    if (id && out[id] && input in out[id].inputs && !isLink(out[id].inputs[input])) out[id].inputs[input] = value;
  };
  for (const id of slots.positive) set(id, 'text', r.prompt);
  for (const id of slots.negative) set(id, 'text', r.negative);
  if (slots.sampler) {
    const s = slots.sampler;
    set(s, 'seed', r.seed);
    set(s, 'noise_seed', r.seed);
    set(s, 'steps', r.steps);
    set(s, 'cfg', r.cfg);
    if (r.sampler) set(s, 'sampler_name', r.sampler);
    if (r.scheduler) set(s, 'scheduler', r.scheduler);
  }
  if (slots.latent) {
    set(slots.latent, 'width', r.width);
    set(slots.latent, 'height', r.height);
    set(slots.latent, 'batch_size', 1);
  }
  if (r.checkpoint) set(slots.checkpoint, 'ckpt_name', r.checkpoint);
  const values: Record<string, unknown> = { prompt: r.prompt, negative: r.negative, seed: r.seed, steps: r.steps, cfg: r.cfg, width: r.width, height: r.height, sampler: r.sampler, scheduler: r.scheduler, checkpoint: r.checkpoint };
  for (const p of slots.placeholders) out[p.node].inputs[p.input] = values[p.name];
  return out;
}

/** Reads a workflow file: ComfyUI's API format. The UI format (what plain
 *  Save writes) has no values to fill, so it's refused with a pointer. */
export function parseComfyWorkflow(text: string): ComfyWorkflow {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't JSON.");
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { nodes?: unknown }).nodes)) {
    throw new Error('That\'s a workflow in ComfyUI\'s editor format. In ComfyUI, use Workflow → Export (API) and pick that file instead.');
  }
  const wf = raw as ComfyWorkflow;
  const nodes = raw && typeof raw === 'object' ? Object.values(wf) : [];
  if (!nodes.length || !nodes.every((n) => n && typeof n === 'object' && typeof n.class_type === 'string' && typeof n.inputs === 'object')) {
    throw new Error("That doesn't look like a ComfyUI workflow in API format.");
  }
  return wf;
}
