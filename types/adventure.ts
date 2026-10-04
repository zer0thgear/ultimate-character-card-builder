// Adventure mode: a roleplay run like a tabletop game. A Director (the game
// master) plans each turn and briefs a cast of actors who write it: the
// Narrator describes the scene and what came of your action, and each
// character who acts this turn is played by a call of its own. Dice are
// rolled by the app, not the model. See lib/adventure.ts.

/** The model calls an adventure makes, each with its own connection: the
 *  built-in actors, and yours (`custom:<id>`). */
export type ActorId = 'director' | 'narrator' | 'cast' | 'scout' | `custom:${string}`;

/** An actor of your own: a call with your prompt, run each turn or when the
 *  Director briefs it in a field of its plan. */
export interface CustomActor {
  id: string;
  name: string;
  /** An emoji shown on its part of the story. */
  icon: string;
  /** What it is, for the Director. */
  about: string;
  /** Its system prompt (macros work). */
  prompt: string;
  /** What the Director puts in its field of the plan; it runs only on turns
   *  the Director fills it. Empty: no field, and it runs every turn. */
  brief: string;
  /** Before the turn's beats (after any roll), or after them. */
  when: 'before' | 'after';
  /** Its part is left out of what the Narrator and the Cast are sent (the
   *  Director and you still see it). */
  private?: boolean;
  enabled: boolean;
}

export const customActorId = (a: Pick<CustomActor, 'id'>): ActorId => `custom:${a.id}`;

export const ACTORS: { id: ActorId; label: string; icon: string; blurb: string }[] = [
  { id: 'director', label: 'Director', icon: '🎬', blurb: 'Plans each turn: what happens, who acts, whether to roll. Also writes bespoke openings.' },
  { id: 'narrator', label: 'Narrator', icon: '📜', blurb: 'Sets the scene and describes what came of your action.' },
  { id: 'cast', label: 'Cast', icon: '🎭', blurb: 'Plays each Cast member who acts this turn, one call per character.' },
  { id: 'scout', label: 'Scout', icon: '🔍', blurb: "Reads the card and lorebook to list the world's settings, characters and rules." },
];

/** A place, faction, fact, or a character, in a card's world. */
export interface WorldEntry {
  id: string;
  name: string;
  text: string;
}

/** A card's world for adventures, kept with the card (CardProject.adventure):
 *  what the Scout found in its definitions and lorebook, as you've edited it. */
export interface AdventureWorld {
  settings: WorldEntry[];
  /** The Cast: everyone who can appear, the card's character first. */
  personae: WorldEntry[];
  /** Game rules for the Director to keep (creature catching, HP, inventory…). */
  rules: string;
  scannedAt?: number;
}

/** One adventure's changes to its card's world, leaving the card's alone. */
export interface WorldOverrides {
  /** By entry id: a changed (or added) entry, or null for left out here. */
  settings?: Record<string, WorldEntry | null>;
  personae?: Record<string, WorldEntry | null>;
  /** This adventure's rules, in place of the card's. */
  rules?: string;
}

/** Where the scene stands, as the Director last put it. */
export interface SceneState {
  location: string;
  /** Who's there, {{user}} included. */
  present: string[];
  situation: string;
  time?: string;
}

/** What one model call took. Tokens are the provider's count where it gives
 *  one, else an estimate. */
export interface CallUsage {
  actor: ActorId;
  connection: string;
  model: string;
  input: number;
  output: number;
  estimated?: boolean;
  /** What it cost, where the price is known (OpenRouter). */
  dollars?: number;
  /** Its request in this session's log (store/assistLog.ts), for 🔍. */
  runId?: string;
}

export interface DiceRoll {
  /** What's being attempted. */
  reason: string;
  dice: string;
  rolls: number[];
  modifier: number;
  total: number;
  /** The difficulty to meet or beat, if the Director set one. */
  dc?: number;
  outcome?: 'success' | 'failure';
  /** A natural 20 or 1 on a d20. */
  critical?: 'success' | 'failure';
}

/**
 * One part of the story. A turn is your action, the Director's plan (shown
 * folded), a roll if one was called for, the narration and the characters'
 * parts.
 */
export interface AdventureEntry {
  id: string;
  turn: number;
  kind: 'action' | 'note' | 'director' | 'roll' | 'narration' | 'character' | 'cast' | 'extra';
  /** Who: the character's name (character), {{user}}'s (action), or your
   *  actor's (extra). */
  speaker?: string;
  /** Extra entries: your actor's emoji, and whether only the Director sees
   *  it besides you. */
  icon?: string;
  private?: boolean;
  text: string;
  createdAt: number;
  roll?: DiceRoll;
  /** Director entries: the scene before this turn, to put back on a redo. */
  sceneBefore?: SceneState;
  usage?: CallUsage;
}

export interface AdventureSession {
  id: string;
  name: string;
  /** How it began: a card greeting, or an opening the Director wrote. */
  opening: { kind: 'greeting'; greeting: number } | { kind: 'director'; prompt: string; greeting?: number };
  entries: AdventureEntry[];
  scene?: SceneState;
  /** Real dice for uncertain actions. */
  dice: boolean;
  overrides?: WorldOverrides;
  /** A persona locked to this adventure, used instead of the active one. */
  personaId?: string;
  createdAt: number;
  updatedAt: number;
}

export type AdventureSummary = Pick<AdventureSession, 'id' | 'name' | 'createdAt' | 'updatedAt'> & { turns: number };

/** How adventures run (Settings, shared by every card). */
export interface AdventureSettings {
  /** Each actor's connection; unset uses the chat's. */
  connections: Partial<Record<ActorId, string>>;
  /** Your edits to the actors' prompts, by ADVENTURE_TEMPLATES key. */
  prompts?: Record<string, string>;
  /** Actors of your own. */
  customActors?: CustomActor[];
  /** The most characters who act in one turn (each is a call). */
  maxActors: number;
  /** New adventures start with dice on. */
  diceDefault: boolean;
  /** How the story addresses you. */
  pov: 'second' | 'third';
  /** Notes on style for the Narrator and the Cast ("terse, gritty"…). */
  style: string;
  /** How much of the story so far goes in each call, in characters. */
  historyBudget: number;
  /** Newcomers the Director brings in join the adventure's Cast. */
  autoCast?: boolean;
}

export const DEFAULT_ADVENTURE_SETTINGS: AdventureSettings = {
  connections: {},
  maxActors: 2,
  diceDefault: true,
  pov: 'second',
  style: '',
  historyBudget: 24000,
  autoCast: true,
};
