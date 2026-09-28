'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { cx } from '@/components/ui';

// Pictures, full screen: swipe (or ←/→, or ‹ ›) between them, pinch or
// scroll to zoom, drag to pan when zoomed, double-tap (or double-click) to
// zoom in and back, and swipe down, tap beside the picture, Back, Escape or ✕ to close. On a phone
// it also asks the browser for real fullscreen, hiding its bars; Android's
// Back leaves both at once.

interface Open {
  srcs: string[];
  index: number;
  /** Told which picture is showing, so the view underneath can follow. */
  onIndex?: (index: number) => void;
}

const useLightbox = create<{ open: Open | null; session: number }>(() => ({ open: null, session: 0 }));

// Opening adds a history entry, so Back (the phone's gesture, or the
// browser's) closes the pictures instead of leaving the page. Kept out of
// React so it happens exactly once per opening. (Next.js rewrites the state
// of entries it doesn't own, so whether ours is on top is tracked here.)
let entryPushed = false;

/** Opens one picture, or a list of them at `index`. */
export function openLightbox(srcs: string | string[], index = 0, onIndex?: (index: number) => void) {
  const list = Array.isArray(srcs) ? srcs : [srcs];
  if (list.length === 0) return;
  if (!entryPushed) {
    history.pushState(null, '');
    entryPushed = true;
    window.addEventListener('popstate', onPop, { once: true });
  }
  useLightbox.setState((s) => ({ open: { srcs: list, index: Math.max(0, Math.min(list.length - 1, index)), onIndex }, session: s.session + 1 }));
}

function onPop() {
  entryPushed = false;
  finish();
}

function finish() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  useLightbox.setState({ open: null });
}

export function closeLightbox() {
  // Undo our entry; its popstate then closes the pictures.
  if (entryPushed) history.back();
  else finish();
}

const MAX_SCALE = 8;
const COARSE = '(pointer: coarse)';
const SLIDE_MS = 220;

interface View {
  s: number;
  x: number;
  y: number;
}
const FIT: View = { s: 1, x: 0, y: 0 };

export function Lightbox() {
  const { open, session } = useLightbox();
  if (!open) return null;
  return <LightboxView key={session} {...open} />;
}

