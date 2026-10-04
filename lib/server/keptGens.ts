import 'server-only';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { galleryPath, getProject, updateProject, writeFileAtomic } from '@/lib/server/storage';
import { contentHash, libraryItemFile, libraryIdsWithContent } from '@/lib/server/library';
import type { CardProject, KeptImage } from '@/types/project';

// Gens kept with a card can come from the generator or from the gen
// library. Each remembers a hash of the file it came from, so the same
// picture isn't kept twice, and the library can show which of its images
// are already in the card's gallery.

/** The card, with a hash for every kept gen (older ones get theirs from
 *  the file in the gallery, once). */
export async function withKeptHashes(id: string): Promise<CardProject> {
  const p = await getProject(id);
  if (p.kept.every((k) => k.hash)) return p;
  const found = new Map<string, { hash: string; size: number }>();
  for (const k of p.kept) {
    if (k.hash) continue;
    const bytes = await fs.readFile(galleryPath(id, k.file)).catch(() => null);
    if (bytes) found.set(k.file, { hash: contentHash(bytes), size: bytes.length });
  }
  if (!found.size) return p;
  return updateProject(id, (cur) => ({ ...cur, kept: cur.kept.map((k) => (k.hash || !found.has(k.file) ? k : { ...k, ...found.get(k.file) })) }));
}

/**
 * Keeps a PNG with the card, unless the same picture already is: then the
 * kept copy is returned and nothing is written.
 */
export async function keepPng(id: string, file: string, bytes: Uint8Array, meta: KeptImage): Promise<{ kept: KeptImage; added: boolean }> {
  await withKeptHashes(id);
  const hash = meta.hash ?? contentHash(bytes);
  const size = meta.size ?? bytes.length;
  const existing = (await getProject(id)).kept.find((k) => k.hash === hash && k.file !== file);
  if (existing) return { kept: existing, added: false };
  await writeFileAtomic(galleryPath(id, file), Buffer.from(bytes));
  const entry: KeptImage = { ...meta, file, hash, size };
  // Another request may have kept the same picture meanwhile. Kept again
  // under its own file name, it's the same entry with new details.
  const found: { dup?: KeptImage; again?: boolean } = {};
  await updateProject(id, (p) => {
    found.dup = p.kept.find((k) => k.hash === hash && k.file !== file);
    found.again = p.kept.some((k) => k.hash === hash && k.file === file);
    return found.dup ? p : { ...p, kept: p.kept.some((k) => k.file === file) ? p.kept.map((k) => (k.file === file ? entry : k)) : [...p.kept, entry] };
  });
  if (!found.dup) return { kept: entry, added: !found.again };
  await fs.rm(galleryPath(id, file), { force: true });
  return { kept: found.dup, added: false };
}

/** Library images kept with the card: their library ids. */
export async function libraryIdsInGallery(id: string): Promise<string[]> {
  const p = await withKeptHashes(id);
  return libraryIdsWithContent(p.kept.filter((k): k is KeptImage & { hash: string; size: number } => !!k.hash && !!k.size));
}

/** Keeps library images with the card, skipping any it already has. */
export async function keepFromLibrary(id: string, libraryIds: string[]): Promise<{ added: KeptImage[]; already: number }> {
  const added: KeptImage[] = [];
  let already = 0;
  for (const libId of [...new Set(libraryIds)]) {
    const { item, bytes } = await libraryItemFile(libId);
    const hash = contentHash(bytes);
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    // The gallery holds PNGs; a JPEG or WebP is converted (its hash stays
    // the original file's, so the library still recognises it).
    const png = isPng ? bytes : new Uint8Array(await sharp(bytes).png().toBuffer());
    const keptId = `lib-${hash.slice(0, 16)}`;
    const { kept, added: isNew } = await keepPng(id, `${keptId}.png`, png, {
      id: keptId,
      file: `${keptId}.png`,
      width: item.width,
      height: item.height,
      createdAt: Math.round(item.mtime),
      prompt: item.info.prompt,
      negativePrompt: item.info.negative,
      seed: item.info.seed,
      hash,
      size: bytes.length,
    });
    if (isNew) added.push(kept);
    else already++;
  }
  return { added, already };
}
