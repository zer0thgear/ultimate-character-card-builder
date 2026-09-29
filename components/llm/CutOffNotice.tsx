'use client';

import { Button } from '@/components/ui';

/**
 * Shown when an assistant reply stopped at the model's token limit. With
 * text, → Continue picks it up. With none (a reasoning model thought its
 * whole budget away, often drafting the answer in its reasoning), the
 * reasoning can become the draft, or the request can run again with twice
 * the room.
 */
export function CutOffNotice({ show, hasText, reasoning, onUseReasoning, onRetry }: { show: boolean; hasText: boolean; reasoning: string; onUseReasoning?: () => void; onRetry: () => void }) {
  if (!show) return null;
  if (hasText) {
    return (
      <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        The reply stopped at the model&apos;s token limit. <b>→ Continue</b> (beside Run) picks up where it left off, or raise the connection&apos;s max tokens in Settings.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      <span>
        The model spent its whole token limit reasoning and never got to the reply{reasoning.trim() ? ' (its reasoning may already hold a draft)' : ''}. For next time, raise the connection&apos;s max tokens in Settings or lower its reasoning effort.
      </span>
      <div className="flex flex-wrap gap-1.5">
        {reasoning.trim() && onUseReasoning && (
          <Button size="sm" onClick={onUseReasoning} title="Put what it wrote while thinking into the suggestion, to edit, continue or use">
            Use its reasoning as the draft
          </Button>
        )}
        <Button size="sm" onClick={onRetry} title="The same request once more, with twice the connection's max tokens (the setting itself isn't changed)">
          Run again with twice the room
        </Button>
      </div>
    </div>
  );
}
