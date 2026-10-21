'use client';

import { useProjectStore } from '@/store/projectStore';
import { toast } from '@/store/uiStore';
import { api } from '@/lib/api';
import { importCardFile } from '@/lib/cardFile';
import { offerCardLore } from '@/components/LorebookBank';
import { offerCardTags } from '@/components/AppTags';
import { offerChubLore } from '@/components/ChubLore';
import { fromBase64 } from '@/lib/requestImage';
import { choiceDialog, confirmDialog, pickFiles, textDialog } from '@/components/ui';
import type { CardProject } from '@/types/project';
import type { CardData, CharacterCard } from '@/types/card';
import { changedFields, sourceLinks, splitLinks } from '@/lib/importLinks';
import { missingChubLore } from '@/lib/chubLore';
import { useLorebookStore } from '@/store/lorebookStore';

// Import from URL, as SillyTavern has it: paste Chub (or Cardbox) links, one
// per line, and the cards come in with their pictures. UCCB's server fetches
// them (a browser can't reach Chub's API itself), from the sites it knows
// only. Overwrite takes a card the same way (or from a file) in place of the
// open one.

interface Fetched {
  card: CharacterCard;
  avatar?: Blob;
  /** What it came from, for messages: a site, or a file's name. */
  from: string;
}

/** Fetches the card at a link: read like any imported card file (so it's
 *  normalised the same way), with the link it came from in its source (V3). */
async function fetchCard(link: string): Promise<Fetched> {
  const found = await api.importUrl(link);
  const { card } = await importCardFile('import.json', new TextEncoder().encode(JSON.stringify(found.card)));
  if (found.sourceUrl && !(card.data.source ?? []).includes(found.sourceUrl)) card.data.source = [...(card.data.source ?? []), found.sourceUrl];
  return { card, avatar: found.avatar ? new Blob([fromBase64(found.avatar) as BlobPart], { type: found.avatarType ?? 'image/png' }) : undefined, from: found.source };
}

/** Asks for a link and fetches the card there. Null if cancelled or it
 *  failed (said so). */
async function fetchFromUrl(title: string, confirmLabel: string): Promise<Fetched | null> {
  const link = await textDialog({
    title,
    label: 'A Chub or Cardbox character link, e.g. https://chub.ai/characters/creator/name',
    placeholder: 'https://chub.ai/characters/…',
    confirmLabel,
  });
  if (!link?.trim()) return null;
  toast('Fetching the card…', 'info');
  try {
    return await fetchCard(link.trim());
  } catch (err) {
    toast((err as Error).message, 'error');
    return null;
  }
}

/** Asks for links, one per line as SillyTavern takes them, and imports
 *  each card as a new one, in turn (`init` marks them chat-only in Chat
 *  mode); the last one stays open. */
export async function importFromUrl(init: Partial<CardProject> = {}) {
  const text = await textDialog({
    title: 'Import from a URL',
    label: 'Chub or Cardbox character links, one per line, e.g. https://chub.ai/characters/creator/name (Ctrl+Enter imports)',
    placeholder: 'https://chub.ai/characters/…',
    confirmLabel: 'Import',
    multiline: true,
  });
  const links = splitLinks(text ?? '');
  if (!links.length) return;
  const { create, setAvatar } = useProjectStore.getState();
  const names: string[] = [];
  const failed: string[] = [];
  const lore: { projectId: string; card: CardData }[] = [];
  for (const [i, link] of links.entries()) {
    toast(links.length === 1 ? 'Fetching the card…' : `Fetching card ${i + 1} of ${links.length}…`, 'info');
    try {
      const got = await fetchCard(link);
      const project = await create({ ...init, card: got.card });
      if (got.avatar) await setAvatar(got.avatar);
      lore.push({ projectId: project.id, card: got.card.data });
      names.push(`${got.card.data.name || 'the card'}${links.length === 1 ? ` from ${got.from}` : ''}${got.avatar ? '' : ' (no picture)'}`);
    } catch (err) {
      failed.push(links.length === 1 ? (err as Error).message : `${link}: ${(err as Error).message}`);
    }
  }
  if (names.length) toast(names.length === 1 ? `Imported ${names[0]}.` : `Imported ${names.length} cards: ${names.join(', ')}.`, 'success');
  if (failed.length) toast(failed.length === 1 ? failed[0] : `Couldn't import ${failed.length} links: ${failed.join('; ')}`, 'error');
  await offerCardTags(lore);
  await offerCardLore(lore);
  await offerChubLore(lore, false);
}

/** Replaces the open card's text with another card's, from a file or a link
 *  (whose source is recorded, as on import); its picture too, if you say so.
 *  Gens and chats stay. */
