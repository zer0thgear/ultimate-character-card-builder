import type { CharacterPromptEntry } from '@/types/novelai';
import { cleanTags, takeDatasetTags } from '@/lib/assist';
import { uuid } from '@/lib/uuid';
import { joinPromptParts } from '@/lib/promptText';

// The prompt writers' replies for V4+ models, which take a prompt per
// character: the main prompt (SCENE) and one per character (CHARACTER),
// with optional positions (POSITION) on NovelAI's 5×5 grid. Read, then
// merged into the form's character slots by name.

export interface CastMember {
  name: string;
  tags: string;
  /** Grid centre, when the writer placed them. */
  center?: { x: number; y: number };
}

export interface Cast {
  /** The main prompt; undefined when the reply had no SCENE line. */
  scene?: string;
  characters: CastMember[];
  /** Dataset tags found anywhere in it (see takeDatasetTags). */
  nsfw: boolean;
  fur: boolean;
}

/** NovelAI's grid: columns A–E left to right, rows 1–5 top to bottom. */
const GRID = [0.1, 0.3, 0.5, 0.7, 0.9];
export const cellCenter = (col: string, row: string) => ({ x: GRID['ABCDE'.indexOf(col.toUpperCase())], y: GRID[Number(row) - 1] });

const LINE = /^\s*(?:[-*]\s*)?(SCENE|CHARACTER|POSITION)\b\s*([^:\n]*?)\s*:\s*(.*)$/i;

/**
 * Reads a writer's reply. Lines that aren't SCENE / CHARACTER / POSITION
 * continue the one before (a model that wraps its tags). A reply with none
 * of them is all scene, as the one-prompt writer's replies are.
 */
export function parseCast(reply: string): Cast {
  const text = reply.replace(/```[a-z]*|```/g, '');
  let scene: string | undefined;
  const members: CastMember[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  let current: { kind: 'scene' } | { kind: 'char'; index: number } | null = null;
  let sawMarker = false;
  for (const raw of text.split('\n')) {
    const m = raw.match(LINE);
    if (m) {
      sawMarker = true;
      const kind = m[1].toUpperCase();
      const name = m[2].trim().replace(/^["'<]|["'>]$/g, '');
      const rest = m[3].trim();
      if (kind === 'SCENE') {
        scene = rest;
        current = { kind: 'scene' };
      } else if (kind === 'CHARACTER') {
        members.push({ name: name || `Character ${members.length + 1}`, tags: rest });
        current = { kind: 'char', index: members.length - 1 };
      } else {
        const cell = rest.match(/\b([A-E])\s*([1-5])\b/i);
        if (cell) positions.set(name.toLowerCase(), cellCenter(cell[1], cell[2]));
        current = null;
      }
    } else if (raw.trim() && current) {
      if (current.kind === 'scene') scene = joinPromptParts(scene, raw);
      else members[current.index].tags = joinPromptParts(members[current.index].tags, raw);
    }
  }
  if (!sawMarker) scene = text;

  let nsfw = false;
  let fur = false;
  const take = (tags: string) => {
    // No doubled commas, whatever the model sent.
    const t = takeDatasetTags(cleanTags(tags).replace(/\s*,(?:\s*,)+\s*/g, ', '));
    nsfw ||= t.nsfw;
    fur ||= t.fur;
    return t.tags;
  };
  return {
    scene: scene === undefined ? undefined : take(scene),
    characters: members
      .map((c) => ({ name: c.name, tags: take(c.tags), center: positions.get(c.name.toLowerCase()) }))
      .filter((c) => c.tags),
    nsfw,
    fur,
  };
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();
const firstWord = (s: string | undefined) => norm(s).split(/\s+/)[0] ?? '';
/** A slot's label nobody chose (a new slot, or the card's own name). */
const placeholderLabel = (label: string | undefined, cardName: string) => !label || /^character( \d+)?$/i.test(label.trim()) || norm(label) === norm(cardName);

export interface MergeResult {
  characters: CharacterPromptEntry[];
  updated: string[];
  added: string[];
  /** Slots switched off because they aren't in the scene. */
  setAside: string[];
  /** Characters left out for want of slots. */
  dropped: string[];
}

/**
 * Puts a cast into the character slots: a slot whose label matches a
 * character's name (or first name) gets its prompt, new characters get new
 * slots, and with `scene` set, slots for characters who aren't in it are
 * switched off (kept, not deleted). One character and at most one slot
 * pair up whatever the label. Positions are only set when given.
 */
export function mergeCast(
  existing: CharacterPromptEntry[],
  cast: CastMember[],
  opts: { scene: boolean; max: number; cardName?: string },
): MergeResult {
  const live = existing.filter((c) => !c.archived);
  const used = new Set<string>();
  const out = existing.map((c) => ({ ...c }));
  const result: MergeResult = { characters: out, updated: [], added: [], setAside: [], dropped: [] };

  const find = (name: string) =>
    out.find((c) => !c.archived && !used.has(c.id) && norm(c.label) === norm(name)) ??
    out.find((c) => !c.archived && !used.has(c.id) && firstWord(c.label) && firstWord(c.label) === firstWord(name));

  for (const member of cast) {
    let slot = find(member.name);
    // A lone character and a lone slot are the same one, whatever it's called.
    if (!slot && cast.length === 1 && live.length === 1 && !used.has(live[0].id)) slot = out.find((c) => c.id === live[0].id);
    // A slot nobody named (a new one, or one named after the card, from
    // before it had a prompt per character) goes to the next newcomer, rather
    // than staying beside them. Not if it's someone else's by name.
    if (!slot) slot = out.find((c) => !c.archived && !used.has(c.id) && placeholderLabel(c.label, opts.cardName ?? '') && !cast.some((m) => m !== member && (norm(m.name) === norm(c.label) || firstWord(m.name) === firstWord(c.label))));
    if (slot) {
      used.add(slot.id);
      slot.prompt = member.tags;
      slot.enabled = true;
      if (member.center) slot.center = member.center;
      if (placeholderLabel(slot.label, opts.cardName ?? '')) slot.label = member.name;
      result.updated.push(member.name);
      continue;
    }
    const enabledNow = out.filter((c) => c.enabled && !c.archived).length;
    if (enabledNow >= opts.max) {
      result.dropped.push(member.name);
      continue;
    }
    const entry: CharacterPromptEntry = { id: uuid(), label: member.name, prompt: member.tags, uc: '', center: member.center ?? { x: 0.5, y: 0.5 }, enabled: true };
    out.push(entry);
    used.add(entry.id);
    result.added.push(member.name);
  }

  if (opts.scene) {
    for (const c of out) {
      if (!c.archived && c.enabled && !used.has(c.id)) {
        c.enabled = false;
        result.setAside.push(c.label || 'a character');
      }
    }
  }
  return result;
}
