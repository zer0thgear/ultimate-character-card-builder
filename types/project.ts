import type { ChatTally } from '@/lib/chatStats';
import type { ContinueNode } from '@/lib/continueTree';
import type { CharacterCard, Lorebook } from '@/types/card';
import type { AdventureWorld } from '@/types/adventure';
import type { BasePrompt, CharacterPromptEntry, NovelAIModel, NovelAIParameters, PromptTidbit } from '@/types/novelai';

// A card project: the card being written plus everything UCCB keeps
// alongside it that doesn't belong in the exported card: the art prompts
// it's drawn with, the gens kept for it, and notes. Saved on disk under
// data/projects/<id>/ (see lib/server/storage.ts).

/** The prompt side of the image generator, kept per card so switching
 *  cards switches what's drawn. Model, size, sampler and the rest stay
 *  global (store/settingsStore.ts). */
export interface ProjectGen {
  /** Style and artist tags, put in front of every prompt for this card. */
  stylePrompt?: string;
  /** NovelAI's nsfw and fur dataset switches, for this card. */
  nsfwMode?: boolean;
  furMode?: boolean;
  basePrompts: BasePrompt[];
  characters: CharacterPromptEntry[];
  /** From before the negative prompt was shared by every card
   *  (FormSettings.negativePrompt): no longer used, except that the first
   *  card opened since handed its own over. */
  negativePrompt: string;
  negativeTidbits: PromptTidbit[];
}

/** A gen kept with the card: saved in the project folder, unlike the
 *  session history, which lives in memory until it's saved or cleared. */
export interface KeptImage {
  id: string;
  /** File name inside the project's gallery folder. */
  file: string;
  width: number;
  height: number;
  createdAt: number;
  prompt?: string;
  negativePrompt?: string;
  model?: NovelAIModel;
  seed?: number;
  parameters?: Partial<NovelAIParameters>;
  /** A short label, e.g. "happy" for an expression. */
  label?: string;
  /** Hash and byte size of the file it came from (the PNG, or a library
   *  image before conversion): how the same picture isn't kept twice. */
  hash?: string;
  size?: number;
}

export interface AvatarInfo {
  width: number;
  height: number;
  /** Changes whenever the avatar does, to bust the browser's cache. */
  version: number;
}

export interface CardProject {
  id: string;
  card: CharacterCard;
  avatar?: AvatarInfo;
  gen: ProjectGen;
  kept: KeptImage[];
  /** Free-form notes for the creator: ideas, todo, what the art should show. */
  notes: string;
  /** Imported in Chat mode: shown there only, until it's added to Builder. */
  chatOnly?: boolean;
  /** Its world for Adventure mode: settings, dramatis personae and rules
   *  (lib/adventure.ts). Not part of the exported card. */
  adventure?: AdventureWorld;
  /** Keep the card's lorebook and its copy in the Lorebooks bank in step
   *  (lib/lorebookSync); unset follows the chat settings' syncCardLorebooks. */
  lorebookSync?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** What the project list shows, without loading every card. */
export interface ProjectSummary {
  id: string;
  name: string;
  tags: string[];
  avatar?: AvatarInfo;
  /** See CardProject.chatOnly. */
  chatOnly?: boolean;
  /** The card's author, and the start of its creator's notes as plain
   *  text (lib/cardSummary.ts), for the card lists. */
  creator?: string;
  notes?: string;
  /** Its chats: how many, their messages in all, and the last one's time
   *  (for sorting by use); and of those messages, how many were sent and
   *  received, and their tokens (lib/chatStats.ts). */
  chats?: number;
  messages?: number;
  lastChat?: number;
  sent?: number;
  received?: number;
  tokens?: number;
  updatedAt: number;
  createdAt: number;
}

// ─── Test chats ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** Every version generated for this turn; `swipe` is the one shown. */
  swipes: string[];
  swipe: number;
  createdAt: number;
  /** When each version was written (SillyTavern's per-swipe send_date).
   *  Chats from before this have none: createdAt stands in. */
  swipeDates?: (number | undefined)[];
  /** The model or connection that wrote an assistant message, for comparing. */
  model?: string;
  /** Reasoning the model returned alongside its reply, per swipe. */
  reasoning?: (string | undefined)[];
  /** Per swipe, its continues as a tree (lib/continueTree.ts), once it's
   *  been continued; that swipe's text is the tree's chosen path. */
  continues?: (ContinueNode | undefined)[];
  /** Per swipe, how its latest generation went (lib/genStats.ts). */
  gen?: (GenStats | undefined)[];
  /** Left out of the prompt (and the lorebook's scan), but kept in the
   *  chat: SillyTavern's hidden messages (is_system). */
  hidden?: boolean;
}

