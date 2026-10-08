'use client';

import { useProjectStore } from '@/store/projectStore';
import { toast } from '@/store/uiStore';
import { api } from '@/lib/api';
import { importCardFile } from '@/lib/cardFile';
import { offerCardLore } from '@/components/LorebookBank';
import { offerCardTags } from '@/components/AppTags';
import { fromBase64 } from '@/lib/requestImage';
import { choiceDialog, confirmDialog, pickFiles, textDialog } from '@/components/ui';
import type { CardProject } from '@/types/project';
import type { CharacterCard } from '@/types/card';

// Import from URL, as SillyTavern has it: paste a Chub (or Cardbox) link and
// the card comes in with its picture. UCCB's server fetches it (a browser
// can't reach Chub's API itself), from the sites it knows only. Overwrite
// takes a card the same way (or from a file) in place of the open one.

interface Fetched {
  card: CharacterCard;
  avatar?: Blob;
  /** What it came from, for messages: a site, or a file's name. */
  from: string;
}

/** Asks for a link and fetches the card there: read like any imported card
 *  file (so it's normalised the same way), with the link it came from in its
 *  source (V3). Null if cancelled or it failed (said so). */
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
    const found = await api.importUrl(link.trim());
    const { card } = await importCardFile('import.json', new TextEncoder().encode(JSON.stringify(found.card)));
    if (found.sourceUrl && !(card.data.source ?? []).includes(found.sourceUrl)) card.data.source = [...(card.data.source ?? []), found.sourceUrl];
    return { card, avatar: found.avatar ? new Blob([fromBase64(found.avatar) as BlobPart], { type: found.avatarType ?? 'image/png' }) : undefined, from: found.source };
  } catch (err) {
    toast((err as Error).message, 'error');
    return null;
  }
}

/** Asks for a link and imports the card from it as a new card (`init`
 *  marks it chat-only in Chat mode). */
export async function importFromUrl(init: Partial<CardProject> = {}) {
  const got = await fetchFromUrl('Import from a URL', 'Import');
  if (!got) return;
  try {
    const { create, setAvatar } = useProjectStore.getState();
    const project = await create({ ...init, card: got.card });
    if (got.avatar) await setAvatar(got.avatar);
    toast(`Imported ${got.card.data.name || 'the card'} from ${got.from}${got.avatar ? '' : ' (no picture)'}.`, 'success');
    await offerCardTags([{ projectId: project.id, card: got.card.data }]);
    await offerCardLore([{ projectId: project.id, card: got.card.data }]);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
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
