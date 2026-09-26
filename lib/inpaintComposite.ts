// How novelai.net finishes an inpaint (read from its client on 2026-09-24).
//
// It doesn't show the server's image as it comes back. It pastes the result
// over the original through a feathered matte made from the mask, so outside
// the mask the picture is exactly the original, and the new content fades in
// over the mask's edge:
//   1. the mask at an eighth of the size, white where it's set;
//   2. spread by 4 cells in every direction (a square dilation);
//   3. scaled back up by 8, nearest neighbour;
//   4. box-blurred, radius 20, twice;
//   5. that brightness is the result's opacity over the original.
// The image operations run in its web worker (chunk 687); dilate and blur
// are ported from it as they are, tables included, so the matte comes out
// byte for byte the same. The last step also puts back the result's hidden
// metadata (the alpha low bits) and its PNG text chunks, so the finished
// picture still says how it was made.

import {
  clearStealthAlpha,
  decodeImage,
  encodePng,
  fromBase64,
  hasStealthMarker,
  Pixels,
  pngTextChunks,
  withChunksAfterHeader,
} from '@/lib/requestImage';

/** The mask is on the 8-pixel latent grid. */
const CELL = 8;
const DILATE_CELLS = 4;
const BLUR_RADIUS = 20;
const BLUR_PASSES = 2;

// Division by (2r + 1)² as a multiply and shift, per radius (the worker's own).
// prettier-ignore
const MUL = new Uint8Array([1,57,41,21,203,34,97,73,227,91,149,62,105,45,39,137,241,107,3,173,39,71,65,238,219,101,187,87,81,151,141,133,249,117,221,209,197,187,177,169,5,153,73,139,133,127,243,233,223,107,103,99,191,23,177,171,165,159,77,149,9,139,135,131,253,245,119,231,224,109,211,103,25,195,189,23,45,175,171,83,81,79,155,151,147,9,141,137,67,131,129,251,123,30,235,115,113,221,217,53,13,51,50,49,193,189,185,91,179,175,43,169,83,163,5,79,155,19,75,147,145,143,35,69,17,67,33,65,255,251,247,243,239,59,29,229,113,111,219,27,213,105,207,51,201,199,49,193,191,47,93,183,181,179,11,87,43,85,167,165,163,161,159,157,155,77,19,75,37,73,145,143,141,35,138,137,135,67,33,131,129,255,63,250,247,61,121,239,237,117,29,229,227,225,111,55,109,216,213,211,209,207,205,203,201,199,197,195,193,48,190,47,93,185,183,181,179,178,176,175,173,171,85,21,167,165,41,163,161,5,79,157,78,154,153,19,75,149,74,147,73,144,143,71,141,140,139,137,17,135,134,133,66,131,65,129,1]);
// prettier-ignore
const SHG = new Uint8Array([0,9,10,10,14,12,14,14,16,15,16,15,16,15,15,17,18,17,12,18,16,17,17,19,19,18,19,18,18,19,19,19,20,19,20,20,20,20,20,20,15,20,19,20,20,20,21,21,21,20,20,20,21,18,21,21,21,21,20,21,17,21,21,21,22,22,21,22,22,21,22,21,19,22,22,19,20,22,22,21,21,21,22,22,22,18,22,22,21,22,22,23,22,20,23,22,22,23,23,21,19,21,21,21,23,23,23,22,23,23,21,23,22,23,18,22,23,20,22,23,23,23,21,22,20,22,21,22,24,24,24,24,24,22,21,24,23,23,24,21,24,23,24,22,24,24,22,24,24,22,23,24,24,24,20,23,22,23,24,24,24,24,24,24,24,23,21,23,22,23,24,24,24,22,24,24,24,23,22,24,24,25,23,25,25,23,24,25,25,24,22,25,25,25,24,23,24,25,25,25,25,25,25,25,25,25,25,25,25,23,25,23,24,25,25,25,25,25,25,25,25,25,24,22,25,25,23,25,25,20,24,25,24,25,25,22,24,25,24,25,24,25,25,24,25,25,25,25,22,25,25,25,24,25,24,25,18]);

/**
 * The worker's blur: a box blur over RGB (alpha untouched), repeated
 * `passes` times (1–3), each a horizontal then a vertical sweep with the
 * edges clamped. Blurs `image` in place and returns it.
 */
