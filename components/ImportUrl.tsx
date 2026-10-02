'use client';

import { useProjectStore } from '@/store/projectStore';
import { toast } from '@/store/uiStore';
import { api } from '@/lib/api';
import { importCardFile } from '@/lib/cardFile';
import { fromBase64 } from '@/lib/requestImage';
import { textDialog } from '@/components/ui';
import type { CardProject } from '@/types/project';

// Import from URL, as SillyTavern has it: paste a Chub (or Cardbox) link and
// the card comes in with its picture. UCCB's server fetches it (a browser
// can't reach Chub's API itself), from the sites it knows only.

/** Asks for a link and imports the card from it as a new card (`init`
 *  marks it chat-only in Chat mode). */
export async function importFromUrl(init: Partial<CardProject> = {}) {
  const link = await textDialog({
    title: 'Import from a URL',
    label: 'A Chub or Cardbox character link, e.g. https://chub.ai/characters/creator/name',
    placeholder: 'https://chub.ai/characters/…',
    confirmLabel: 'Import',
  });
  if (!link?.trim()) return;
  toast('Fetching the card…', 'info');
  try {
    const found = await api.importUrl(link.trim());
    // Read like any imported card file, so it's normalised the same way.
    const { card } = await importCardFile('import.json', new TextEncoder().encode(JSON.stringify(found.card)));
    // Where it came from goes in its source (V3), unless it's there already.
    if (found.sourceUrl && !(card.data.source ?? []).includes(found.sourceUrl)) card.data.source = [...(card.data.source ?? []), found.sourceUrl];
    const { create, setAvatar } = useProjectStore.getState();
    await create({ ...init, card });
    if (found.avatar) await setAvatar(new Blob([fromBase64(found.avatar) as BlobPart], { type: found.avatarType ?? 'image/png' }));
    toast(`Imported ${card.data.name || 'the card'} from ${found.source}${found.avatar ? '' : ' (no picture)'}.`, 'success');
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}