/** How long a reply took to write: SillyTavern's message timer, with the
 *  wait for its first token as well. */
export interface GenStats {
  /** From sending the request to the last token, in ms. */
  ms: number;
  /** From sending the request to the first token (text or reasoning). */
  ttft?: number;
  /** Tokens written: the provider's count, or an estimate. */
  tokens?: number;
}

/** Where an author's note goes, as SillyTavern's choices: in the chat at a
 *  depth (its default), or just after or before the main prompt. */
export type AuthorsNotePosition = 'chat' | 'after' | 'before';

/** A chat's author's note, with SillyTavern's settings for it. */
export interface AuthorsNote {
  prompt: string;
  position: AuthorsNotePosition;
  /** In the chat: messages from its end (0 goes after the last one). */
  depth: number;
  /** Sent when the user's messages are a multiple of this; 0 never sends it. */
  frequency: number;
  role: 'system' | 'user' | 'assistant';
}

/** A picture drawn in a chat: shown in it, never sent to the model or
 *  counted as a message. */
export interface ChatImage {
  id: string;
  /** The message it follows (its id), or null for right after the greeting. */
  after: string | null;
  /** In the project's chat-images folder. */
  file: string;
  width: number;
  height: number;
  /** What it was drawn from, to draw it again: the scene prompt and the
   *  character prompts. */
  scene: string;
  characters: { label: string; prompt: string; center?: { x: number; y: number } }[];
  createdAt: number;
}

export interface ChatSession {
  id: string;
  name: string;
  /** Which greeting opened it: 0 is first_mes, 1+ are alternate greetings,
   *  -1 for none. */
  greeting: number;
  /** This chat's own wording of a greeting (by its index), in place of the
   *  card's, which is read live otherwise. */
  greetingEdits?: Record<string, string>;
  messages: ChatMessage[];
  /** A persona locked to this chat, used instead of the active one. */
  personaId?: string;
  /** The chat's own lorebook from the Lorebooks bank (SillyTavern's "chat
   *  lorebook": one per chat), scanned alongside the card's. */
  lorebookId?: string;
  /** Pictures drawn in the chat (Chat mode's 🎨), each after a message. */
  images?: ChatImage[];
  /** This chat's author's note (lib/authorsNote.ts), as SillyTavern keeps
   *  one per chat. */
  authorsNote?: AuthorsNote;
  /** The story so far, summed up (see lib/chatSummary.ts). */
  summary?: ChatSessionSummary;
  createdAt: number;
  updatedAt: number;
}

// ─── Stories (Writing mode) ──────────────────────────────────────────────────

/** Someone in a story's Cast: read like a lorebook entry, so
 *  their description goes into the prompt when their name (or another of
 *  their names) is in the recent text, or always. */
export interface StoryPersona {
  id: string;
  name: string;
  /** Other names that bring them in (nicknames, titles). */
  aliases: string[];
  description: string;
  /** In every prompt, mentioned or not. */
  always: boolean;
  enabled: boolean;
  /** Read live from the card's character or from your persona, rather than
   *  a copy (the description here is then unused). */
  link?: 'char' | 'user';
}

/** The latest generation, while it's still the end of the story: where it
 *  starts in the text, and every version of it (for ↻ Retry and ‹ ›). */
export interface StoryTake {
  start: number;
  outputs: string[];
  index: number;
}

/** A story written together with the model: one flat document that you and
 *  the model both add to, as NovelAI's story mode keeps one. Saved in
 *  data/projects/<id>/stories/<id>.json. */
export interface StorySession {
  id: string;
  name: string;
  text: string;
  /** Always at the top of the prompt: the premise, setting, style. */
  memory: string;
  /** Put a few lines from the end of the story, to steer what comes next. */
  authorsNote: string;
  personae: StoryPersona[];
  /** Read the card's lorebook against the story. */
  useLorebook: boolean;
  /** How many paragraphs back names and lorebook keys are looked for. */
  scanDepth: number;
  /** Chat-completion connections: after each continuation, a second call
   *  smooths the seam (repeats, commentary, a broken first sentence). */
  proofread: boolean;
  /** About how many words each continuation aims for (chat completion). */
  words: number;
  /** The connection it's written with (unset: the chat's), and the one
   *  that proofreads (unset: the same). */
  connectionId?: string;
  proofreadConnectionId?: string;
  last?: StoryTake;
  createdAt: number;
  updatedAt: number;
}

