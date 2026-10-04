'use client';

import { useProjectStore } from '@/store/projectStore';
import { imageBlob, useSessionStore, type SessionImage } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useConfigStore, useUiStore, toast } from '@/store/uiStore';
import { api } from '@/lib/api';
import { readNaiMetadata } from '@/lib/naiMetadata';
import { reuseFromMetadata } from '@/lib/genRequest';
import { cardFileName } from '@/lib/cardFile';
import { openSettings } from '@/components/SettingsDialog';
import { uuid } from '@/lib/uuid';

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

/** Keeps a gen with the open card; true if it worked. `quiet` skips the
 *  success toast (for a batch, which reports once). */
export async function keepImage(img: SessionImage, label?: string, quiet = false): Promise<boolean> {
  const p = useProjectStore.getState().project;
  if (!p) return false;
  try {
    const id = img.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || uuid();
    const kept = await useProjectStore.getState().keep(await imageBlob(img), {
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
    if (!quiet) toast(kept.id === id ? `Kept with ${p.card.data.name || 'the card'}.` : 'Already kept with this card.', 'success');
    return true;
  } catch (err) {
    toast(`Couldn't keep it: ${(err as Error).message}`, 'error');
    return false;
  }
}

/** Keeps gen-library images with the open card (they show in its
 *  gallery); pictures it already has are skipped. */
export async function keepLibraryImages(ids: string[]): Promise<boolean> {
  const p = useProjectStore.getState().project;
  if (!p || !ids.length) return false;
  try {
    const { added, already } = await useProjectStore.getState().keepFromLibrary(ids);
    const name = p.card.data.name || 'the card';
    const n = (k: number) => `${k} image${k === 1 ? '' : 's'}`;
    if (!added.length) toast(already === 1 ? `Already in ${name}'s gallery.` : `All ${already} are already in ${name}'s gallery.`, 'info');
    else toast(`Added ${n(added.length)} to ${name}'s gallery${already ? ` (${already} already there)` : ''}.`, 'success');
    return true;
  } catch (err) {
    toast(`Couldn't add to the gallery: ${(err as Error).message}`, 'error');
    return false;
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

export async function saveSessionImage(img: SessionImage, quiet = false): Promise<string | null> {
  let blob: Blob;
  try {
    blob = await imageBlob(img);
  } catch (err) {
    toast((err as Error).message, 'error');
    return null;
  }
  const path = await saveToFolder(blob, genFileName(img), quiet);
  if (path) useSessionStore.getState().updateImages([img.id], { savedPath: path });
  return path;
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

/** Starts a new card from an image: it becomes the avatar, and its
 *  NovelAI prompt (if it has one) goes into the card's art prompts. */
export async function newCardFromImage(blob: Blob) {
  try {
    await useProjectStore.getState().create();
    await useProjectStore.getState().setAvatar(blob);
    const { parsed } = await readNaiMetadata(blob);
    if (parsed) {
      const form = useSettingsStore.getState();
      // The negative is shared by every card: starting one doesn't change it.
      useSettingsStore.getState().patch(reuseFromMetadata(parsed, form, { prompt: true, characters: true, negative: false, settings: false, seed: false }));
    }
    useUiStore.getState().setEditorTab('basics');
    useUiStore.getState().setPhoneView('card');
    toast(parsed ? 'New card started from the image, with its prompt in the art settings.' : 'New card started with the image as its avatar.', 'success');
  } catch (err) {
    toast(`Couldn't start a card from it: ${(err as Error).message}`, 'error');
  }
}

/** Runs `fn` on a gen's PNG, fetching it from the server if it isn't in
 *  memory; says so if it's gone. */
export function withImage(img: SessionImage, fn: (blob: Blob) => unknown) {
  imageBlob(img).then(fn, (err: Error) => toast(err.message, 'error'));
}
