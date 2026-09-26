import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { DATA_DIR, getConfig, writeFileAtomic, BadRequestError } from '@/lib/server/storage';
import { genInfoFromPng, genInfoFromStealth, readStealth, type GenInfo } from '@/lib/genMetadata';
import { pngSize } from '@/lib/png';
import type { LibraryItem } from '@/lib/librarySearch';

// The gen library: every image under the configured folders, with its
// generation metadata, cached in data/library-index.json so only new or
// changed files are read again. Thumbnails are cached in data/thumbs/.

const INDEX_FILE = path.join(DATA_DIR, 'library-index.json');
const THUMBS = path.join(DATA_DIR, 'thumbs');
const IMAGE_EXTS = new Set(['.png', '.webp', '.jpg', '.jpeg']);
/** GenBrowser's own trash, and folders nobody wants browsed. */
const SKIP_DIRS = new Set(['_Trash', 'node_modules', '.git', '_imported_zips']);
const THUMB_SIZE = 384;
/** Stealth metadata is read from the pixels; past this size it isn't tried. */
const MAX_STEALTH_PIXELS = 0x1000000;

interface IndexFile {
  version: 1;
  /** Absolute path → item (root index is filled in at read time). */
  items: Record<string, Omit<LibraryItem, 'root' | 'rel' | 'folder'>>;
}

let index: IndexFile | null = null;
let scanning: Promise<void> | null = null;
let lastScan = 0;

const idFor = (abs: string) => createHash('sha1').update(abs.toLowerCase()).digest('hex').slice(0, 16);
const toSlash = (p: string) => p.split(path.sep).join('/');

async function loadIndex(): Promise<IndexFile> {
  if (index) return index;
  try {
    const parsed = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8')) as IndexFile;
    index = parsed.version === 1 ? parsed : { version: 1, items: {} };
  } catch {
    index = { version: 1, items: {} };
  }
  return index;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) yield* walk(full);
    } else if (e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) {
      yield full;
    }
  }
}

async function readInfo(abs: string): Promise<{ width: number; height: number; info: GenInfo }> {
  const bytes = new Uint8Array(await fs.readFile(abs));
  const size = pngSize(bytes);
  let info: GenInfo = size ? genInfoFromPng(bytes) : {};
  let { width = 0, height = 0 } = size ?? {};
  if (!size) {
    const meta = await sharp(bytes).metadata().catch(() => null);
    width = meta?.width ?? 0;
    height = meta?.height ?? 0;
  }
  // No readable chunks (copied, or pasted through a browser): try the copy
  // NovelAI hides in the alpha channel. Only PNG/WebP keep alpha exactly.
  if (!info.source && width * height > 0 && width * height <= MAX_STEALTH_PIXELS && !/\.jpe?g$/i.test(abs)) {
    try {
      const { data, info: raw } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const stealth = await readStealth({ width: raw.width, height: raw.height, data }, async (b) => gunzipSync(b));
      if (stealth) info = genInfoFromStealth(stealth);
    } catch {
      /* unreadable image: no metadata */
    }
  }
  delete info.raw; // kept out of the index; read on demand
  return { width, height, info };
}

async function runScan() {
  const cfg = await getConfig();
  const idx = await loadIndex();
  const seen = new Set<string>();
  const todo: { abs: string; size: number; mtime: number }[] = [];
  for (const root of cfg.libraryFolders) {
    for await (const abs of walk(path.resolve(root))) {
      seen.add(abs);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) continue;
      const old = idx.items[abs];
      if (old && old.size === stat.size && old.mtime === stat.mtimeMs) continue;
      todo.push({ abs, size: stat.size, mtime: stat.mtimeMs });
    }
  }
  for (const abs of Object.keys(idx.items)) if (!seen.has(abs)) delete idx.items[abs];

  // A few at a time: sharp is threaded already, and this keeps memory flat.
  const CONCURRENCY = 4;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < todo.length) {
        const { abs, size, mtime } = todo[next++];
        try {
          const { width, height, info } = await readInfo(abs);
          idx.items[abs] = { id: idFor(abs), name: path.basename(abs), size, mtime, width, height, info };
        } catch (err) {
          console.warn('Library: could not read', abs, err);
        }
      }
    }),
  );
  await writeFileAtomic(INDEX_FILE, JSON.stringify(idx));
  lastScan = Date.now();
}

/** Brings the index up to date. Concurrent callers share one scan; within
 *  `maxAgeMs` of the last one, nothing is rescanned. */
export async function scanLibrary(maxAgeMs = 0) {
  if (scanning) return scanning;
  if (maxAgeMs && Date.now() - lastScan < maxAgeMs) return;
  scanning = runScan().finally(() => {
    scanning = null;
  });
  return scanning;
}

export async function libraryItems(): Promise<LibraryItem[]> {
  const cfg = await getConfig();
  const idx = await loadIndex();
  const roots = cfg.libraryFolders.map((r) => path.resolve(r));
  const items: LibraryItem[] = [];
  for (const [abs, item] of Object.entries(idx.items)) {
    const root = roots.findIndex((r) => abs.toLowerCase().startsWith(r.toLowerCase() + path.sep));
    if (root < 0) continue;
    const rel = toSlash(path.relative(roots[root], abs));
    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    items.push({ ...item, root, rel, folder });
  }
  return items;
}

/** An item's absolute path, checked to be inside a library folder, so the
 *  file routes can't be asked for anything else on disk. */
export async function resolveItem(id: string): Promise<string> {
  const idx = await loadIndex();
  const cfg = await getConfig();
  const roots = cfg.libraryFolders.map((r) => path.resolve(r).toLowerCase() + path.sep);
  for (const [abs, item] of Object.entries(idx.items)) {
    if (item.id === id && roots.some((r) => abs.toLowerCase().startsWith(r))) return abs;
  }
  throw new BadRequestError(`No library image ${id}`);
}

export async function thumbnail(id: string): Promise<Buffer> {
  const abs = await resolveItem(id);
  const stat = await fs.stat(abs);
  const file = path.join(THUMBS, `${id}-${Math.round(stat.mtimeMs)}.webp`);
  try {
    return await fs.readFile(file);
  } catch {
    const buf = await sharp(abs).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' }).webp({ quality: 80 }).toBuffer();
    await fs.mkdir(THUMBS, { recursive: true });
    await fs.writeFile(file, buf);
    return buf;
  }
}
