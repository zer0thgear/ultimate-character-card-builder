import { describe, expect, it } from 'vitest';
import { compositeInpaint, dilate, inpaintFinisher, inpaintMatte, scaleUp } from '@/lib/inpaintComposite';
import { decodeImage, encodePng, Pixels, pngTextChunks, toBase64, withChunksAfterHeader } from '@/lib/requestImage';

// The reference values below came from running novelai.net's own inpaint
// finishing (its worker's matte, then its fade and blend) on these same
// inputs in its page on 2026-09-25.

const W = 256;
const H = 192;

const fnv = (values: ArrayLike<number>) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    h ^= values[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};

function original(): Pixels {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      data.set([(x * 7 + y * 3) & 255, (x ^ y) & 255, ((x * y) >> 5) & 255, 255], o);
    }
  }
  return { width: W, height: H, data };
}

/** A different picture, carrying a stealth marker in its alpha like a real
 *  result, so the marker handling is covered too. */
function result(): Pixels {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      data.set([(255 - x) & 255, (y * 5) & 255, ((x + y) * 11) & 255, 255], o);
    }
  }
  const bits: number[] = [];
  for (const c of 'stealth_pngcomp') for (let b = 7; b >= 0; b--) bits.push((c.charCodeAt(0) >> b) & 1);
  for (let k = 0; k < 2000; k++) bits.push(((k * 2654435761) >>> 13) & 1);
  bits.forEach((bit, l) => {
    data[4 * ((l % H) * W + Math.floor(l / H)) + 3] = 254 | bit;
  });
  return { width: W, height: H, data };
}

/** Cells 10–14 × 8–12 and a lone cell at (27, 2), as the full-size mask sent. */
function mask(): Pixels {
  const on = (cx: number, cy: number) => (cx >= 10 && cx <= 14 && cy >= 8 && cy <= 12) || (cx === 27 && cy === 2);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = on(x >> 3, y >> 3) ? 255 : 0;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}

describe('the matte', () => {
  it('matches novelai.net’s byte for byte', () => {
    const matte = inpaintMatte(mask());
    expect(fnv(matte)).toBe('5d9b0be3');
    // A column through the lone cell: full near it, fading to nothing.
    const col = Array.from({ length: 24 }, (_, i) => matte[(18 + i) * W + 220]);
    expect(col).toEqual([252, 251, 251, 250, 249, 248, 246, 245, 243, 241, 239, 237, 235, 232, 230, 227, 224, 221, 218, 215, 211, 208, 204, 200]);
  });

  it('is full over the mask’s middle and empty well away from it', () => {
    const matte = inpaintMatte(mask());
    expect(matte[80 * W + 96]).toBe(255);
    expect(matte[180 * W + 10]).toBe(0);
  });
});

describe('dilate and scaleUp', () => {
  it('dilate spreads white by the radius in a square, the rest opaque black', () => {
    const data = new Uint8ClampedArray(7 * 7 * 4);
    data.set([255, 255, 255, 255], (3 * 7 + 3) * 4);
    const out = dilate({ width: 7, height: 7, data }, 2);
    const white = (x: number, y: number) => out.data[(y * 7 + x) * 4] === 255;
    expect(white(1, 1)).toBe(true);
    expect(white(5, 5)).toBe(true);
    expect(white(0, 3)).toBe(false);
    expect(out.data[3]).toBe(255);
  });

  it('scaleUp repeats each pixel', () => {
    const out = scaleUp({ width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]) }, 2);
    expect([out.width, out.height]).toEqual([4, 2]);
    expect(Array.from(out.data.slice(0, 16))).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 5, 6, 7, 8]);
    expect(Array.from(out.data.slice(16, 20))).toEqual([1, 2, 3, 4]);
  });
});

describe('compositeInpaint', () => {
  it('matches novelai.net’s byte for byte', () => {
    const out = compositeInpaint(original(), result(), inpaintMatte(mask()));
    expect(fnv(out.data)).toBe('116ed7f');
  });

  it('keeps the original outside the matte, bar the result’s metadata bit', () => {
    const orig = original();
    const res = result();
    const out = compositeInpaint(orig, res, new Uint8ClampedArray(W * H));
    for (let i = 0; i < W * H * 4; i++) {
      expect(out.data[i]).toBe((i & 3) === 3 ? (orig.data[i] & ~1) | (res.data[i] & 1) : orig.data[i]);
    }
  });

  it('is the result where the matte is full', () => {
    const res = result();
    const out = compositeInpaint(original(), res, new Uint8ClampedArray(W * H).fill(255));
    expect(Array.from(out.data)).toEqual(Array.from(res.data));
  });
});

describe('inpaintFinisher', () => {
  const b64 = async (p: Pixels) => toBase64(await encodePng(p));
  // A text chunk as the server's would be (the CRC isn't checked here).
  const comment = new Uint8Array([0, 0, 0, 9, ...new TextEncoder().encode('tEXtTitle\0Hi!'), 1, 2, 3, 4]);

  it('gives the composite, with the result’s text chunks after the header', async () => {
    const finish = inpaintFinisher(await b64(original()), await b64(mask()));
    const raw = withChunksAfterHeader(await encodePng(result()), [comment]);
    const out = new Uint8Array(await (await finish(new Blob([raw as BlobPart]))).arrayBuffer());
    expect(fnv((await decodeImage(out)).data)).toBe('116ed7f');
    const chunks = pngTextChunks(out);
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0])).toEqual(Array.from(comment));
    // Straight after IHDR (8-byte signature + 25-byte IHDR chunk).
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('tEXt');
  });

  it('leaves a result of another size as it came', async () => {
    const finish = inpaintFinisher(await b64(original()), await b64(mask()));
    const small = new Blob([(await encodePng({ width: 8, height: 8, data: new Uint8ClampedArray(256) })) as BlobPart]);
    expect(await finish(small)).toBe(small);
  });
});
