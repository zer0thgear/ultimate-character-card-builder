'use client';

import { useProjectStore } from '@/store/projectStore';
import { useSessionStore, type SessionImage } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useConfigStore, useUiStore, toast } from '@/store/uiStore';
import { api } from '@/lib/api';
import { readNaiMetadata } from '@/lib/naiMetadata';
import { reuseFromMetadata } from '@/lib/genRequest';
import { cardFileName } from '@/lib/cardFile';
import { openSettings } from '@/components/SettingsDialog';

// What you can do with any image in UCCB (a fresh gen, a kept one, one
// from the library): make it the avatar, keep it with the card, save it to
// the output folder, or load its prompt back into the generator.

export async function setAsAvatar(blob: Blob) {
  try {
    await useProjectStore.getState().setAvatar(blob);
    toast('Set as the avatar.', 'success');
  } catch (err) {
    toast(`Couldn't set the avatar: ${(err as Error).message}`, 'error');
  }
}

export async function keepImage(img: SessionImage, label?: string) {
  const p = useProjectStore.getState().project;
  if (!p) return;
  try {
    const id = img.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || crypto.randomUUID();
    const kept = await useProjectStore.getState().keep(img.blob, {
      id,
      width: img.parameters.width,
      height: img.parameters.height,
      createdAt: img.timestamp,
      prompt: img.prompt,
      negativePrompt: img.negativePrompt,
      model: img.model,
      seed: img.seed,
      label,
    });
    useSessionStore.getState().updateImages([img.id], { keptFile: kept.file, pinned: true });
    toast(`Kept with ${p.card.data.name || 'the card'}.`, 'success');
  } catch (err) {
    toast(`Couldn't keep it: ${(err as Error).message}`, 'error');
  }
}

export const genFileName = (img: { timestamp: number; seed: number }) =>
  `${new Date(img.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${img.seed}.png`;

/** Saves to the output folder; asks for one first if none is set. */
export async function saveToFolder(blob: Blob, filename: string, quiet = false): Promise<string | null> {
  // The folder may have been set since the page loaded (another tab).
  if (!useConfigStore.getState().config.outputDir) await useConfigStore.getState().load().catch(() => {});
  const { config } = useConfigStore.getState();
  if (!config.outputDir) {
    toast('Choose an output folder first.', 'info', { label: 'Settings', run: () => openSettings('folders') });
    return null;
  }
  const p = useProjectStore.getState().project;
  try {
    const { path } = await api.saveGen(blob, filename, p ? cardFileName(p.card, 'Unnamed') : '');
    if (!quiet) toast(`Saved to ${path}`, 'success');
    return path;
  } catch (err) {
    toast(`Couldn't save: ${(err as Error).message}`, 'error');
    return null;
  }
}

export async function saveSessionImage(img: SessionImage, quiet = false) {
  const path = await saveToFolder(img.blob, genFileName(img), quiet);
  if (path) useSessionStore.getState().updateImages([img.id], { savedPath: path });
}

/** Loads an image's prompt (and optionally its settings) into the image
 *  generator, from its embedded NovelAI metadata. */
export async function reusePrompt(blob: Blob, opts: { settings?: boolean; seed?: boolean } = {}) {
  const { parsed } = await readNaiMetadata(blob);
  if (!parsed) return toast("This image has no NovelAI metadata to reuse.", 'error');
  const form = useSettingsStore.getState();
  useSettingsStore.getState().patch(
    reuseFromMetadata(parsed, form, { prompt: true, characters: true, negative: true, settings: !!opts.settings, seed: !!opts.seed }),
  );
  useUiStore.getState().setDockTab('image');
  toast(opts.settings ? 'Prompt and settings loaded.' : 'Prompt loaded into the generator.', 'success');
}
