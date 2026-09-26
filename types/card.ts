// Character Card V3 (https://github.com/kwaroran/character-card-spec-v3),
// the format every card is kept in. V2 is the same shape minus the V3-only
// fields, and is written alongside V3 on export so V2-only frontends (Chub)
// still read it. Unknown fields are kept: a card imported from elsewhere
// round-trips with whatever extensions its frontend put there.

export type LorebookPosition = 'before_char' | 'after_char';

export interface LorebookEntry {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  /** V3 addition. */
  use_regex: boolean;
  constant?: boolean;
  /** Chub shows `name`, SillyTavern shows `comment`; UCCB keeps them in step. */
  name?: string;
  comment?: string;
  priority?: number;
  id?: number | string;
  selective?: boolean;
  secondary_keys?: string[];
  position?: LorebookPosition | '';
  [key: string]: unknown;
}

export interface Lorebook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: LorebookEntry[];
  [key: string]: unknown;
}

export interface CardAsset {
  type: string;
  uri: string;
  name: string;
  ext: string;
}

export interface CardData {
  name: string;
  description: string;
  tags: string[];
  creator: string;
  character_version: string;
  mes_example: string;
  extensions: Record<string, unknown>;
  system_prompt: string;
  post_history_instructions: string;
  first_mes: string;
  alternate_greetings: string[];
  personality: string;
  scenario: string;
  creator_notes: string;
  character_book?: Lorebook;
  // V3 additions
  assets?: CardAsset[];
  nickname?: string;
  creator_notes_multilingual?: Record<string, string>;
  source?: string[];
  group_only_greetings: string[];
  creation_date?: number;
  modification_date?: number;
  [key: string]: unknown;
}

export interface CharacterCard {
  spec: 'chara_card_v3';
  spec_version: string;
  data: CardData;
}

/** The text fields of a card that hold prose, in the order the editor
 *  shows them. Macros and find/replace work over these. */
export type CardTextField =
  | 'description'
  | 'personality'
  | 'scenario'
  | 'first_mes'
  | 'mes_example'
  | 'system_prompt'
  | 'post_history_instructions'
  | 'creator_notes';
