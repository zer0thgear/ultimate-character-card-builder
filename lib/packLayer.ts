import type { CustomActor } from '@/types/adventure';

// What the enabled extension packs (lib/extensionPack.ts) add to the app,
// merged into one layer. It sits between the built-in prompts and options
// and your own edits: your edit wins, then the packs, then the built-in.
// The pack store (store/packStore.ts) sets it; the code that builds
// prompts and lists options reads it. Nothing here is ever saved into your
// settings, so turning a pack off or uninstalling it takes it all away.

/** Text a pack put in, and the pack's name (to say where it came from). */
export interface FromPack {
  text: string;
  from: string;
}

export interface LoreSizeOption {
  id: string;
  label: string;
  count: number;
}

export interface LoreLengthOption {
  id: string;
  label: string;
  /** How long an entry should be, as the Writer is told ("about 80 words"). */
  text: string;
}

export type PackActor = Omit<CustomActor, 'id' | 'enabled'> & { from: string };

export interface PackLayer {
  /** Writing-assistant prompts by key (lib/assist.ts ASSIST_TEMPLATES). */
  templates: Record<string, FromPack>;
  /** Adventure mode's actor prompts by key (lib/adventure.ts ADVENTURE_TEMPLATES). */
  adventurePrompts: Record<string, FromPack>;
  /** The lorebook wizard's extra focus chips, entry counts and lengths. */
  loreFocus: string[];
  loreSizes: LoreSizeOption[];
  loreLengths: LoreLengthOption[];
  /** Adventure actors to start from (⚙ Actors). */
  actors: PackActor[];
  /** World rules to start from (🌍 World). */
  ruleExamples: { label: string; text: string; from: string }[];
}

export const emptyLayer = (): PackLayer => ({ templates: {}, adventurePrompts: {}, loreFocus: [], loreSizes: [], loreLengths: [], actors: [], ruleExamples: [] });

let layer: PackLayer = emptyLayer();

export const packLayer = (): PackLayer => layer;

export function setPackLayer(next: PackLayer | undefined) {
  layer = next ?? emptyLayer();
}
