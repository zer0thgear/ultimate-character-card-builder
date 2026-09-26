import { GeneratedImage, NovelAIModel, PromptSource } from '@/types/novelai';
import { varietyWasOn } from '@/lib/variety';
import { stripAutoText } from '@/lib/autoText';

// NovelAI embeds generation metadata directly in PNG tEXt chunks on every
// image its server returns (confirmed 2026-09-17 by reading the raw bytes of
// an image this app itself generated — see memory/project_novelai_metadata.md):
//   Title, Description (= the composed positive prompt), Software ("NovelAI"),
//   Source (e.g. "NovelAI Diffusion V5 0ADF9AB7"), Generation_time, and
//   Comment — a JSON blob with the full generation parameters, including the
//   same v4_prompt/v4_negative_prompt caption structure this codebase already
//   builds requests with.
//
// The same fields are also hidden in the alpha channel ("stealth" metadata,
// see readStealthText). That copy survives what strips PNG text chunks, such
// as copying the image to the clipboard, which is how NovelAI's own site still
// finds the metadata of a pasted image.

export interface ParsedCharacter {
  prompt: string;
  uc: string;
  center: { x: number; y: number };
}

export interface ParsedNaiMetadata {
  prompt: string;
  negativePrompt: string;
  characters: ParsedCharacter[];
  seed: number;
  steps: number;
  scale: number;
  width: number;
  height: number;
  sampler?: string;
  noiseSchedule?: string;
  smea: boolean;
  smeaDyn: boolean;
  cfgRescale: number;
  /** Whether Variety+ was on, i.e. the image carries a skip_cfg_above_sigma. */
  variety: boolean;
  /** Best-effort guess from the "Source"/model_name text — NOT authoritative,
   *  the metadata doesn't distinguish Full vs Curated. `undefined` if no
   *  confident guess could be made; callers should leave the current model
   *  selection untouched in that case rather than silently picking one. */
  guessedModel?: NovelAIModel;
  /** Only known for this app's own history images (see metadataFromImage):
   *  the sidebar modifiers that produced it, restored with Settings. */
  modifiers?: PromptSource['modifiers'];
  /** Set when the image can't be remade from its metadata alone, for the
   *  same reasons (and in the same order) NovelAI's import dialog checks. */
  notReproducible?: NotReproducibleReason;
  /** Img2Img strength and noise, when that's how the image was made. */
  img2img?: { strength: number; noise: number };
  /** A Director Tools result. NovelAI offers no import for these. */
  directorTool?: boolean;
}

export type NotReproducibleReason = 'img2img' | 'inpainting' | 'vibeTransferNoEncoding' | 'characterReference';

/** NovelAI's wording, from its import dialog. */
export const NOT_REPRODUCIBLE_TEXT: Record<NotReproducibleReason, string> = {
  img2img: 'This image was generated using Image2Image and cannot be reproduced from its metadata.',
  inpainting: 'This image was generated using Inpainting and cannot be reproduced from its metadata.',
  vibeTransferNoEncoding:
    'This image was generated using Vibe Transfer and contains no encodings, it cannot be reproduced from its metadata.',
  characterReference: 'This image was generated using Precise Reference and cannot be reproduced from its metadata.',
};

/** The same shape as a dropped PNG's metadata, but read from a history image,
 *  which knows more: the prompt before modifiers were applied (so reusing it
 *  doesn't double up quality tags or prefixes), the exact model, and the
 *  modifiers themselves. Images from before that was recorded fall back to
 *  the text that was actually sent. */