export type StorySummary = Pick<StorySession, 'id' | 'name' | 'createdAt' | 'updatedAt'> & { words: number };

// ─── Brainstorm sessions ─────────────────────────────────────────────────────

/** A Brainstorm message: yours (with what you attached to it) or the
 *  assistant's (with the assist-log run that wrote it, while it's kept). */
export interface BrainstormThought {
  role: 'user' | 'assistant' | 'system';
  content: string;
  runId?: string;
  /** References attached (lib/references.ts), kept so later turns see them. */
  refs?: unknown[];
}

/** A saved Brainstorm conversation about a card. */
export interface BrainstormSession {
  id: string;
  name: string;
  messages: BrainstormThought[];
  createdAt: number;
  updatedAt: number;
}

export type BrainstormSummary = Pick<BrainstormSession, 'id' | 'name' | 'createdAt' | 'updatedAt'> & { messageCount: number };

/** Why a version of a card was kept: the start of an editing session, a
 *  change to many fields at once, a restore, or by hand. */
export type VersionReason = 'session' | 'overwrite' | 'macro' | 'assistant' | 'restore' | 'manual';

/** An earlier version of a card, kept in data/projects/<id>/versions. */
export interface CardVersion {
  id: string;
  createdAt: number;
  reason: VersionReason;
  /** A name it was given (named versions are never pruned). */
  label?: string;
  card: CharacterCard;
}

/** A version as listed: without the card, with its name and size. */
export type CardVersionInfo = Omit<CardVersion, 'card'> & { name: string; bytes: number };

/** A deleted card waiting in data/trash. */
export interface TrashedProject {
  /** Its folder in data/trash: "<id>-<when deleted>". */
  entry: string;
  id: string;
  name: string;
  deletedAt: number;
  hasAvatar: boolean;
  chats: number;
}

export interface ChatSessionSummary {
  text: string;
  /** The last message it covers (null: none, only the greeting). */
  through: string | null;
  updatedAt: number;
}

/** Who you are in test chats: {{user}}'s name, description and picture. */
export interface Persona {
  id: string;
  name: string;
  description: string;
  avatar?: AvatarInfo;
  /** A lorebook from the Lorebooks bank that comes along with this persona
   *  in chats (SillyTavern's persona lorebook: one per persona). */
  lorebookId?: string;
}

/** A lorebook in the Lorebooks bank (data/lorebooks/<id>.json), as
 *  SillyTavern keeps its World Info files: standalone, and attachable to
 *  chats, personas, or everything (global). Its name is `book.name`. */
export interface BankLorebook {
  id: string;
  book: Lorebook;
  /** The card it was imported from, if it came out of one. That card's
   *  own chats skip it, since they already have the card's lorebook. */
  fromCard?: { projectId: string; name: string };
  createdAt: number;
  updatedAt: number;
}

export type ChatSummary = Pick<ChatSession, 'id' | 'name' | 'createdAt' | 'updatedAt'> & { messageCount: number } & ChatTally;

// ─── Server config ───────────────────────────────────────────────────────────

export interface AppConfig {
  /** Where "Save to folder" writes gens. Empty until set. */
  outputDir: string;
  /** Save every gen to outputDir as it arrives. */
  autoSaveGens: boolean;
  /** Put saved gens in a subfolder named after the card. */
  outputPerCard: boolean;
  /** Folders the gen library browses (old gens, downloads…). */
  libraryFolders: string[];
  /** Let devices on the home network in, not only this computer and
   *  Tailscale devices (see server.mjs). */
  allowLan: boolean;
  /** Days recent gens (the Gallery's session gens) stay on the server
   *  before they're cleaned up; 0 keeps them until cleared. */
  recentGensDays: number;
  /** Keep earlier versions of each card (lib/server/versions.ts). */
  versionHistory: boolean;
  /** How many a card keeps; past it, the oldest unnamed ones go. */
  versionsToKeep: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  outputDir: '',
  autoSaveGens: false,
  outputPerCard: true,
  libraryFolders: [],
  allowLan: false,
  recentGensDays: 7,
  versionHistory: true,
  versionsToKeep: 20,
};
