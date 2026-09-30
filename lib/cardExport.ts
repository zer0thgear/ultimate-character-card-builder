'use client';

import type { CardProject } from '@/types/project';
import { api } from '@/lib/api';
import { cardCharx, cardFileName, cardJson, cardPng, importCardFile } from '@/lib/cardFile';
import { readTextChunks, replaceTextChunks } from '@/lib/png';
import { downloadBlob } from '@/components/ui';

// Export and import from the browser: the avatar comes from the project
// folder, and a card with no avatar gets a plain placeholder picture so it
// can still be a PNG card.

export interface ExportImageOptions {
  keepMetadata?: boolean;
  /** Longest edge in px; 0 or undefined keeps the size. */
  maxSize?: number;
  compression?: 'off' | 'lossless' | 'palette';
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url);
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

/** The avatar for export, resized and recompressed as asked. Kept
 *  metadata is copied over from the original, since recompressing drops it. */
async function avatarBytes(p: CardProject, opts: ExportImageOptions = {}): Promise<Uint8Array | null> {
  const url = api.avatarUrl(p.id, p.avatar);
  if (!url) return null;
  // Without kept metadata, the copy NovelAI hides in the pixels goes too.
  const scrub = !opts.keepMetadata;
  const processed = scrub || !!opts.maxSize || (opts.compression && opts.compression !== 'off');
  if (!processed) return fetchBytes(url);
  const out = await fetchBytes(`${url}&max=${opts.maxSize || 0}&compress=${opts.compression ?? 'off'}&scrub=${scrub ? 1 : 0}`);
  if (!out || !opts.keepMetadata) return out;
  const original = await fetchBytes(url);
  return original ? replaceTextChunks(out, readTextChunks(original)) : out;
}

const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** A 400×600 placeholder with the character's initial. */
async function placeholderPng(name: string): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 600;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 400, 600);
  g.addColorStop(0, '#4c1d95');
  g.addColorStop(1, '#0f172a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 400, 600);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 180px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((name.trim()[0] ?? '?').toUpperCase(), 200, 300);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Exports the PNG card; resolves with its size, for the message. */
export async function exportPng(p: CardProject, opts: ExportImageOptions = {}): Promise<string> {
  const avatar = (await avatarBytes(p, opts)) ?? (await placeholderPng(p.card.data.name));
  const png = cardPng(p.card, avatar, { keepMetadata: opts.keepMetadata });
  downloadBlob(png, `${cardFileName(p.card)}.png`, 'image/png');
  return sizeLabel(png.length);
}

export function exportJson(p: CardProject) {
  downloadBlob(cardJson(p.card), `${cardFileName(p.card)}.json`, 'application/json');
}

export async function exportCharx(p: CardProject, opts: ExportImageOptions = {}) {
  const avatar = await avatarBytes(p, opts);
  downloadBlob(await cardCharx(p.card, avatar ? { bytes: avatar, ext: 'png' } : undefined), `${cardFileName(p.card)}.charx`, 'application/zip');
}

/** Reads a card file into a new project, avatar included. */
export async function importAsProject(file: File, create: (init: Partial<CardProject>) => Promise<CardProject>, setAvatar: (b: Blob) => Promise<void>, init: Partial<CardProject> = {}) {
  const imported = await importCardFile(file.name, new Uint8Array(await file.arrayBuffer()));
  await create({ ...init, card: imported.card });
  if (imported.avatar) await setAvatar(new Blob([imported.avatar.bytes as BlobPart], { type: imported.avatar.type }));
  return imported;
}
