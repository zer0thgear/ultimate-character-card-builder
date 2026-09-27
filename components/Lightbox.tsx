'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { cx } from '@/components/ui';

// Any picture, full screen: pinch or scroll to zoom, drag to pan when
// zoomed, double-tap (or double-click) to zoom in and back, and swipe down,
// Back, Escape or ✕ to close. On a phone it also asks the browser for real
// fullscreen, hiding its bars; Android's Back leaves both at once.

const useLightbox = create<{ src: string | null }>(() => ({ src: null }));

// Opening adds a history entry, so Back (the phone's gesture, or the
// browser's) closes the picture instead of leaving the page. Kept out of
// React so it happens exactly once per opening. (Next.js rewrites the state
// of entries it doesn't own, so whether ours is on top is tracked here.)
let entryPushed = false;

export function openLightbox(src: string) {
  if (!entryPushed) {
    history.pushState(null, '');
    entryPushed = true;
    window.addEventListener('popstate', onPop, { once: true });
  }
  useLightbox.setState({ src });
}

function onPop() {
  entryPushed = false;
  finish();
}

function finish() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  useLightbox.setState({ src: null });
}

export function closeLightbox() {
  // Undo our entry; its popstate then closes the picture.
  if (entryPushed) history.back();
  else finish();
}

const MAX_SCALE = 8;
const COARSE = '(pointer: coarse)';

interface View {
  s: number;
  x: number;
  y: number;
}

export function Lightbox() {
  const src = useLightbox((s) => s.src);
  if (!src) return null;
  return <LightboxView key={src} src={src} />;
}

function LightboxView({ src }: { src: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState(0); // swipe-down offset while closing
  const [canFullscreen] = useState(() => typeof document !== 'undefined' && !!document.fullscreenEnabled);
  const [touching, setTouching] = useState(false);
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  const close = closeLightbox;

  useEffect(() => {
    // Captured first, so a dialog underneath doesn't close on the same Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      closeLightbox();
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
  const zoomAt = (s: number, px: number, py: number, from = viewRef.current) => {
    const next = Math.min(MAX_SCALE, Math.max(1, s));
    if (next === 1) return { s: 1, x: 0, y: 0 };
    const k = next / from.s;
    return { s: next, x: px - (px - from.x) * k, y: py - (py - from.y) * k };
  };
  const centreOffset = (clientX: number, clientY: number) => {
    const r = root.current!.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2] as const;
  };

  // ─── gestures ──────────────────────────────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; dist: number; mid: [number, number]; start: [number, number]; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  const begin = () => {
    const pts = [...pointers.current.values()];
    const mid: [number, number] = pts.length > 1 ? [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2] : [pts[0].x, pts[0].y];
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { view: viewRef.current, dist, mid, start: mid, moved: gesture.current?.moved ?? false };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
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
      setDrag(0);
      setView(z.s === 1 ? z : { ...z, x: z.x + mid[0] - g.mid[0], y: z.y + mid[1] - g.mid[1] });
      return;
    }
    const dx = pts[0].x - g.start[0];
    const dy = pts[0].y - g.start[1];
    if (Math.hypot(dx, dy) > 6) g.moved = true;
    if (g.view.s > 1) setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    else if (dy > 0 && Math.abs(dy) > Math.abs(dx)) setDrag(dy);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size > 0) return begin(); // one finger of a pinch lifted
    setTouching(false);
    if (drag > 120) return close();
    setDrag(0);
    if (!g || g.moved) return;
    // A tap: two in a row zoom in on that spot, or back out.
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      const [px, py] = centreOffset(e.clientX, e.clientY);
      setView(viewRef.current.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(2.5, px, py));
    } else lastTap.current = now;
  };

  const onWheel = (e: React.WheelEvent) => {
    const [px, py] = centreOffset(e.clientX, e.clientY);
    setView(zoomAt(viewRef.current.s * Math.exp(-e.deltaY * 0.002), px, py));
  };

  const zoomed = view.s > 1;
  return (
    <div
      ref={root}
      data-lightbox
      className="fixed inset-0 z-[60] bg-black select-none"
      // The page mustn't pinch-zoom or scroll under the picture's own gestures.
      style={{ touchAction: 'none', backgroundColor: drag ? `rgba(0,0,0,${Math.max(0.3, 1 - drag / 400)})` : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={(e) => {
        // Mice: pointer taps already handle touch.
        if (window.matchMedia(COARSE).matches) return;
        const [px, py] = centreOffset(e.clientX, e.clientY);
        setView(viewRef.current.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(2.5, px, py));
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        className={cx('pointer-events-none absolute inset-0 m-auto max-h-full max-w-full object-contain', !touching && 'transition-transform duration-150')}
        style={{ transform: `translate(${view.x}px, ${view.y + drag}px) scale(${view.s})` }}
      />
      <div className="absolute top-0 right-0 flex gap-1 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {zoomed && (
          <LightboxButton title="Fit to the screen" onClick={() => setView({ s: 1, x: 0, y: 0 })}>
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
    </div>
  );
}

function LightboxButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-lg text-white hover:bg-black/80">
      {children}
    </button>
  );
}
