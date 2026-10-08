'use client';

import { useUiStore } from '@/store/uiStore';
import { cx } from '@/components/ui';
import type { ProjectSummary } from '@/types/project';
import { CardAppTags } from '@/components/AppTags';

/** Under a card's name in a list: its author and the start of its
 *  creator's notes, as SillyTavern's list shows them (each can be switched
 *  off in Settings → General). */
export function CardListMeta({ summary, className }: { summary: Pick<ProjectSummary, 'id' | 'creator' | 'notes'>; className?: string }) {
  const showCreator = useUiStore((s) => s.listShowsCreator);
  const setCardAuthor = useUiStore((s) => s.setCardAuthor);
  const showNotes = useUiStore((s) => s.listShowsNotes);
  const creator = showCreator && summary.creator;
  const notes = showNotes && summary.notes;
  // Your app tags (components/AppTags.tsx) show either way.
  if (!creator && !notes) return <CardAppTags cardId={summary.id} className={className} />;
  return (
    <>
      {creator && (
        <span className={cx('block truncate text-[11px] text-slate-400', className)}>
          by{' '}
          {/* Inside the card's own button, so a click here mustn't open it. */}
          <span
            className="cursor-pointer hover:text-sky-300 hover:underline"
            title={`Only ${creator}'s cards`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCardAuthor(useUiStore.getState().appMode, creator);
            }}
          >
            {creator}
          </span>
        </span>
      )}
      {notes && (
        <span className={cx('line-clamp-2 block text-[11px] leading-snug text-slate-500', className)} title={summary.notes}>
          {notes}
        </span>
      )}
      <CardAppTags cardId={summary.id} className={className} />
    </>
  );
}
