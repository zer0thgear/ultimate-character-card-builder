import type { CharacterCard } from '@/types/card';
import type { BasePrompt, CharacterPromptEntry, NovelAIModel, NovelAIParameters, PromptTidbit } from '@/types/novelai';

// A card project: the card being written plus everything UCCB keeps
// alongside it that doesn't belong in the exported card: the art prompts
// it's drawn with, the gens kept for it, and notes. Saved on disk under
// data/projects/<id>/ (see lib/server/storage.ts).

/** The prompt side of the image generator, kept per card so switching
 *  cards switches what's drawn. Model, size, sampler and the rest stay
 *  global (store/settingsStore.ts). */
export interface ProjectGen {
  basePrompts: BasePrompt[];
  characters: CharacterPromptEntry[];
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
  createdAt: number;
  updatedAt: number;
}

/** What the project list shows, without loading every card. */
export interface ProjectSummary {
  id: string;
  name: string;
  tags: string[];
  avatar?: AvatarInfo;
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
  /** The model or connection that wrote an assistant message, for comparing. */
  model?: string;
  /** Reasoning the model returned alongside its reply, per swipe. */
  reasoning?: (string | undefined)[];
}

export interface ChatSession {
  id: string;
  name: string;
  /** Which greeting opened it: 0 is first_mes, 1+ are alternate greetings,
   *  -1 for none. */
  greeting: number;
  messages: ChatMessage[];
  /** A persona locked to this chat, used instead of the active one. */
  personaId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Who you are in test chats: {{user}}'s name, description and picture. */
export interface Persona {
  id: string;
  name: string;
  description: string;
  avatar?: AvatarInfo;
}

export type ChatSummary = Pick<ChatSession, 'id' | 'name' | 'createdAt' | 'updatedAt'> & { messageCount: number };

// ─── Server config ───────────────────────────────────────────────────────────

export interface AppConfig {
  /** Where "Save to folder" writes gens. Empty until set. */
  outputDir: string;
  /** Save every gen to outputDir as it arrives. */
  autoSaveGens: boolean;
  /** Put saved gens in a subfolder named after the card. */
  outputPerCard: boolean;
  /** Folders the gen library browses (GenBrowser's library/, downloads…). */
  libraryFolders: string[];
  /** Let devices on the home network in, not only this computer and
   *  Tailscale devices (see server.mjs). */
  allowLan: boolean;
  /** Days recent gens (the Gallery's session gens) stay on the server
   *  before they're cleaned up; 0 keeps them until cleared. */
  recentGensDays: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  outputDir: '',
  autoSaveGens: false,
  outputPerCard: true,
  libraryFolders: [],
  allowLan: false,
  recentGensDays: 7,
};