export function metadataFromImage(image: GeneratedImage): ParsedNaiMetadata {
  const p = image.parameters;
  return {
    prompt:
      image.source?.prompt ??
      stripAutoText(image.prompt, p.characterPrompts ?? [], p.v4_prompt?.use_coords ?? p.use_coords ?? false),
    negativePrompt: image.source?.negativePrompt ?? image.negativePrompt,
    characters: (p.characterPrompts ?? []).map((c) => ({ prompt: c.prompt, uc: c.uc, center: c.center })),
    seed: image.seed,
    steps: p.steps,
    scale: p.scale,
    width: p.width,
    height: p.height,
    sampler: p.sampler,
    noiseSchedule: p.noise_schedule,
    smea: p.sm ?? false,
    smeaDyn: p.sm_dyn ?? false,
    cfgRescale: p.cfg_rescale,
    variety: varietyWasOn(p.skip_cfg_above_sigma),
    guessedModel: image.model,
    modifiers: image.source?.modifiers,
  };
}

function readPngTextChunks(bytes: Uint8Array): Record<string, string> {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return {};
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('latin1');
  const out: Record<string, string> = {};
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) break;

    if (type === 'tEXt') {
      const raw = bytes.slice(dataStart, dataStart + length);
      const nullIdx = raw.indexOf(0);
      if (nullIdx >= 0) {
        out[decoder.decode(raw.slice(0, nullIdx))] = decoder.decode(raw.slice(nullIdx + 1));
      }
    }
    // iTXt (UTF-8, possibly compressed) isn't produced by NovelAI's own
    // server as of this writing, so it's intentionally not handled here.

    offset = dataStart + length + 4; // skip CRC
    if (type === 'IEND') break;
  }

  return out;
}

function guessModel(sourceOrModelName: string | undefined): NovelAIModel | undefined {
  if (!sourceOrModelName) return undefined;
  const s = sourceOrModelName.toLowerCase();
  if (s.includes('furry')) return 'nai-diffusion-furry-3';
  if (s.includes('v5')) return 'nai-diffusion-5-full';
  if (s.includes('v4.5') || s.includes('4-5')) return 'nai-diffusion-4-5-full';
  if (s.includes('v4')) return 'nai-diffusion-4-full';
  if (s.includes('v3') || s.includes('diffusion 3')) return 'nai-diffusion-3';
  return undefined;
}

// ─── Stealth (alpha channel) metadata ────────────────────────────────────────

export const STEALTH_MAGIC = 'stealth_pngcomp';
// NovelAI's client skips images larger than this.
export const MAX_STEALTH_PIXELS = 0x1000000;

/**
 * Reads NovelAI's "stealth" metadata: one bit per pixel in the lowest bit of
 * alpha, running down each column in turn. It holds the "stealth_pngcomp"
 * marker, a 32-bit big-endian length in bits, then gzipped JSON with the same
 * fields as the text chunks. Mirrors the reader in NovelAI's own client.
 * Needs lossless alpha (PNG, or WebP with its alpha intact).
 */
async function readStealthText(blob: Blob): Promise<Record<string, string> | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    return null; // not an image the browser can decode
  }
  const { width, height } = bitmap;
  const total = width * height;
  if (total > MAX_STEALTH_PIXELS || total < (STEALTH_MAGIC.length + 4) * 8) {
    bitmap.close();
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, width, height);

  let bit = 0;
  const readByte = () => {
    let byte = 0;
    for (let i = 0; i < 8; i++, bit++) {
      const pixel = (bit % height) * width + Math.floor(bit / height);
      byte |= (data[pixel * 4 + 3] & 1) << (7 - i);
    }
    return byte;
  };

  for (let i = 0; i < STEALTH_MAGIC.length; i++) {
    if (readByte() !== STEALTH_MAGIC.charCodeAt(i)) return null;
  }
  const bits = ((readByte() << 24) | (readByte() << 16) | (readByte() << 8) | readByte()) >>> 0;
  if (bits === 0 || bits > total - bit) return null;
  const payload = new Uint8Array(Math.ceil(bits / 8));
  for (let i = 0; i < payload.length; i++) payload[i] = readByte();

  try {
    const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'));
    const fields: unknown = JSON.parse(await new Response(stream).text());
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
    return Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
    );
  } catch {
    return null;
  }
}

