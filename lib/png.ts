// PNG chunk reading and writing, shared by card import/export (the `chara`
// and `ccv3` tEXt chunks) and the gen library (NovelAI's `Comment` chunk).
// Works on plain bytes so it runs the same in the browser and on the server.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const isPng = (b: Uint8Array) => b.length >= 8 && SIGNATURE.every((x, i) => b[i] === x);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface PngChunk {
  type: string;
  /** The chunk's data, without length, type or CRC. */
  data: Uint8Array;
  /** Where the whole chunk (length through CRC) sits in the file. */
  start: number;
  end: number;
}

/** Every chunk in the file, stopping at IEND or at a truncated chunk. */
export function readChunks(png: Uint8Array): PngChunk[] {
  if (!isPng(png)) return [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: PngChunk[] = [];
  for (let offset = 8; offset + 12 <= png.length; ) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > png.length) break;
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length), start: offset, end });
    if (type === 'IEND') break;
    offset = end;
  }
  return chunks;
}

export function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const latin1 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};

export interface TextChunk {
  keyword: string;
  text: string;
}

/** tEXt chunks as keyword/text pairs, plus uncompressed iTXt ones (text read
 *  as UTF-8, as that chunk type specifies). */
export function readTextChunks(png: Uint8Array): TextChunk[] {
  const out: TextChunk[] = [];
  for (const chunk of readChunks(png)) {
    if (chunk.type === 'tEXt') {
      const sep = chunk.data.indexOf(0);
      if (sep < 0) continue;
      out.push({ keyword: latin1(chunk.data.subarray(0, sep)), text: latin1(chunk.data.subarray(sep + 1)) });
    } else if (chunk.type === 'iTXt') {
      const d = chunk.data;
      const sep = d.indexOf(0);
      if (sep < 0 || d[sep + 1] !== 0) continue; // compressed iTXt: not used by anything we read
      let at = sep + 3; // null, compression flag, compression method
      const langEnd = d.indexOf(0, at);
      if (langEnd < 0) continue;
      const transEnd = d.indexOf(0, langEnd + 1);
      if (transEnd < 0) continue;
      at = transEnd + 1;
      out.push({ keyword: latin1(d.subarray(0, sep)), text: new TextDecoder().decode(d.subarray(at)) });
    }
  }
  return out;
}

const TEXT_TYPES = new Set(['tEXt', 'iTXt', 'zTXt']);

/**
 * The PNG with its text chunks replaced: `keep` decides which existing ones
 * stay (none, by default), and `add` are written as tEXt just before IEND,
 * where they can't split the IDAT run.
 */
export function replaceTextChunks(
  png: Uint8Array,
  add: TextChunk[],
  keep: (chunk: PngChunk, keyword: string) => boolean = () => false,
): Uint8Array {
  const chunks = readChunks(png);
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  for (const chunk of chunks) {
    if (chunk.type === 'IEND') {
      for (const { keyword, text } of add) {
        const bytes = new Uint8Array(keyword.length + 1 + text.length);
        for (let i = 0; i < keyword.length; i++) bytes[i] = keyword.charCodeAt(i) & 0xff;
        for (let i = 0; i < text.length; i++) bytes[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;
        parts.push(buildChunk('tEXt', bytes));
      }
    }
    if (TEXT_TYPES.has(chunk.type)) {
      const sep = chunk.data.indexOf(0);
      const keyword = sep >= 0 ? latin1(chunk.data.subarray(0, sep)) : '';
      if (!keep(chunk, keyword)) continue;
    }
    parts.push(png.subarray(chunk.start, chunk.end));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ─── Base64 of UTF-8, as card chunks store their JSON ──────────────────────────

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToUtf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Width and height from the IHDR chunk, or null if this isn't a PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (!isPng(png) || png.length < 24) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
