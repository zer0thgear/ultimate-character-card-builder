import { LibraryTidbit, PromptTidbit } from '@/types/novelai';

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
  return { id: crypto.randomUUID(), label, text: '', enabled: true };
}

/** A prompt-level tidbit linked to a library entry. Label/text are snapshotted
 *  so the tidbit still reads sensibly if the entry is later deleted. */
export function createLinkedTidbit(entry: LibraryTidbit): PromptTidbit {
  return {
    id: crypto.randomUUID(),
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
