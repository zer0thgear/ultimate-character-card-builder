import { LibraryTidbit, NovelAISampler, SweepAxisInfo } from '@/types/novelai';
import { SAMPLERS } from '@/lib/samplers';
import { joinPromptParts } from '@/lib/promptText';
import { randomSeed } from '@/lib/imageRequest';
import { randomOptions } from '@/lib/wildcards';

// X/Y parameter sweeps: one image per combination of values, everything else
// held constant (including the seed, unless it's an axis), so differences in
// the grid come from the swept parameter.

export type SweepAxisKind = 'cfg' | 'cfgRescale' | 'steps' | 'sampler' | 'seed' | 'tags' | 'wildcard';

/** One axis. `values` are raw strings for every kind: numbers as typed,
 *  sampler ids, tags to add ('' for none), or a wildcard entry's options. */
export interface SweepAxis {
  kind: SweepAxisKind;
  values: string[];
  /** The library entry being stepped through, for a wildcard axis. */
  entryId?: string;
}

/** What one grid cell overrides relative to the current form. */
export interface SweepCell {
  xIndex: number;
  yIndex?: number;
  scale?: number;
  cfgRescale?: number;
  steps?: number;
  sampler?: NovelAISampler;
  seed?: number;
  /** Tags added to the base prompt for this cell. */
  tags?: string;
  /** Random library entries pinned to one option (see resolveRequestPrompts). */
  force: Record<string, string>;
}

/** Sweeps queue one request per cell, so this caps a run at a size that's
 *  still sensible to confirm and wait for. */
export const MAX_SWEEP_CELLS = 64;

export type NumericAxisKind = 'cfg' | 'cfgRescale' | 'steps' | 'seed';

export const NUMERIC_LIMITS: Record<NumericAxisKind, { integer: boolean; min: number; max: number }> = {
  cfg: { integer: false, min: 0, max: 10 },
  cfgRescale: { integer: false, min: 0, max: 1 },
  steps: { integer: true, min: 1, max: 50 },
  seed: { integer: true, min: 0, max: 4294967295 },
};

/** Display names; a wildcard axis is named after its library entry. */
export const AXIS_NAMES: Record<Exclude<SweepAxisKind, 'wildcard'>, string> = {
  cfg: 'CFG',
  cfgRescale: 'CFG Rescale',
  steps: 'Steps',
  sampler: 'Sampler',
  seed: 'Seed',
  tags: 'Tags',
};

export function axisInfo(axis: SweepAxis, library: LibraryTidbit[]): SweepAxisInfo {
  const name =
    axis.kind === 'wildcard'
      ? library.find((l) => l.id === axis.entryId)?.label.trim() || 'Wildcard'
      : AXIS_NAMES[axis.kind];
  const label = (v: string) =>
    axis.kind === 'sampler'
      ? SAMPLERS.find((s) => s.value === v)?.label ?? v
      : axis.kind === 'tags' && v === ''
        ? '(none)'
        : v;
  return { name, values: axis.values.map(label) };
}

function apply(cell: SweepCell, axis: SweepAxis, value: string) {
  switch (axis.kind) {
    case 'cfg': cell.scale = Number(value); break;
    case 'cfgRescale': cell.cfgRescale = Number(value); break;
    case 'steps': cell.steps = Number(value); break;
    case 'sampler': cell.sampler = value as NovelAISampler; break;
    case 'seed': cell.seed = Number(value); break;
    // Both axes may add tags; they're combined.
    case 'tags': cell.tags = joinPromptParts(cell.tags, value) || undefined; break;
    case 'wildcard': if (axis.entryId) cell.force[axis.entryId] = value; break;
  }
}

/** Every cell, row by row (Y outer, X inner) — also the order they run in. */
export function sweepCells(x: SweepAxis, y?: SweepAxis): SweepCell[] {
  const cells: SweepCell[] = [];
  for (let yi = 0; yi < (y ? y.values.length : 1); yi++) {
    for (let xi = 0; xi < x.values.length; xi++) {
      const cell: SweepCell = { xIndex: xi, yIndex: y ? yi : undefined, force: {} };
      apply(cell, x, x.values[xi]);
      if (y) apply(cell, y, y.values[yi]);
      cells.push(cell);
    }
  }
  return cells;
}

/** Parses a comma- or space-separated number list, deduplicated, keeping
 *  the tokens that didn't parse (or were out of range) for display. */
export function parseNumberList(
  text: string,
  { integer, min, max }: { integer: boolean; min: number; max: number },
): { values: string[]; invalid: string[] } {
  const values: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const n = Number(token);
    if (Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n))) {
      if (!values.includes(String(n))) values.push(String(n));
    } else {
      invalid.push(token);
    }
  }
  return { values, invalid };
}

/**
 * Splits a tags list on its top-level commas, keeping NovelAI's weighted
 * groups whole: `{…}`, `[…]`, `(…)` and `1.2::…::` (weight, then text up to
 * the closing `::`). "smile, {open mouth, teeth}, 1.3::looking at viewer,
 * wink::" is three values. Trimmed, empties dropped, duplicates removed.
 */
