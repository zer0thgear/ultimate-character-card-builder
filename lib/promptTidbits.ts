import { LibraryTidbit, PromptTidbit } from '@/types/novelai';
import { uuid } from '@/lib/uuid';

// Composing tidbits into prompt text happens in lib/wildcards.ts
// (resolveRequestPrompts), since linked entries may be random wildcards that
// have to be rolled exactly once per request.

/** The library entry a tidbit is linked to, or undefined if it's a plain
 *  inline tidbit — or if its entry has since been deleted, in which case it
 *  degrades to a normal editable tidbit holding its last-known snapshot. */
export function linkedEntry(
  tidbit: PromptTidbit,
  library: LibraryTidbit[],
): LibraryTidbit | undefined {
  return tidbit.sourceId ? library.find((l) => l.id === tidbit.sourceId) : undefined;
}

export function createTidbit(label: string): PromptTidbit {
  return { id: uuid(), label, text: '', enabled: true };
}

/** A prompt-level tidbit linked to a library entry. Label/text are snapshotted
 *  so the tidbit still reads sensibly if the entry is later deleted. */
export function createLinkedTidbit(entry: LibraryTidbit): PromptTidbit {
  return {
    id: uuid(),
    label: entry.label,
    text: snapshotText(entry),
    enabled: true,
    sourceId: entry.id,
  };
}

/** What a tidbit keeps as its own text for a library entry — used as the
 *  deleted-entry fallback and on unlink. A random entry becomes a `__Label__`
 *  reference rather than its raw options: that keeps unlinking behaviorally
 *  identical, and a deleted entry surfaces as a flagged unknown reference
 *  instead of silently sending every option at once. */
export function snapshotText(entry: LibraryTidbit): string {
  return entry.kind === 'random' ? `__${entry.label.trim()}__` : entry.text;
}

/** The tidbit as a plain inline one again, holding what its entry would
 *  give it now (or its snapshot, if the entry is gone). */
export function unlinkTidbit(tidbit: PromptTidbit, library: LibraryTidbit[]): PromptTidbit {
  const entry = linkedEntry(tidbit, library);
  const rest = { ...tidbit };
  delete rest.sourceId;
  return entry ? { ...rest, label: entry.label, text: snapshotText(entry) } : rest;
}

/** Saves an inline tidbit as a new library entry and links the tidbit to
 *  it, so other prompts can use the same text. */
export function tidbitToLibrary(tidbit: PromptTidbit): { entry: LibraryTidbit; tidbit: PromptTidbit } {
  const entry: LibraryTidbit = { id: uuid(), label: tidbit.label.trim() || 'Tidbit', text: tidbit.text, kind: 'fixed' };
  return { entry, tidbit: { ...tidbit, label: entry.label, sourceId: entry.id } };
}

export function createLibraryEntry(label: string, kind: 'fixed' | 'random' = 'fixed'): LibraryTidbit {
  return { id: uuid(), label, text: '', kind };
}

/** A label no other entry has (ignoring case), since `__Label__` finds the
 *  first entry of that name. */
export function uniqueLabel(label: string, library: LibraryTidbit[], except?: string): string {
  const taken = new Set(library.filter((l) => l.id !== except).map((l) => l.label.trim().toLowerCase()));
  const base = label.trim() || 'Tidbit';
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/** How many of these tidbit lists link to `entryId` or name it as a
 *  reference, so deleting it can say what it would affect. */
export function entryUses(entry: LibraryTidbit, texts: string[], lists: (PromptTidbit[] | undefined)[]): number {
  const label = entry.label.trim().toLowerCase();
  const names = (text: string) => !!label && [...text.matchAll(/__([^_\n]+?)__/g)].some((m) => m[1].trim().toLowerCase() === label);
  let n = texts.filter(names).length;
  for (const list of lists) for (const t of list ?? []) if (t.sourceId === entry.id || (!t.sourceId && names(t.text))) n++;
  return n;
}

/** Whether any tidbit here would add something: switched on, and linked or
 *  holding text. A prompt can be all tidbits. */
export const hasActiveTidbits = (tidbits: PromptTidbit[] | undefined) => !!tidbits?.some((t) => t.enabled && (t.sourceId || t.text.trim()));
