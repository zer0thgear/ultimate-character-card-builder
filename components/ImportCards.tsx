'use client';

import { useProjectStore } from '@/store/projectStore';
import { toast } from '@/store/uiStore';
import { importAsProject } from '@/lib/cardExport';
import { CardImportError } from '@/lib/cardFile';
import { pickFiles } from '@/components/ui';
import type { CardProject } from '@/types/project';

// Importing card files from disk: any number at once (picked, or dropped),
// each a new card; the last one stays open. `init` marks them chat-only in
// Chat mode.

/** Imports these files (or asks for some), and says how it went. */
export async function importCards(init: Partial<CardProject> = {}, given?: File[]): Promise<number> {
  const files = given ?? (await pickFiles('.png,.json,.charx', true));
  if (!files.length) return 0;
  const { create, setAvatar } = useProjectStore.getState();
  const names: string[] = [];
  const failed: string[] = [];
  for (const file of files) {
    try {
      const imported = await importAsProject(file, create, setAvatar, init);
      names.push(`${imported.card.data.name || file.name}${imported.source === 'chara' ? ' (V2 card)' : ''}`);
    } catch (err) {
      failed.push(`${file.name}: ${err instanceof CardImportError ? err.message : (err as Error).message}`);
    }
  }
  const where = !init.chatOnly ? '' : names.length === 1 ? ` It's in Chat mode only; "Add to Builder" puts it in Builder too.` : ` They're in Chat mode only; "Add to Builder" on a card puts it in Builder too.`;
  if (names.length) toast(names.length === 1 ? `Imported ${names[0]}.${where}` : `Imported ${names.length} cards: ${names.join(', ')}.${where}`, 'success');
  if (failed.length) toast(`Couldn't import ${failed.length === 1 ? failed[0] : `${failed.length} files: ${failed.join('; ')}`}`, 'error');
  return names.length;
}
