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
/** The folder list the last scan covered: a change forces a new scan. */
let lastScanFolders = '';

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

/** The start of a file: enough for a PNG's text chunks, which NovelAI
 *  writes before the image data. */
async function readHead(abs: string, bytes = 64 * 1024): Promise<Uint8Array> {
  const fh = await fs.open(abs, 'r');
  try {
    const buf = new Uint8Array(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function readInfo(abs: string, fileSize: number): Promise<{ width: number; height: number; info: GenInfo }> {
  const head = await readHead(abs);
  const size = pngSize(head);
  let info: GenInfo = size ? genInfoFromPng(head) : {};
  // A text chunk past the head (rare: huge metadata, or written after the
  // image data) needs the whole file.
  if (size && !info.source && fileSize > head.length) info = genInfoFromPng(new Uint8Array(await fs.readFile(abs)));
  let { width = 0, height = 0 } = size ?? {};
  if (!size) {
    const meta = await sharp(abs).metadata().catch(() => null);
    width = meta?.width ?? 0;
    height = meta?.height ?? 0;
  }
  // No readable chunks (copied, or pasted through a browser): try the copy
  // NovelAI hides in the alpha channel. Only PNG/WebP keep alpha exactly.
  if (!info.source && width * height > 0 && width * height <= MAX_STEALTH_PIXELS && !/\.jpe?g$/i.test(abs)) {
    try {
      const { data, info: raw } = await sharp(abs).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const stealth = await readStealth({ width: raw.width, height: raw.height, data }, async (b) => gunzipSync(b));
      if (stealth) info = genInfoFromStealth(stealth);
    } catch {
      /* unreadable image: no metadata */
    }
  }
  delete info.raw; // kept out of the index; read on demand
  return { width, height, info };
}

export interface ScanProgress {
  scanning: boolean;
  /** Files read so far, of those that were new or changed. */
  done: number;
  total: number;
}

const progress: ScanProgress = { scanning: false, done: 0, total: 0 };
export const scanProgress = (): ScanProgress => ({ ...progress, scanning: !!scanning });

async function runScan() {
  const cfg = await getConfig();
  const folders = JSON.stringify(cfg.libraryFolders);
  const idx = await loadIndex();
  const seen = new Set<string>();
  const todo: { abs: string; size: number; mtime: number }[] = [];
  progress.done = 0;
  progress.total = 0;
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
  progress.total = todo.length;

  // A few at a time: sharp is threaded already, and this keeps memory flat.
  // Results land in the in-memory index as they come, so searches during a
  // long first scan already see what's been read; it's saved every so often.
  const CONCURRENCY = 6;
  let next = 0;
  let sinceSave = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < todo.length) {
        const { abs, size, mtime } = todo[next++];
        try {
          const { width, height, info } = await readInfo(abs, size);
          idx.items[abs] = { id: idFor(abs), name: path.basename(abs), size, mtime, width, height, info };
        } catch (err) {
          console.warn('Library: could not read', abs, err);
        }
        progress.done++;
        if (++sinceSave >= 1000) {
          sinceSave = 0;
          await writeFileAtomic(INDEX_FILE, JSON.stringify(idx));
        }
      }
    }),
  );
  await writeFileAtomic(INDEX_FILE, JSON.stringify(idx));
  lastScan = Date.now();
  lastScanFolders = folders;
}

/**
 * Starts bringing the index up to date, if it isn't already. Within
 * `maxAgeMs` of the last scan of the same folders, nothing is rescanned.
 * Returns the running scan (callers may await it, or not).
 */
export async function scanLibrary(maxAgeMs = 0): Promise<void> {
  if (scanning) return scanning;
  const folders = JSON.stringify((await getConfig()).libraryFolders);
  if (maxAgeMs && folders === lastScanFolders && Date.now() - lastScan < maxAgeMs) return;
  scanning = runScan()
    .catch((err) => console.error('Library scan failed', err))
    .finally(() => {
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
