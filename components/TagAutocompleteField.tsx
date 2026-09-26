'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NovelAIModel } from '@/types/novelai';
import { TagSuggestion, useTagSuggestions } from '@/hooks/useTagSuggestions';
import { currentSegment, applySegment, relevanceBrightness } from '@/lib/tagAutocomplete';
import { isRandomEntry, randomOptions } from '@/lib/wildcards';
import { useSettingsStore } from '@/store/settingsStore';
import { findWeightTarget, parseWeighted, Span, stepWeight, withWeight } from '@/lib/emphasis';
import { WeightBar } from '@/components/WeightBar';

/** A tag from NovelAI, or (with `hint`) a Tidbit Library reference. */
type Suggestion = TagSuggestion & { hint?: string };

const DROPDOWN_MAX_HEIGHT = 240;
const VIEWPORT_MARGIN = 8;

// Shared tag-autocomplete wiring for any single-line/multi-line text field
// that should get live suggest-tags autocomplete — the base prompt, a
// character's prompt/negative prompt, or a prompt tidbit's text. Each
// instance manages its own suggestion state independently (only one field
// can be focused at a time anyway), so this drops in anywhere without a
// shared "which field is active" coordinator.
interface TagAutocompleteFieldProps {
  as?: 'textarea' | 'input';
  value: string;
  onChange: (value: string) => void;
  model: NovelAIModel;
  apiKey: string;
  className: string;
  /** Wraps the field + dropdown; override when the field lives in a flex row
   *  (e.g. a tidbit's text input) so the dropdown's width tracks the field,
   *  not the whole row. Defaults to a block-level relative wrapper. */
  wrapperClassName?: string;
  placeholder?: string;
  rows?: number;
  /** Enter (no Shift, not IME-composing) submits the form — matches
   *  NovelAI's own base prompt box. Off by default; only the base prompt
   *  opts in, since Enter submitting from a character-prompt or tidbit
   *  field would be surprising. */
  enterToSubmit?: boolean;
}

/** Input from typing or deleting at the keyboard, as opposed to pasting,
 *  dropping, cutting, undo/redo or autocorrect. */
function isTyping(inputType: string | undefined): boolean {
  if (!inputType) return false;
  return (
    inputType === 'insertText' ||
    inputType === 'insertCompositionText' ||
    inputType.startsWith('deleteContent') ||
    inputType.startsWith('deleteWord')
  );
}

