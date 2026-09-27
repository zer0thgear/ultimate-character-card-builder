'use client';

import { create } from 'zustand';

// Whether a phone's on-screen keyboard is up, so the layout can give the
// text you're typing the room: the phone's bottom bar and the chat's header
// hide while it is. Browsers don't say so directly; it's up when a text
// field is focused on a touch screen and the visible area is well short of
// the tallest it's been at this width. layout.tsx asks Chrome to shrink the page to
// fit above the keyboard (interactive-widget=resizes-content).

export const useKeyboard = create<{ open: boolean }>(() => ({ open: false }));

const editable = (el: Element | null): el is HTMLElement =>
  !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color'].includes(el.type)) || (el as HTMLElement).isContentEditable);

let watching = false;

/** Starts watching (once, from the Shell). */
export function watchKeyboard() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const coarse = window.matchMedia('(pointer: coarse)');
  // The viewport's full height at each width (turning the phone changes it).
  const tallest = new Map<number, number>();
  const check = () => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    const width = Math.round(window.innerWidth);
    const full = Math.max(tallest.get(width) ?? 0, height);
    tallest.set(width, full);
    const open = coarse.matches && editable(document.activeElement) && height < full * 0.75;
    if (open !== useKeyboard.getState().open) useKeyboard.setState({ open });
  };
  // Once the keyboard has opened (the viewport has finished shrinking), the
  // field being typed in goes back into view if it ended up under it.
  let settle: ReturnType<typeof setTimeout> | undefined;
  const reveal = () => {
    check();
    clearTimeout(settle);
    settle = setTimeout(() => {
      const el = document.activeElement;
      if (!coarse.matches || !editable(el)) return;
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const top = vv?.offsetTop ?? 0;
      const bottom = top + (vv?.height ?? window.innerHeight);
      if (r.bottom > bottom || r.top < top) el.scrollIntoView({ block: r.height > bottom - top ? 'start' : 'nearest' });
    }, 250);
  };
  check();
  window.visualViewport?.addEventListener('resize', reveal);
  window.addEventListener('resize', reveal);
  document.addEventListener('focusin', reveal);
  // Focus moving between fields fires out then in; check after both.
  document.addEventListener('focusout', () => setTimeout(check, 50));
}
