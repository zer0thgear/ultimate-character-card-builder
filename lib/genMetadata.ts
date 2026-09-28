import { readTextChunks, type TextChunk } from '@/lib/png';

// Generation details read from an image's metadata, normalized across
// NovelAI (its `Comment` JSON, or the same JSON hidden in the alpha
// channel) and A1111-style `parameters` text. Pure, so the gen library (server) and drag-and-drop
// (browser) share it.

export interface GenInfo {
  prompt?: string;
  negative?: string;
  /** One per character prompt (NovelAI V4+), in order. */
  characters?: { prompt: string; uc: string }[];
  model?: string;
  seed?: number;
  steps?: number;
  scale?: number;
  cfgRescale?: number;
  sampler?: string;
  requestType?: string;
  /** Where the metadata came from, or undefined if the image had none. */
  source?: 'novelai' | 'novelai-stealth' | 'a1111' | 'description';
  /** The raw NovelAI Comment object, for "Reuse settings". */
  raw?: Record<string, unknown>;
}

const HASH_SUFFIX = /\s+[0-9A-F]{8}$/;

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function parseA1111(params: string): GenInfo {
  const [prompt, restAfterPrompt = ''] = splitOnce(params, '\nNegative prompt:');
  const [negative, settingsTail = ''] = splitOnce(restAfterPrompt, '\nSteps:');
  const settings = 'Steps:' + settingsTail;
  const field = (key: string) => settings.match(new RegExp(`${key}: ([^,]+)`))?.[1]?.trim();
  return {
    prompt: prompt.trim(),
    negative: negative.trim(),
    model: field('Model') ?? 'Stable Diffusion',
    seed: num(field('Seed')),
    steps: num(field('Steps')),
    scale: num(field('CFG scale')),
    sampler: field('Sampler'),
    source: 'a1111',
  };
}

function splitOnce(s: string, sep: string): [string, string?] {
  const i = s.indexOf(sep);
  return i < 0 ? [s] : [s.slice(0, i), s.slice(i + sep.length)];
}

/** Reads NovelAI's Comment object (from a chunk or the stealth copy). */
export function fromNovelAIComment(comment: Record<string, unknown>, extra: { source?: string; description?: string } = {}): GenInfo {
  const v4 = (comment.v4_prompt ?? {}) as { caption?: { base_caption?: string; char_captions?: { char_caption?: string }[] } };
  const v4neg = (comment.v4_negative_prompt ?? {}) as { caption?: { base_caption?: string; char_captions?: { char_caption?: string }[] } };
  const chars = v4.caption?.char_captions ?? [];
  const ucs = v4neg.caption?.char_captions ?? [];
  const modelSource = String(comment.model_name ?? extra.source ?? '');
  let model = modelSource.replace(HASH_SUFFIX, '').trim() || 'NovelAI';
  if (model === 'Stable Diffusion XL') model = 'NovelAI Diffusion V3'; // what NAI V3 calls itself
  const requestType = String(comment.request_type ?? '');
  return {
    prompt: v4.caption?.base_caption || (comment.prompt as string) || extra.description || '',
    negative: v4neg.caption?.base_caption || (comment.uc as string) || '',
    characters: 'v4_prompt' in comment
      ? chars.map((c, i) => ({ prompt: c.char_caption ?? '', uc: ucs[i]?.char_caption ?? '' })).filter((c) => c.prompt)
      : undefined,
    model,
    seed: num(comment.seed),
    steps: num(comment.steps),
    scale: num(comment.scale),
    cfgRescale: num(comment.cfg_rescale),
    sampler: typeof comment.sampler === 'string' ? comment.sampler : undefined,
    requestType: ({ PromptGenerateRequest: 'txt2img', Img2ImgRequest: 'img2img' } as Record<string, string>)[requestType] ?? requestType,
    raw: comment,
  };
}

/** Generation info from an image's text chunks alone (no pixel decoding). */
export function genInfoFromChunks(chunks: TextChunk[]): GenInfo {
  const info = Object.fromEntries(chunks.map((c) => [c.keyword, c.text]));
  if (info.parameters && !info.Comment) return parseA1111(info.parameters);
  if (info.Comment) {
    try {
      const comment = JSON.parse(info.Comment);
      if (comment && typeof comment === 'object') {
        return { ...fromNovelAIComment(comment, { source: info.Source, description: info.Description }), source: 'novelai' };
      }
    } catch {
      /* fall through */
    }
  }
  if (info.Description) return { prompt: info.Description, source: 'description' };
  return {};
}

export const genInfoFromPng = (png: Uint8Array) => genInfoFromChunks(readTextChunks(png));

// ─── Stealth metadata (alpha-channel LSBs, column-major, gzip'd JSON) ─────────

const STEALTH_MAGIC = 'stealth_pngcomp';

/**
 * NovelAI's hidden copy of its metadata, read from RGBA pixels. `inflate`
 * gunzips (zlib on the server, DecompressionStream in the browser).
 */
export async function readStealth(
  { width, height, data }: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
  gunzip: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<Record<string, unknown> | null> {
  const total = width * height;
  const headBits = (STEALTH_MAGIC.length + 4) * 8;
  if (total < headBits) return null;
  const bitAt = (i: number) => data[((i % height) * width + Math.floor(i / height)) * 4 + 3] & 1;
  const byteAt = (start: number) => {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bitAt(start + k);
    return b;
  };
  for (let i = 0; i < STEALTH_MAGIC.length; i++) if (byteAt(i * 8) !== STEALTH_MAGIC.charCodeAt(i)) return null;
  let nBits = 0;
  for (let i = 0; i < 4; i++) nBits = nBits * 256 + byteAt((STEALTH_MAGIC.length + i) * 8);
  if (nBits <= 0 || headBits + nBits > total) return null;
  const payload = new Uint8Array(Math.ceil(nBits / 8));
  for (let i = 0; i < payload.length; i++) payload[i] = byteAt(headBits + i * 8);
  try {
    const text = new TextDecoder().decode(await gunzip(payload));
    const json = JSON.parse(text);
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

/** Stealth JSON is the whole text-chunk dict; its Comment is a string. */
export function genInfoFromStealth(stealth: Record<string, unknown>): GenInfo {
  const chunks: TextChunk[] = Object.entries(stealth).map(([keyword, v]) => ({
    keyword,
    text: typeof v === 'string' ? v : JSON.stringify(v),
  }));
  const info = genInfoFromChunks(chunks);
  return info.source === 'novelai' ? { ...info, source: 'novelai-stealth' } : info;
}

/** Every prompt field joined, for search. */
export function searchableText(info: GenInfo): string {
  return [info.prompt, ...(info.characters ?? []).map((c) => c.prompt)].filter(Boolean).join('\n');
}