export function boxBlur(image: Pixels, radius: number, passes: number): Pixels {
  const { width, height } = image;
  if (Number.isNaN(radius) || radius < 1) throw new Error('Radius is required and must be greater than 0');
  radius = Math.trunc(radius);
  passes = Math.min(3, Math.max(1, Math.trunc(Number.isNaN(passes) ? 1 : passes)));
  const lastX = width - 1;
  const lastY = height - 1;
  const rowBytes = width << 2;
  const span = radius + 1;
  const mul = MUL[radius];
  const shg = SHG[radius];
  const sumR = new Int16Array(width * height);
  const sumG = new Int16Array(width * height);
  const sumB = new Int16Array(width * height);
  const addX = new Uint16Array(width);
  const subX = new Uint16Array(width);
  const addY = new Uint16Array(height);
  const subY = new Uint16Array(height);
  const firstRun = Math.min(lastX, radius);
  for (let x = 0; x < width; ++x) {
    addX[x] = Math.min(x + span, lastX) << 2;
    subX[x] = Math.max(x - radius, 0) << 2;
  }
  for (let y = 0; y < height; ++y) {
    addY[y] = Math.min(y + span, lastY);
    subY[y] = Math.max(y - radius, 0);
  }
  const bytes = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const px = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);

  for (let pass = 0; pass < passes; pass++) {
    // Horizontal: running sums along each row, stored per pixel.
    for (let y = 0, i = 0, rowStart = 0; y < height; ++y, rowStart += rowBytes) {
      const row = bytes.subarray(rowStart, rowStart + rowBytes);
      let r = row[0] * span;
      let g = row[1] * span;
      let b = row[2] * span;
      for (let x = 1; x <= firstRun; ++x) {
        r += row[x << 2];
        g += row[(x << 2) + 1];
        b += row[(x << 2) + 2];
      }
      if (radius > lastX) {
        r += row[rowBytes - 4] * (radius - lastX);
        g += row[rowBytes - 3] * (radius - lastX);
        b += row[rowBytes - 2] * (radius - lastX);
      }
      for (let x = 0; x < width; ++x, ++i) {
        sumR[i] = r;
        sumG[i] = g;
        sumB[i] = b;
        const add = addX[x];
        const sub = subX[x];
        // Only worth doing when either end isn't black, as the worker does.
        if ((px[(rowStart + add) >> 2] | px[(rowStart + sub) >> 2]) & 0xffffff) {
          r += row[add] - row[sub];
          g += row[add + 1] - row[sub + 1];
          b += row[add + 2] - row[sub + 2];
        }
      }
    }
    // Vertical: running sums of those down each column, written back.
    for (let x = 0; x < width; ++x) {
      let i = x;
      let r = sumR[i] * span;
      let g = sumG[i] * span;
      let b = sumB[i] * span;
      for (let k = 1; k <= radius; k++) {
        if (k <= lastY) i += width;
        r += sumR[i];
        g += sumG[i];
        b += sumB[i];
      }
      for (let y = 0, p = x; y < height; ++y, p += width) {
        px[p] =
          (b | g | r) === 0
            ? px[p] & 0xff000000
            : (px[p] & 0xff000000) | (((b * mul) >> shg) << 16) | (((g * mul) >> shg) << 8) | ((r * mul) >> shg);
        const add = x + addY[y] * width;
        const sub = x + subY[y] * width;
        r += sumR[add] - sumR[sub];
        g += sumG[add] - sumG[sub];
        b += sumB[add] - sumB[sub];
      }
    }
  }
  return image;
}

/** The worker's dilate: every pixel within `radius` (a square) of one whose
 *  red is 255 becomes opaque white; everything else opaque black. */
export function dilate(image: Pixels, radius: number): Pixels {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] !== 255) continue;
      for (let yy = Math.max(0, y - radius); yy < Math.min(height, y + radius + 1); yy++) {
        for (let xx = Math.max(0, x - radius); xx < Math.min(width, x + radius + 1); xx++) {
          const o = (yy * width + xx) * 4;
          out[o] = 255;
          out[o + 1] = 255;
          out[o + 2] = 255;
        }
      }
    }
  }
  return { width, height, data: out };
}

/** Nearest-neighbour enlargement by a whole factor (the worker calls this
 *  linearScale). */
