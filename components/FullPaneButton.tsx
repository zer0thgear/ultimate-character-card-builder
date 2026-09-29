'use client';

import { useUiStore } from '@/store/uiStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { PHONE_QUERY } from '@/hooks/useMediaQuery';
import { IconButton } from '@/components/ui';

/** ⤢ Lets one side (the card editor, or the dock with whichever tab is
 *  open) fill the window; ⤡ puts both back side by side. Not on a phone,
 *  where each is a screen of its own already. */
export function FullPaneButton({ pane }: { pane: 'card' | 'dock' }) {
  const full = useUiStore((s) => s.fullPane);
  const setFull = useUiStore((s) => s.setFullPane);
  const phone = useMediaQuery(PHONE_QUERY);
  if (phone) return null;
  const on = full === pane;
  return (
    <IconButton
      title={on ? 'Back to the card and the dock side by side' : pane === 'card' ? 'Fill the window with the card (hides the dock)' : 'Fill the window with this side (hides the card), whichever tab is open'}
      onClick={() => setFull(on ? null : pane)}
      className="flex-shrink-0"
    >
      {on ? '⤡' : '⤢'}
    </IconButton>
  );
}