export async function overwriteCard() {
  const project = useProjectStore.getState().project;
  if (!project) return;
  const how = await choiceDialog({
    title: 'Overwrite this card from…',
    body: "Its text is replaced with another card's; its gens and chats stay, and undo brings the old text back.",
    choices: [
      { value: 'file', label: '📁 A file…' },
      { value: 'url', label: '🔗 A URL…' },
    ],
  });
  if (!how) return;
  let got: Fetched | null = null;
  if (how === 'file') {
    const [file] = await pickFiles('.json,.png,.charx');
    if (!file) return;
    try {
      const imported = await importCardFile(file.name, new Uint8Array(await file.arrayBuffer()));
      got = { card: imported.card, avatar: imported.avatar ? new Blob([imported.avatar.bytes as BlobPart], { type: imported.avatar.type }) : undefined, from: file.name };
    } catch (err) {
      return toast((err as Error).message, 'error');
    }
  } else got = await fetchFromUrl('Overwrite from a URL', 'Fetch');
  if (!got) return;

  const name = project.card.data.name || 'this card';
  const title = `Overwrite "${name}" with ${got.card.data.name || 'that card'} (${got.from})?`;
  let picture = false;
  if (got.avatar) {
    // The new card has a picture: keep this one's, or take that one.
    const which = await choiceDialog({
      title,
      body: "The text is replaced (undo brings it back); gens and chats stay. The picture can stay as it is, or be replaced with the new card's (undo doesn't bring a picture back).",
      choices: [
        { value: 'text', label: 'Text only' },
        { value: 'both', label: 'Text and picture' },
      ],
    });
    if (!which) return;
    picture = which === 'both';
  } else if (!(await confirmDialog({ title, body: 'The text is replaced; the picture, gens and chats stay. Undo brings the old text back.', confirmLabel: 'Overwrite' }))) return;

  const store = useProjectStore.getState();
  if (store.project?.id !== project.id) return;
  store.replaceCard(got.card);
  try {
    if (picture && got.avatar) await store.setAvatar(got.avatar);
    toast(picture ? 'Card text and picture replaced.' : 'Card text replaced.', 'success');
  } catch (err) {
    toast(`Text replaced, but the picture couldn't be: ${(err as Error).message}`, 'error');
  }
}

/** Whether two pictures are the same file. */
async function samePicture(current: string | null, next: Blob): Promise<boolean> {
  if (!current) return false;
  try {
    const res = await fetch(current);
    if (!res.ok) return false;
    const [a, b] = await Promise.all([res.arrayBuffer(), next.arrayBuffer()]);
    if (a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * ⟳ Update: fetches the open card again from its source (lib/importLinks.ts,
 * sourceLinks) and puts it in place of the card's text, as Overwrite does:
 * undo (or the version kept) brings the old text back, and gens, chats,
 * notes, tags and linked lorebooks stay. A new picture there is offered,
 * not taken; lorebooks it newly links on Chub are fetched and linked.
 */
export async function updateFromSource() {
  const project = useProjectStore.getState().project;
  if (!project) return;
  const links = sourceLinks(project.card.data);
  if (!links.length) return toast("This card doesn't say where it came from, so it can't be fetched again.", 'error');
  toast('Fetching the card again…', 'info');
  let got: Fetched | null = null;
  const errors: string[] = [];
  for (const link of links) {
    try {
      got = await fetchCard(link);
      break;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  if (!got) return toast(`Couldn't fetch it: ${errors[0]}`, 'error');
  const store = useProjectStore.getState();
  // Another card was opened meanwhile.
  if (store.project?.id !== project.id) return;
  const before = store.project.card;
  // Where it came from stays, with the link it was just fetched from.
  got.card.data.source = [...new Set([...(before.data.source ?? []), ...(got.card.data.source ?? [])])];
  const changed = changedFields(before.data, got.card.data);
  const name = before.data.name || 'The card';
  if (changed.length) {
    store.replaceCard(got.card);
    toast(`Updated ${name} from ${got.from}: ${changed.length > 4 ? `${changed.slice(0, 4).join(', ')} and ${changed.length - 4} more` : changed.join(', ')} changed.`, 'success', {
      label: 'Undo',
      run: () => {
        if (useProjectStore.getState().project?.id === project.id) useProjectStore.getState().undo();
      },
    });
  }
  const picture = got.avatar && !(await samePicture(api.avatarUrl(project.id, project.avatar), got.avatar)) ? got.avatar : null;
  if (!changed.length && !picture) toast(`${name} is up to date with ${got.from}.`, 'success');
  if (picture)
    toast(`${changed.length ? 'Its' : `${name}'s text is up to date, but its`} picture on ${got.from} is different.`, 'info', {
      label: 'Use the new picture',
      run: () => {
        const s = useProjectStore.getState();
        if (s.project?.id === project.id) void s.setAvatar(picture).then(() => toast('Picture replaced.', 'success'), (err: Error) => toast(err.message, 'error'));
      },
    });
  // Lorebooks it links on Chub now that aren't linked here.
  if (missingChubLore(got.card.data, store.project.lorebookIds, useLorebookStore.getState().books).length) await offerChubLore([{ projectId: project.id, card: got.card.data }], false);
}