export function parseTagList(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inWeight = false;
  let start = 0;
  const push = (end: number) => {
    const item = text.slice(start, end).trim();
    if (item && !items.includes(item)) items.push(item);
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if ((ch === '}' || ch === ']' || ch === ')') && depth > 0) depth--;
    else if (ch === ':' && text[i + 1] === ':') {
      // "n::" opens a weighted group; the next "::" closes it.
      if (inWeight) inWeight = false;
      else if (/(?:^|[\s,{[(])-?(?:\d+\.?\d*|\.\d+)$/.test(text.slice(start, i).trimEnd())) inWeight = true;
      i++;
    } else if (ch === ',' && depth === 0 && !inWeight) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  return items;
}

// ─── Axis drafts (the editor's state, also what a chain's Sweep step saves) ───

/** One axis as edited. `key` is a kind, `wildcard:<entryId>`, or `none` (Y
 *  only); `text` backs the typed kinds, `picked` the chip kinds, and
 *  `baseline` adds a "(none)" value to a tags axis. */
export interface SweepAxisDraft {
  key: string;
  text: string;
  picked: string[];
  baseline?: boolean;
}

/** The form's values, which new drafts start around. */
export interface SweepDefaults {
  scale: number;
  cfgRescale: number;
  steps: number;
  sampler: NovelAISampler;
  /** 0 means "random", same as the form's seed field. */
  seed: number;
}

export const NO_AXIS: SweepAxisDraft = { key: 'none', text: '', picked: [] };

const fmt = (n: number) => String(Math.round(n * 10) / 10);
// CFG Rescale moves in steps of 0.02.
const fmt2 = (n: number) => String(Math.round(n * 100) / 100);

const isNumericKind = (key: string): key is NumericAxisKind => key in NUMERIC_LIMITS;

export function draftFor(key: string, d: SweepDefaults, randomEntries: LibraryTidbit[]): SweepAxisDraft {
  if (key === 'cfg') {
    const vals = [d.scale - 1, d.scale, d.scale + 1].filter((v) => v >= 0 && v <= 10);
    return { key, text: vals.map(fmt).join(', '), picked: [] };
  }
  if (key === 'cfgRescale') {
    // Off, a moderate and a strong rescale, plus the current value.
    const vals = [...new Set([0, 0.3, 0.6, Number(fmt2(d.cfgRescale))])].sort((a, b) => a - b);
    return { key, text: vals.map(fmt2).join(', '), picked: [] };
  }
  if (key === 'steps') {
    return { key, text: [...new Set([Math.max(1, d.steps - 8), d.steps])].join(', '), picked: [] };
  }
  if (key === 'seed') {
    return { key, text: Array.from({ length: 4 }, randomSeed).join(', '), picked: [] };
  }
  if (key === 'tags') return { key, text: '', picked: [], baseline: true };
  if (key === 'sampler') {
    const others = SAMPLERS.map((s) => s.value).filter((v) => v !== d.sampler);
    return { key, text: '', picked: [d.sampler, ...others.slice(0, 2)] };
  }
  if (key.startsWith('wildcard:')) {
    const entry = randomEntries.find((e) => `wildcard:${e.id}` === key);
    return { key, text: '', picked: entry ? randomOptions(entry) : [] };
  }
  return NO_AXIS;
}

/** One axis draft from a file, or null if it isn't one. Untrusted input:
 *  anything that isn't the right shape is dropped rather than trusted. */
export function parseAxisDraft(v: unknown): SweepAxisDraft | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.key !== 'string' || typeof o.text !== 'string') return null;
  const picked = Array.isArray(o.picked) ? o.picked.filter((p): p is string => typeof p === 'string') : [];
  return { key: o.key, text: o.text, picked, ...(typeof o.baseline === 'boolean' ? { baseline: o.baseline } : {}) };
}

/** Turns a draft into an axis, or explains why it can't be used yet. */
export function toAxis(draft: SweepAxisDraft): { axis?: SweepAxis; problem?: string } {
  if (draft.key === 'none') return {};
  if (isNumericKind(draft.key)) {
    const { values, invalid } = parseNumberList(draft.text, NUMERIC_LIMITS[draft.key]);
    const { min, max } = NUMERIC_LIMITS[draft.key];
    if (invalid.length) return { problem: `Not valid (${min}–${max}): ${invalid.join(', ')}` };
    if (!values.length) return { problem: 'Enter at least one value' };
    return { axis: { kind: draft.key, values } };
  }
  if (draft.key === 'tags') {
    const tags = parseTagList(draft.text);
    if (!tags.length) return { problem: 'Enter at least one tag' };
    return { axis: { kind: 'tags', values: draft.baseline ? ['', ...tags] : tags } };
  }
  if (!draft.picked.length) return { problem: 'Pick at least one' };
  if (draft.key === 'sampler') return { axis: { kind: 'sampler', values: draft.picked } };
  return { axis: { kind: 'wildcard', entryId: draft.key.slice('wildcard:'.length), values: draft.picked } };
}
