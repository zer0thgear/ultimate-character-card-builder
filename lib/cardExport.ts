'use client';

import type { CardProject } from '@/types/project';
import { api } from '@/lib/api';
import { cardCharx, cardFileName, cardJson, cardPng, importCardFile } from '@/lib/cardFile';
import { downloadBlob } from '@/components/ui';

// Export and import from the browser: the avatar comes from the project
// folder, and a card with no avatar gets a plain placeholder picture so it
// can still be a PNG card.

async function avatarBytes(p: CardProject): Promise<Uint8Array | null> {
  const url = api.avatarUrl(p.id, p.avatar);
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

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

export async function exportPng(p: CardProject, { keepMetadata = false } = {}) {
  const avatar = (await avatarBytes(p)) ?? (await placeholderPng(p.card.data.name));
  downloadBlob(cardPng(p.card, avatar, { keepMetadata }), `${cardFileName(p.card)}.png`, 'image/png');
}

export function exportJson(p: CardProject) {
  downloadBlob(cardJson(p.card), `${cardFileName(p.card)}.json`, 'application/json');
}

export async function exportCharx(p: CardProject) {
  const avatar = await avatarBytes(p);
  downloadBlob(await cardCharx(p.card, avatar ? { bytes: avatar, ext: 'png' } : undefined), `${cardFileName(p.card)}.charx`, 'application/zip');
}

/** Reads a card file into a new project, avatar included. */
export async function importAsProject(file: File, create: (init: Partial<CardProject>) => Promise<CardProject>, setAvatar: (b: Blob) => Promise<void>) {
  const imported = await importCardFile(file.name, new Uint8Array(await file.arrayBuffer()));
  await create({ card: imported.card });
  if (imported.avatar) await setAvatar(new Blob([imported.avatar.bytes as BlobPart], { type: imported.avatar.type }));
  return imported;
}