export function TagAutocompleteField({
  as = 'textarea',
  value,
  onChange,
  model,
  apiKey,
  className,
  wrapperClassName = 'relative',
  placeholder,
  rows,
  enterToSubmit = false,
}: TagAutocompleteFieldProps) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  // Suggestions only follow typing. Moving the caret, pasting, dropping,
  // undo, Escape or a weight change all switch them off until the next
  // typed character or deletion.
  const [active, setActive] = useState(false);
  // Where typing left the caret, so the select event that follows a
  // keystroke isn't mistaken for the caret being moved.
  const typedCaret = useRef<{ start: number; end: number } | null>(null);
  // Set while this component edits the text itself (weight changes).
  const selfEdit = useRef(false);
  const fieldRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const [placement, setPlacement] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const library = useSettingsStore((s) => s.tidbitLibrary);
  const query = cursor !== null && active ? currentSegment(value, cursor) : '';
  // A segment starting with `__` is a library reference being typed, so
  // suggest labels locally instead of asking NovelAI for tags.
  const libraryQuery = query.startsWith('__') ? query.slice(2).replace(/_+$/, '').toLowerCase() : null;
  const { suggestions: tagSuggestions } = useTagSuggestions(libraryQuery === null ? query : '', model, apiKey);
  const rawSuggestions: Suggestion[] =
    libraryQuery === null ? tagSuggestions : librarySuggestions(libraryQuery);
  const suggestions = active ? rawSuggestions : [];

  function librarySuggestions(q: string): Suggestion[] {
    const seen = new Set<string>();
    return library
      .map((entry) => ({ entry, label: entry.label.trim() }))
      .filter(({ label }) => {
        const key = label.toLowerCase();
        if (!label || seen.has(key) || !key.includes(q)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)))
      .slice(0, 8)
      .map(({ entry, label }) => ({
        tag: `__${label}__`,
        count: 10000,
        confidence: 0,
        hint: isRandomEntry(entry) ? `⚄ ${randomOptions(entry).length} options` : 'fixed',
      }));
  }
  const dropdownOpen = cursor !== null && suggestions.length > 0;

  // The field can sit inside any number of `overflow-hidden`/`overflow-auto`
  // ancestors (card corners, the sidebar's own scroll container, …) that
  // would otherwise clip an absolutely-positioned dropdown to whatever
  // sliver of space happens to be left. Rendering it into a `fixed`-position
  // portal on <body> escapes all of that, so it's computed here from the
  // field's live bounding rect instead of being laid out in normal flow.
  useLayoutEffect(() => {
    if (!dropdownOpen) return;

    function reposition() {
      const el = fieldRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - VIEWPORT_MARGIN;
      const placeAbove = spaceBelow < 120 && spaceAbove > spaceBelow;
      const available = placeAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(80, Math.min(DROPDOWN_MAX_HEIGHT, available));
      setPlacement({
        left: rect.left,
        width: rect.width,
        maxHeight,
        ...(placeAbove
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      });
    }

    reposition();
    // `scroll` doesn't bubble, so listen in the capture phase to catch it
    // firing on any scrollable ancestor, not just the window.
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [dropdownOpen, suggestions.length]);

  function select(tag: string) {
    if (cursor === null) return;
    const { text, cursor: newCursor } = applySegment(value, cursor, tag);
    onChange(text);
    setCursor(newCursor);
    setActive(false);
    setHighlightIndex(0);
    // setTimeout rather than requestAnimationFrame, which the browser
    // pauses entirely while the tab is hidden/backgrounded.
    setTimeout(() => {
      fieldRef.current?.focus();
      fieldRef.current?.setSelectionRange(newCursor, newCursor);
    }, 0);
  }

  // ── Emphasis (Ctrl+↑/↓ and the weight bar) ─────────────────────────────
  const [weightSpan, setWeightSpan] = useState<Span | null>(null);
  const [barFocused, setBarFocused] = useState(false);
  const getField = useCallback(() => fieldRef.current, []);

  function trackWeightSpan(el: HTMLTextAreaElement | HTMLInputElement) {
    setWeightSpan(findWeightTarget(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0));
  }

  /** Swaps a span's text, leaving the new group selected so repeated steps
   *  keep acting on it. */
  function replaceSpan(span: Span, next: string) {
    const el = fieldRef.current;
    const newSpan = { start: span.start, end: span.start + next.length };
    setWeightSpan(newSpan);
    setActive(false);
    // Editing through the browser keeps Ctrl+Z working. That needs the field
    // focused, which it isn't while the slider or number box is in use.
    if (el && document.activeElement === el) {
      el.setSelectionRange(span.start, span.end);
      selfEdit.current = true;
      const inserted = document.execCommand('insertText', false, next);
      selfEdit.current = false;
      if (inserted) {
        el.setSelectionRange(newSpan.start, newSpan.end);
        return;
      }
      setTimeout(() => el.setSelectionRange(newSpan.start, newSpan.end), 0);
    }
    onChange(value.slice(0, span.start) + next + value.slice(span.end));
  }

  const spanText = weightSpan && weightSpan.end <= value.length ? value.slice(weightSpan.start, weightSpan.end) : null;
  const parsedWeight = spanText ? parseWeighted(spanText) : null;
  // Shown while the caret is in a weighted group (so one Ctrl+↑ reveals it),
  // and kept while you're using it, even if that takes the weight back to 1.
  const showWeightBar = !!parsedWeight && ((cursor !== null && parsedWeight.kind !== 'plain') || barFocused);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    // Before the dropdown's own arrow handling: Ctrl+arrows always mean emphasis.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const el = e.currentTarget;
      const span = findWeightTarget(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0);
      if (span) replaceSpan(span, stepWeight(el.value.slice(span.start, span.end), e.key === 'ArrowUp' ? 1 : -1));
      return;
    }
    if (dropdownOpen && e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
      return;
    }
    if (dropdownOpen && e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (dropdownOpen && e.key === 'Escape') {
      e.preventDefault();
      setActive(false);
      return;
    }
    // Ctrl/Cmd+Enter is Generate, wherever the caret is, so it beats the
    // dropdown's own Enter.
    if (dropdownOpen && (e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing && !(e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      select(suggestions[highlightIndex].tag);
      return;
    }
    if (enterToSubmit && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  const sharedProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const el = e.target;
      onChange(el.value);
      setCursor(el.selectionStart);
      setHighlightIndex(0);
      const typed = !selfEdit.current && isTyping((e.nativeEvent as InputEvent).inputType);
      setActive(typed);
      typedCaret.current = typed ? { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 } : null;
      trackWeightSpan(el);
    },
    onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const el = e.currentTarget;
      setCursor(el.selectionStart);
      // A select event where typing didn't just leave the caret means it moved
      // (click, arrow keys, selecting text), so hide the suggestions.
      const typed = typedCaret.current;
      if (!typed || typed.start !== el.selectionStart || typed.end !== el.selectionEnd) {
        typedCaret.current = null;
        setActive(false);
      }
      trackWeightSpan(el);
    },
    onBlur: () => setTimeout(() => setCursor(null), 150),
    onKeyDown: handleKeyDown,
    placeholder,
    className,
  };

  return (
    <div className={wrapperClassName}>
      {as === 'textarea' ? (
        <textarea ref={fieldRef as React.Ref<HTMLTextAreaElement>} rows={rows} {...sharedProps} />
      ) : (
        <input ref={fieldRef as React.Ref<HTMLInputElement>} type="text" {...sharedProps} />
      )}
      {showWeightBar && weightSpan && parsedWeight && (
        <WeightBar
          getAnchor={getField}
          parsed={parsedWeight}
          onStep={(dir) => replaceSpan(weightSpan, stepWeight(value.slice(weightSpan.start, weightSpan.end), dir))}
          onSetWeight={(w) => replaceSpan(weightSpan, withWeight(parsedWeight.inner, w))}
          onFocusChange={setBarFocused}
        />
      )}
      {dropdownOpen &&
        placement &&
        createPortal(
          <div
            className="fixed z-50 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-xl"
            style={{
              left: placement.left,
              width: placement.width,
              maxHeight: placement.maxHeight,
              ...(placement.top !== undefined ? { top: placement.top } : { bottom: placement.bottom }),
            }}
          >
            {suggestions.map((s, i) => (
              <button
                key={s.tag}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep field focus so blur doesn't fire first
                  select(s.tag);
                }}
                onMouseEnter={() => setHighlightIndex(i)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  i === highlightIndex ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                {/* Relevance dot — mirrors NovelAI's own "Did you mean?" chips,
                    which fade a dot from white (exact/very common) down to
                    near-invisible based on `count`, not `confidence`. */}
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${s.hint ? 'bg-violet-400' : 'bg-white'}`}
                  style={{ opacity: s.hint ? 1 : relevanceBrightness(s.count) }}
                  title={
                    s.hint
                      ? 'Tidbit Library entry'
                      : `count ${s.count.toLocaleString()}${s.confidence ? `, confidence ${(s.confidence * 100).toFixed(0)}%` : ''}`
                  }
                />
                <span className="flex-1">{s.tag}</span>
                <span className="text-[10px] opacity-60">
                  {s.hint ?? (s.count >= 10000 ? '' : s.count.toLocaleString())}
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
