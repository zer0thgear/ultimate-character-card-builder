'use client';

import { useUiStore } from '@/store/uiStore';
import { cx } from '@/components/ui';
import type { ProjectSummary } from '@/types/project';

/** Under a card's name in a list: its author and the start of its
 *  creator's notes, as SillyTavern's list shows them (each can be switched
 *  off in Settings → General). */
export function CardListMeta({ summary, className }: { summary: Pick<ProjectSummary, 'creator' | 'notes'>; className?: string }) {
  const showCreator = useUiStore((s) => s.listShowsCreator);
  const showNotes = useUiStore((s) => s.listShowsNotes);
  const creator = showCreator && summary.creator;
  const notes = showNotes && summary.notes;
  if (!creator && !notes) return null;
  return (
    <>
      {creator && <span className={cx('block truncate text-[11px] text-slate-400', className)}>by {creator}</span>}
      {notes && (
        <span className={cx('line-clamp-2 block text-[11px] leading-snug text-slate-500', className)} title={summary.notes}>
          {notes}
        </span>
      )}
    </>
  );
}