export function scaleUp(image: Pixels, factor: number): Pixels {
  const width = image.width * factor;
  const height = image.height * factor;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
      out[o] = image.data[s];
      out[o + 1] = image.data[s + 1];
      out[o + 2] = image.data[s + 2];
      out[o + 3] = image.data[s + 3];
    }
  }
  return { width, height, data: out };
}

/**
 * The feathered matte for a mask as it was sent (full size, white where to
 * regenerate): one byte per pixel, 255 where the result shows through.
 */
export function inpaintMatte(mask: Pixels): Uint8ClampedArray {
  const cw = Math.floor(mask.width / CELL);
  const ch = Math.floor(mask.height / CELL);
  // An eighth of the size, cell by cell: white where set, opaque black
  // elsewhere (the worker's replaceTransparent on the thresholded mask).
  const small: Pixels = { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const on = mask.data[(y * CELL * mask.width + x * CELL) * 4] > 127 ? 255 : 0;
      small.data.set([on, on, on, 255], (y * cw + x) * 4);
    }
  }
  const matte = boxBlur(scaleUp(dilate(small, DILATE_CELLS), CELL), BLUR_RADIUS, BLUR_PASSES);
  const alpha = new Uint8ClampedArray(mask.width * mask.height);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      // A size that isn't a multiple of 8 leaves a sliver the matte doesn't
      // reach; it keeps the original there.
      if (x >= matte.width || y >= matte.height) continue;
      alpha[y * mask.width + x] = matte.data[(y * matte.width + x) * 4];
    }
  }
  return alpha;
}

/**
 * The result over the original through the matte, with the same rounding
 * as novelai.net's compositing (its fade-out, fade-in and blend steps). The
 * result's alpha low bits, where its hidden metadata lives, are kept.
 */
export function compositeInpaint(original: Pixels, result: Pixels, matte: Uint8ClampedArray): Pixels {
  const { width, height } = original;
  const out = new Uint8ClampedArray(original.data);
  const src = new Uint8ClampedArray(result.data);
  // It wipes the marker's bits (254 → 255, 1 → 0) before fading the result
  // in; they're put back at the end.
  if (hasStealthMarker(result)) clearStealthAlpha({ width, height, data: src });
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const m = matte[i];
    // The result fades in with the matte, the original out with it.
    src[o + 3] = Math.round((src[o + 3] * m) / 255);
    out[o + 3] = Math.round((out[o + 3] * (255 - m)) / 255);
    const h = src[o + 3] / 255;
    const d = out[o + 3] / 255;
    const f = Math.min(1, h + d);
    if (f !== 0) {
      out[o] = Math.min(255, (src[o] * h + out[o] * d) / f);
      out[o + 1] = Math.min(255, (src[o + 1] * h + out[o + 1] * d) / f);
      out[o + 2] = Math.min(255, (src[o + 2] * h + out[o + 2] * d) / f);
      out[o + 3] = Math.round(255 * f);
    }
    // Then the result's metadata bit goes back in.
    out[o + 3] = (out[o + 3] & ~1) | (result.data[o + 3] & 1);
  }
  return { width, height, data: out };
}

/**
 * Finishes each image an inpaint request brings back, as novelai.net does:
 * the result over the image that was sent, through the mask's matte. The
 * matte and the decoded original are made once and shared by every sample.
 * An image that can't be finished (a size that doesn't match, say) is kept
 * as it came.
 */
export function inpaintFinisher(imageB64: string, maskB64: string): (result: Blob) => Promise<Blob> {
  let prepared: Promise<{ original: Pixels; matte: Uint8ClampedArray }> | undefined;
  const prepare = () =>
    (prepared ??= (async () => {
      const [original, mask] = await Promise.all([decodeImage(fromBase64(imageB64)), decodeImage(fromBase64(maskB64))]);
      return { original, matte: inpaintMatte(mask) };
    })());
  return async (result) => {
    try {
      const { original, matte } = await prepare();
      const raw = new Uint8Array(await result.arrayBuffer());
      const pixels = await decodeImage(raw);
      if (pixels.width !== original.width || pixels.height !== original.height || matte.length !== original.width * original.height) {
        return result;
      }
      const png = await encodePng(compositeInpaint(original, pixels, matte));
      return new Blob([withChunksAfterHeader(png, pngTextChunks(raw)) as BlobPart], { type: 'image/png' });
    } catch (err) {
      console.error('Could not finish the inpaint:', err);
      return result;
    }
  };
}
