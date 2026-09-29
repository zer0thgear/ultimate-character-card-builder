'use client';

import { useEffect, useRef, useState } from 'react';

// Help text on a touch screen. A mouse shows an element's `title` on hover;
// a finger can't hover, so holding a button (or anything with a title) for
// a moment shows its title in a bubble instead, and letting go doesn't then
// press it. Text fields keep the phone's own long press (selecting text),
// and anything with a long press of its own opts out with data-longpress.

const HOLD_MS = 450;
const SLOP_PX = 10;

/** What a long press on this element would explain, if anything. */
function tipFor(target: EventTarget | null): { el: HTMLElement; text: string } | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('input, textarea, select, [contenteditable="true"], [data-longpress], [data-lightbox]')) return null;
  const el = target.closest<HTMLElement>('[title], button[aria-label], [role="button"][aria-label]');
  const text = (el?.getAttribute('title') || el?.getAttribute('aria-label') || '').trim();
  return el && text ? { el, text } : null;
}

/** Mounted once (Shell). */
export function TouchTips() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let start: [number, number] = [0, 0];
    // After a tip shows, the touch's click (and the phone's own long-press
    // menu) are swallowed, so the button isn't pressed as well.
    let swallowUntil = 0;
    let hide: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      setTip(null);
      cancel();
      const found = tipFor(e.target);
      if (!found) return;
      start = [e.clientX, e.clientY];
      timer = setTimeout(() => {
        timer = null;
        swallowUntil = Date.now() + 1500;
        navigator.vibrate?.(8);
        setTip({ text: found.text, rect: found.el.getBoundingClientRect() });
        if (hide) clearTimeout(hide);
        hide = setTimeout(() => setTip(null), 5000);
      }, HOLD_MS);
    };
    const move = (e: PointerEvent) => {
      if (timer && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > SLOP_PX) cancel();
    };
    const swallow = (e: Event) => {
      if (Date.now() < swallowUntil) {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'click') swallowUntil = 0;
      }
    };
    const away = () => setTip(null);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', cancel, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('click', swallow, true);
    document.addEventListener('contextmenu', swallow, true);
    window.addEventListener('scroll', away, true);
    return () => {
      cancel();
      if (hide) clearTimeout(hide);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', cancel, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('click', swallow, true);
      document.removeEventListener('contextmenu', swallow, true);
      window.removeEventListener('scroll', away, true);
    };
  }, []);

  // Above the element when there's room, else below; kept on screen.
  useEffect(() => {
    if (!tip || !bubble.current) return setPos(null);
    const b = bubble.current.getBoundingClientRect();
    const gap = 8;
    const left = Math.min(Math.max(8, tip.rect.left + tip.rect.width / 2 - b.width / 2), window.innerWidth - b.width - 8);
    const above = tip.rect.top - b.height - gap;
    setPos({ left, top: above >= 8 ? above : Math.min(tip.rect.bottom + gap, window.innerHeight - b.height - 8) });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={bubble}
      role="tooltip"
      className="pointer-events-none fixed z-[80] max-w-[min(18rem,calc(100vw-16px))] rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs leading-snug text-slate-100 shadow-xl"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {tip.text}
    </div>
  );
}