function LightboxView({ srcs, index: startIndex, onIndex }: Open) {
  const root = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(startIndex);
  const [view, setView] = useState<View>(FIT);
  const [drag, setDrag] = useState(0); // swipe-down offset while closing
  const [shift, setShift] = useState(0); // sideways offset while swiping between pictures
  const [touching, setTouching] = useState(false);
  const [canFullscreen] = useState(() => typeof document !== 'undefined' && !!document.fullscreenEnabled);
  const viewRef = useRef(view);
  const indexRef = useRef(index);
  useLayoutEffect(() => {
    viewRef.current = view;
    indexRef.current = index;
  }, [view, index]);
  const sliding = useRef(false);
  const close = closeLightbox;
  const many = srcs.length > 1;

  /** Slides to the next (1) or previous (-1) picture, if there is one. */
  const step = (d: 1 | -1) => {
    const to = indexRef.current + d;
    if (sliding.current) return;
    if (to < 0 || to >= srcs.length) return setShift(0);
    sliding.current = true;
    setView(FIT);
    setShift(-d * (root.current?.clientWidth ?? window.innerWidth));
    setTimeout(() => {
      // The neighbour's slot is already where the new current one goes, so
      // swapping the index and the offset together doesn't move anything.
      setIndex(to);
      setShift(0);
      sliding.current = false;
      onIndex?.(to);
    }, SLIDE_MS);
  };
  const stepRef = useRef(step);
  useLayoutEffect(() => {
    stepRef.current = step;
  });

  useEffect(() => {
    // Captured first, so the dialog underneath doesn't also act on these keys.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') stepRef.current(-1);
      else if (e.key === 'ArrowRight') stepRef.current(1);
      else return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    // Leaving fullscreen (Android's Back does that first) closes it too.
    let wasFull = false;
    const onFull = () => {
      if (document.fullscreenElement) wasFull = true;
      else if (wasFull) closeLightbox();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('fullscreenchange', onFull);
    if (document.fullscreenEnabled && window.matchMedia(COARSE).matches && !document.fullscreenElement) void root.current?.requestFullscreen?.().catch(() => {});
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFull);
    };
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void root.current?.requestFullscreen?.().catch(() => {});
  };

  /** Zooms to `s` keeping the point (px, py), relative to the centre, still. */
  const zoomAt = (s: number, px: number, py: number, from = viewRef.current): View => {
    const next = Math.min(MAX_SCALE, Math.max(1, s));
    if (next === 1) return FIT;
    const k = next / from.s;
    return { s: next, x: px - (px - from.x) * k, y: py - (py - from.y) * k };
  };
  const centreOffset = (clientX: number, clientY: number) => {
    const r = root.current!.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2] as const;
  };

  // ─── gestures ──────────────────────────────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    view: View;
    dist: number;
    mid: [number, number];
    start: [number, number];
    at: number;
    moved: boolean;
    /** At fit size, a one-finger drag is either a swipe between pictures
     *  or a swipe down to close, decided once. */
    axis: 'x' | 'y' | null;
  } | null>(null);
  const lastTap = useRef(0);

  const begin = () => {
    const pts = [...pointers.current.values()];
    const mid: [number, number] = pts.length > 1 ? [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2] : [pts[0].x, pts[0].y];
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    const prev = gesture.current;
    gesture.current = { view: viewRef.current, dist, mid, start: mid, at: Date.now(), moved: prev?.moved ?? false, axis: prev?.axis ?? null };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || sliding.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (a synthetic event); the gesture works without it */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = null;
    setTouching(true);
    begin();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length > 1) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
      const [px, py] = centreOffset(g.mid[0], g.mid[1]);
      const z = zoomAt(g.view.s * (dist / (g.dist || dist)), px, py, g.view);
      g.moved = true;
      g.axis = null;
      setDrag(0);
      setShift(0);
      setView(z.s === 1 ? z : { ...z, x: z.x + mid[0] - g.mid[0], y: z.y + mid[1] - g.mid[1] });
      return;
    }
    const dx = pts[0].x - g.start[0];
    const dy = pts[0].y - g.start[1];
    if (Math.hypot(dx, dy) > 6) g.moved = true;
    if (g.view.s > 1) return setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    if (g.axis === null && g.moved) g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (g.axis === 'x') {
      // Past the first or last picture it only gives a little.
      const edge = (dx > 0 && indexRef.current === 0) || (dx < 0 && indexRef.current === srcs.length - 1);
      setShift(edge ? dx * 0.3 : dx);
    } else if (g.axis === 'y') setDrag(Math.max(0, dy));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size > 0) return begin(); // one finger of a pinch lifted
    setTouching(false);
    if (g?.axis === 'y') {
      if (drag > 120) return close();
      return setDrag(0);
    }
    if (g?.axis === 'x') {
      const width = root.current?.clientWidth ?? window.innerWidth;
      const quick = Date.now() - g.at < 250 && Math.abs(shift) > 30;
      if (Math.abs(shift) > width * 0.2 || quick) return step(shift < 0 ? 1 : -1);
      return setShift(0);
    }
    if (!g || g.moved) return;
    // A tap beside the picture (on the black) closes it, as clicking
    // outside a dialog does. Not while zoomed in: then it's all picture.
    if (viewRef.current.s === 1) {
      const pic = root.current?.querySelector('[data-slot="0"] img')?.getBoundingClientRect();
      if (pic && (e.clientX < pic.left || e.clientX > pic.right || e.clientY < pic.top || e.clientY > pic.bottom)) return close();
    }
    // A tap on it: two in a row zoom in on that spot, or back out.
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      const [px, py] = centreOffset(e.clientX, e.clientY);
      setView(viewRef.current.s > 1 ? FIT : zoomAt(2.5, px, py));
    } else lastTap.current = now;
  };

  const onWheel = (e: React.WheelEvent) => {
    const [px, py] = centreOffset(e.clientX, e.clientY);
    setView(zoomAt(viewRef.current.s * Math.exp(-e.deltaY * 0.002), px, py));
  };

  const zoomed = view.s > 1;
  const animate = !touching && 'transition-transform duration-200 ease-out';
  // The current picture and its neighbours, each in a full-screen slot a
  // screen's width apart. Keyed by picture, so a slot keeps its element
  // when it becomes the current one.
  const slots = [index - 1, index, index + 1].filter((i) => i >= 0 && i < srcs.length);
  return (
    <div
      ref={root}
      data-lightbox
      className="fixed inset-0 z-[60] overflow-hidden bg-black select-none"
      // The page mustn't pinch-zoom or scroll under the picture's own gestures.
      style={{ touchAction: 'none', backgroundColor: drag ? `rgba(0,0,0,${Math.max(0.3, 1 - drag / 400)})` : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={(e) => {
        // Mice: pointer taps already handle touch.
        if (window.matchMedia(COARSE).matches || (e.target as HTMLElement).closest('button')) return;
        const [px, py] = centreOffset(e.clientX, e.clientY);
        setView(viewRef.current.s > 1 ? FIT : zoomAt(2.5, px, py));
      }}
    >
      {slots.map((i) => (
        <div key={i} data-slot={i - index} className={cx('pointer-events-none absolute inset-0', animate)} style={{ transform: `translateX(calc(${(i - index) * 100}% + ${shift}px))` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={srcs[i]}
            alt=""
            draggable={false}
            className={cx('absolute inset-0 m-auto max-h-full max-w-full object-contain', animate)}
            style={i === index ? { transform: `translate(${view.x}px, ${view.y + drag}px) scale(${view.s})` } : undefined}
          />
        </div>
      ))}
      {many && (
        <div className="absolute top-0 left-0 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-sm text-white/80 [text-shadow:0_1px_2px_black]">
          {index + 1} / {srcs.length}
        </div>
      )}
      <div className="absolute top-0 right-0 flex gap-1 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {zoomed && (
          <LightboxButton title="Fit to the screen" onClick={() => setView(FIT)}>
            ⤢
          </LightboxButton>
        )}
        {canFullscreen && (
          <LightboxButton title="Browser fullscreen" onClick={toggleFullscreen}>
            ⛶
          </LightboxButton>
        )}
        <LightboxButton title="Close (Esc)" onClick={close}>
          ✕
        </LightboxButton>
      </div>
      {/* Arrows for a mouse; fingers swipe. */}
      {many && index > 0 && (
        <LightboxButton title="Previous (←)" className="absolute top-1/2 left-2 -translate-y-1/2 touch:hidden" onClick={() => step(-1)}>
          ‹
        </LightboxButton>
      )}
      {many && index < srcs.length - 1 && (
        <LightboxButton title="Next (→)" className="absolute top-1/2 right-2 -translate-y-1/2 touch:hidden" onClick={() => step(1)}>
          ›
        </LightboxButton>
      )}
    </div>
  );
}

function LightboxButton({ title, onClick, className, children }: { title: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={cx('flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-lg text-white hover:bg-black/80', className)}>
      {children}
    </button>
  );
}
