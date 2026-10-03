import type { CardData } from '@/types/card';
import { entryName } from '@/lib/cardSpec';

// Addressing any text in a card by a dotted path, e.g. "description",
// "alternate_greetings.2" or "character_book.entries.3.content", so the
// writing assistant, find/replace and focus mode work on any field.

export function getPath(data: CardData, path: string): string {
  let cur: unknown = data;
  for (const part of path.split('.')) {
    if (cur == null) return '';
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : '';
}

/** A copy of the card with the text at `path` replaced (containers along
 *  the way are copied, not mutated). */
export function setPath(data: CardData, path: string, value: string): CardData {
  const parts = path.split('.');
  const write = (node: unknown, i: number): unknown => {
    const key = parts[i];
    if (i === parts.length - 1) {
      if (Array.isArray(node)) {
        const copy = [...node];
        copy[Number(key)] = value;
        return copy;
      }
      return { ...(node as object), [key]: value };
    }
    const child = (node as Record<string, unknown>)?.[key];
    if (Array.isArray(node)) {
      const copy = [...node];
      copy[Number(key)] = write(child, i + 1);
      return copy;
    }
    return { ...(node as object), [key]: write(child, i + 1) };
  };
  return write(data, 0) as CardData;
}

/** SillyTavern's Character's Note: the card's own note sent at a depth in
 *  the chat (extensions.depth_prompt, with its depth and role). */
export const CHARACTER_NOTE_PATH = 'extensions.depth_prompt.prompt';

export type FieldGroup = 'character' | 'greetings' | 'prompts' | 'lorebook' | 'creator';

export interface TextFieldRef {
  path: string;
  label: string;
  group: FieldGroup;
  text: string;
}

const MAIN: [string, string, FieldGroup][] = [
  ['description', 'Description', 'character'],
  ['personality', 'Personality', 'character'],
  ['scenario', 'Scenario', 'character'],
  ['mes_example', 'Example messages', 'character'],
  ['first_mes', 'First message', 'greetings'],
  ['system_prompt', 'System prompt', 'prompts'],
  ['post_history_instructions', 'Post-history instructions', 'prompts'],
  [CHARACTER_NOTE_PATH, "Character's note", 'prompts'],
  ['creator_notes', "Creator's notes", 'creator'],
];

/** Every prose field in the card, in editor order. */
export function listTextFields(data: CardData): TextFieldRef[] {
  const out: TextFieldRef[] = MAIN.map(([key, label, group]) => ({ path: key, label, group, text: getPath(data, key) }));
  const firstGreeting = out.findIndex((f) => f.path === 'first_mes');
  const alts = data.alternate_greetings.map((text, i) => ({ path: `alternate_greetings.${i}`, label: `Alternate greeting #${i + 1}`, group: 'greetings' as const, text }));
  const groups = data.group_only_greetings.map((text, i) => ({ path: `group_only_greetings.${i}`, label: `Group greeting #${i + 1}`, group: 'greetings' as const, text }));
  out.splice(firstGreeting + 1, 0, ...alts, ...groups);
  data.character_book?.entries.forEach((e, i) =>
    out.push({ path: `character_book.entries.${i}.content`, label: `Lorebook: ${entryName(e) || `entry ${i + 1}`}`, group: 'lorebook', text: e.content }),
  );
  return out;
}

export function fieldLabel(data: CardData, path: string): string {
  return listTextFields(data).find((f) => f.path === path)?.label ?? path;
}
