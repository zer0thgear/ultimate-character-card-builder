import 'server-only';
import sharp from 'sharp';
import { gunzipSync } from 'node:zlib';
import { readStealth } from '@/lib/genMetadata';

// Taking NovelAI's generation metadata out of a PNG: its text chunks, and
// the copy it hides in the alpha channel, which survives removing them.

export async function hasStealth(png: Buffer): Promise<boolean> {
  try {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return (await readStealth({ width: info.width, height: info.height, data }, async (b) => gunzipSync(b))) !== null;
  } catch {
    return false;
  }
}

/** The picture without its hidden metadata: an opaque picture loses its
 *  alpha channel altogether; otherwise near-opaque and near-clear alpha
 *  (where the bits hide) is snapped to fully opaque and fully clear, as
 *  NovelAI's own canvas does. */
export async function scrubbed(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 254) opaque = false;
    if (data[i] === 254) data[i] = 255;
    else if (data[i] === 1) data[i] = 0;
  }
  const img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  return opaque ? img.removeAlpha() : img;
}

/** A PNG with no generation metadata at all (text chunks or hidden). */
export async function withoutMetadata(png: Buffer): Promise<Buffer> {
  const img = (await hasStealth(png)) ? await scrubbed(png) : sharp(png);
  return img.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}
