'use client';

import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatWeight, ParsedWeight } from '@/lib/emphasis';

interface Props {
  /** The field the bar floats above (read in an effect, not during render). */
  getAnchor: () => HTMLElement | null;
  parsed: ParsedWeight;
  onStep: (dir: 1 | -1) => void;
  onSetWeight: (weight: number) => void;
  /** Lets the field keep the bar open while focus is inside it. */
  onFocusChange: (focused: boolean) => void;
}

const MIN = -1;
const MAX = 3;

/** Fine-grained weight control for the emphasis group the caret is in. Floats
 *  above its field in a portal, like the autocomplete dropdown does below. */
export function WeightBar({ getAnchor, parsed, onStep, onSetWeight, onFocusChange }: Props) {
  const [pos, setPos] = useState<{ left: number; width: number; bottom: number } | null>(null);
  // The number box keeps its own text while being typed in, so "1." isn't
  // reformatted away mid-keystroke; it commits on Enter or blur.
  const [draft, setDraft] = useState<string | null>(null);

  useLayoutEffect(() => {
    function place() {
      const anchor = getAnchor();
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      setPos({ left: r.left, width: Math.max(r.width, 260), bottom: window.innerHeight - r.top + 4 });
    }
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [getAnchor]);

  if (!pos) return null;

  const weight = Math.round(parsed.weight * 100) / 100;
  const form =
    parsed.kind === 'numeric'
      ? 'exact'
      : parsed.kind === 'brace'
        ? `${parsed.level > 0 ? '{}' : '[]'}×${Math.abs(parsed.level)} ≈`
        : '';

  function commitDraft() {
    if (draft === null) return;
    const w = parseFloat(draft);
    if (Number.isFinite(w)) onSetWeight(w);
    setDraft(null);
  }

  const btn =
    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-slate-700 text-sm font-bold text-slate-200 transition-colors hover:bg-violet-600';

  return createPortal(
    <div
      className="fixed z-50 flex flex-col gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 shadow-xl"
      style={{ left: pos.left, width: pos.width, bottom: pos.bottom }}
      onFocus={() => onFocusChange(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFocusChange(false);
      }}
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="min-w-0 truncate text-slate-300" title={parsed.inner}>
          {parsed.inner}
        </span>
        <span className="flex-shrink-0 text-slate-500">Ctrl+↑/↓</span>
      </div>
      <div className="flex items-center gap-1.5">
        {/* The step buttons keep focus in the field, so the edit stays undoable
            and the caret stays put. */}
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => onStep(-1)} title="Less emphasis">
          −
        </button>
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={0.05}
          value={Math.min(MAX, Math.max(MIN, weight))}
          onChange={(e) => onSetWeight(parseFloat(e.target.value))}
          className="min-w-0 flex-1 accent-violet-500"
          title="Set an exact weight (writes weight::text::)"
        />
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => onStep(1)} title="More emphasis">
          +
        </button>
        {form && <span className="flex-shrink-0 text-[10px] text-slate-500">{form}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={draft ?? formatWeight(weight)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Don't submit the form (i.e. generate).
              e.preventDefault();
              commitDraft();
            }
          }}
          className="w-12 flex-shrink-0 rounded bg-slate-900/60 px-1.5 py-0.5 text-center text-xs text-slate-100 outline-none border border-slate-700 focus:border-violet-500"
        />
        <button
          type="button"
          className="flex-shrink-0 text-xs text-slate-500 transition-colors hover:text-slate-200"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSetWeight(1)}
          title="Remove emphasis"
        >
          Reset
        </button>
      </div>
    </div>,
    document.body,
  );
}