/** The metadata text fields of an image: its PNG text chunks, or failing
 *  that its stealth metadata (as NovelAI checks them). Empty if neither. */
export async function readNaiText(blob: Blob): Promise<Record<string, string>> {
  const chunks = readPngTextChunks(new Uint8Array(await blob.arrayBuffer()));
  if (chunks.Comment) return chunks;
  return (await readStealthText(blob)) ?? chunks;
}

/** An image's NovelAI metadata, parsed, plus the raw text fields it came from. */
export async function readNaiMetadata(
  blob: Blob,
): Promise<{ parsed: ParsedNaiMetadata | null; raw: Record<string, string> }> {
  const raw = await readNaiText(blob);
  return { parsed: parseNaiText(raw), raw };
}

/** NovelAI's import-dialog checks, in its order. */
function notReproducibleReason(data: Record<string, unknown>): NotReproducibleReason | undefined {
  const nonEmpty = (v: unknown) => Array.isArray(v) && v.length > 0;
  if (data.request_type === 'Img2ImgRequest') return 'img2img';
  if (data.request_type === 'NativeInfillingRequest') return 'inpainting';
  if (nonEmpty(data.reference_strength_multiple) && !nonEmpty(data.reference_image_multiple)) {
    return 'vibeTransferNoEncoding';
  }
  if (nonEmpty(data.director_reference_strengths)) return 'characterReference';
  return undefined;
}

function parseNaiText(chunks: Record<string, string>): ParsedNaiMetadata | null {
  if (!chunks.Comment) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(chunks.Comment);
  } catch {
    return null;
  }

  const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

  type Captions = { caption?: { base_caption?: string; char_captions?: { char_caption: string; centers: { x: number; y: number }[] }[] } };
  const v4Prompt = data.v4_prompt as Captions | undefined;
  const charCaptions = v4Prompt?.caption?.char_captions ?? [];
  // Per-character negatives live in a parallel array, paired by index, so
  // pair them up before filtering out empty characters.
  const charNegatives = (data.v4_negative_prompt as Captions | undefined)?.caption?.char_captions ?? [];

  // Like NovelAI's import, drop the "teXt:" section V5 added from quoted text.
  const useCoords = (data.v4_prompt as { use_coords?: unknown } | undefined)?.use_coords === true;
  const captionChars = charCaptions.map((c) => ({ prompt: c.char_caption ?? '', center: c.centers?.[0] ?? { x: 0.5, y: 0.5 } }));
  return {
    prompt: stripAutoText(str(data.prompt, str(v4Prompt?.caption?.base_caption, '')), captionChars, useCoords),
    negativePrompt: str(data.uc, ''),
    characters: charCaptions
      .map((c, i) => ({
        prompt: c.char_caption,
        uc: str(charNegatives[i]?.char_caption, ''),
        center: c.centers?.[0] ?? { x: 0.5, y: 0.5 },
      }))
      .filter((c) => c.prompt?.trim()),
    seed: num(data.seed, 0),
    steps: num(data.steps, 28),
    scale: num(data.scale, 6),
    width: num(data.width, 832),
    height: num(data.height, 1216),
    sampler: typeof data.sampler === 'string' ? data.sampler : undefined,
    noiseSchedule: typeof data.noise_schedule === 'string' ? data.noise_schedule : undefined,
    smea: data.sm === true,
    smeaDyn: data.sm_dyn === true,
    cfgRescale: num(data.cfg_rescale, 0),
    variety: varietyWasOn(typeof data.skip_cfg_above_sigma === 'number' ? data.skip_cfg_above_sigma : null),
    guessedModel: guessModel(str(data.model_name, chunks.Source)),
    notReproducible: notReproducibleReason(data),
    ...(data.request_type === 'Img2ImgRequest'
      ? { img2img: { strength: num(data.strength, 0), noise: num(data.noise, 0) } }
      : {}),
    ...(data.req_type !== undefined ? { directorTool: true } : {}),
  };
}
