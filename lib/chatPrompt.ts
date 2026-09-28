import type { CardData, LorebookEntry } from '@/types/card';
import type { LlmMessage, ProviderKind } from '@/types/llm';
import type { ChatMessage } from '@/types/project';
import { expandMacros, type MacroContext } from '@/lib/macros';
import { scanLorebook, describeEntry, type ScanResult, type ActivatedEntry } from '@/lib/lorebookScan';
import { uuid } from '@/lib/uuid';

// Builds the prompt a test chat sends, the way a SillyTavern-style frontend
// builds it from a card, so testing here tells you how the card will play
// there. Each part is labelled so the prompt inspector can show what came
// from where. With a SillyTavern preset active, lib/presetPrompt.ts builds
// it instead, from the preset's prompt manager; the helpers here are shared.

export interface ChatPromptSettings {
  userName: string;
  /** The user's persona, sent as "{{user}}'s persona". */
  persona: string;
  /** The default main prompt; a card's own system_prompt replaces it
   *  (and can include it back with {{original}}). */
  mainPrompt: string;
  /** Sent after the chat, where the card's post-history instructions go;
   *  a card's own PHI replaces it (with {{original}} for this). */
  defaultPostHistory: string;
  useCardSystemPrompt: boolean;
  useCardPostHistory: boolean;
  includeExamples: boolean;
  useLorebook: boolean;
  /** The active persona (see store/personaStore.ts); null uses userName
   *  and persona above. */
  personaId: string | null;
  /** A SillyTavern preset to build the prompt from instead, or null. */
  presetId: string | null;
  /** Use the preset's samplers (temperature and so on) over the connection's. */
  presetSamplers: boolean;
  /** Number the messages as SillyTavern does: #0 is the greeting. */
  showMessageIds: boolean;
  /** How the chat shows avatars, as SillyTavern's choice does. */
  avatarShape: AvatarShape;
  /** On a touch screen, swiping the last reply (or the greeting) sideways
   *  changes its version, as SillyTavern's phone layout does. */
  swipeGesture: boolean;
}

export type AvatarShape = 'circle' | 'square' | 'rectangle' | 'none';

export const DEFAULT_CHAT_SETTINGS: ChatPromptSettings = {
  userName: 'User',
  persona: '',
  mainPrompt:
    "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}. Stay in character, write in the style of the greeting, and never speak or act for {{user}}.",
  defaultPostHistory: '',
  useCardSystemPrompt: true,
  useCardPostHistory: true,
  includeExamples: true,
  useLorebook: true,
  personaId: null,
  presetId: null,
  presetSamplers: true,
  showMessageIds: true,
  avatarShape: 'circle',
  swipeGesture: true,
};

export const DEFAULT_IMPERSONATION =
  "[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as {{char}} or system. Don't describe actions of {{char}}.]";

export interface PromptPart {
  label: string;
  role: LlmMessage['role'];
  content: string;
}

export interface BuildOptions {
  /** A reply (default), a continuation of the last reply, or the user's turn. */
  mode?: 'reply' | 'continue' | 'impersonate';
  /** The last reply's text, in continue mode. */
  continueText?: string;
  /** The user sent nothing (a preset's send_if_empty applies). */
  emptySend?: boolean;
  model?: string;
  kind?: ProviderKind;
  /** The reply's max tokens, for fitting a preset's context size. */
  maxTokens?: number;
  now?: Date;
  random?: () => number;
}

export interface BuiltPrompt {
  parts: PromptPart[];
  messages: LlmMessage[];
  lore: ScanResult;
  /** Text sent as the start of the reply (continuing, or a preset's
   *  prefill); the model writes on from it. */
  prefill?: string;
  /** Oldest chat messages left out to fit the context size. */
  droppedHistory: number;
}

/** A message's current text. */
export const messageText = (m: ChatMessage) => m.swipes[m.swipe] ?? '';

/** The example dialogue split at each <START>. */
export function exampleBlocks(mesExample: string): string[] {
  return mesExample
    .split(/<START>/i)
    .map((b) => b.trim())
    .filter(Boolean);
}

// ─── Shared pieces ───────────────────────────────────────────────────────────

/** Macro expansion for one prompt build: names, card fields, the chat so
 *  far, and one variable store shared by every part. */
export function macroExpander(card: CardData, history: ChatMessage[], settings: Pick<ChatPromptSettings, 'userName' | 'persona'>, opts: BuildOptions = {}) {
  const char = card.nickname || card.name || 'Character';
  const user = settings.userName || 'User';
  const texts = history.map(messageText);
  const lastOf = (role: ChatMessage['role']) => {
    for (let i = history.length - 1; i >= 0; i--) if (history[i].role === role) return texts[i];
    return '';
  };
  const base: MacroContext = {
    char,
    user,
    model: opts.model,
    vars: new Map(),
    now: opts.now,
    random: opts.random,
    chat: { last: texts[texts.length - 1] ?? '', lastUser: lastOf('user'), lastChar: lastOf('assistant') },
  };
  // Fields are expanded once themselves, so {{description}} inside a
  // preset prompt reads "Ann is…" rather than "{{char}} is…".
  const plain = (t: string) => expandMacros(t ?? '', base).trim();
  base.fields = {
    description: plain(card.description),
    personality: plain(card.personality),
    scenario: plain(card.scenario),
    persona: plain(settings.persona),
    mesExamples: plain(card.mes_example),
  };
  const x = (text: string, original?: string) => expandMacros(text ?? '', { ...base, original }).trim();
  /** Adds what's only known later in the build: the lorebook entries that
   *  fired, for {{wiBefore}} / {{wiAfter}} and {{#if wiBefore}}. */
  const setFields = (patch: NonNullable<MacroContext['fields']>) => {
    base.fields = { ...base.fields, ...patch };
  };
  return { x, char, user, texts, setFields };
}

export type LorePlace = 'before' | 'after' | 'depth';

/** Where an entry goes: SillyTavern keeps its own position (0 before, 1
 *  after, 4 at a depth, others near those) in the entry's extensions; the
 *  card spec only has before_char / after_char. */
export function lorePlace(e: LorebookEntry): LorePlace {
  const st = (e.extensions as { position?: unknown })?.position;
  if (typeof st === 'number') {
    if (st === 4) return 'depth';
    if (st === 1 || st === 3 || st === 6) return 'after';
    return 'before';
  }
  return e.position === 'after_char' ? 'after' : 'before';
}

export interface DepthInjection {
  label: string;
  role: LlmMessage['role'];
  content: string;
  /** Messages from the end of the chat: 0 goes after the last one. */
  depth: number;
  order: number;
}

const ROLE_BY_NUMBER: LlmMessage['role'][] = ['system', 'user', 'assistant'];

/** The card's own at-depth note (SillyTavern's "Character's Note", in
 *  extensions.depth_prompt) and lorebook entries placed at a depth. */
export function cardDepthInjections(card: CardData, lore: ActivatedEntry[], x: (t: string) => string): DepthInjection[] {
  const out: DepthInjection[] = [];
  const note = (card.extensions as { depth_prompt?: { prompt?: string; depth?: number; role?: string } }).depth_prompt;
  if (note?.prompt?.trim()) {
    const role = note.role === 'user' || note.role === 'assistant' ? note.role : 'system';
    out.push({ label: "Character's note", role, content: x(note.prompt), depth: typeof note.depth === 'number' ? note.depth : 4, order: 100 });
  }
  for (const a of lore) {
    if (lorePlace(a.entry) !== 'depth') continue;
    const ext = a.entry.extensions as { depth?: number; role?: number };
    out.push({ label: `Lorebook: ${describeEntry(a)}`, role: ROLE_BY_NUMBER[ext.role ?? 0] ?? 'system', content: x(a.entry.content), depth: typeof ext.depth === 'number' ? ext.depth : 4, order: a.entry.insertion_order ?? 100 });
  }
  return out;
}

/** The chat as prompt parts, with at-depth injections in their places. */
export function historyParts(history: ChatMessage[], injections: DepthInjection[], x: (t: string) => string, names: { char: string; user: string; inContent?: boolean }): PromptPart[] {
  const msgs: PromptPart[] = [];
  history.forEach((m, i) => {
    let content = x(messageText(m));
    if (!content) return;
    if (names.inContent && m.role !== 'system') content = `${m.role === 'user' ? names.user : names.char}: ${content}`;
    msgs.push({ label: i === 0 && m.role === 'assistant' && m.id === 'greeting' ? 'Greeting' : m.role === 'user' ? names.user : m.role === 'assistant' ? names.char : 'System', role: m.role, content });
  });
  if (!injections.length) return msgs;
  const out: PromptPart[] = [];
  const sorted = [...injections].filter((i) => i.content.trim()).sort((a, b) => a.order - b.order);
  for (let i = 0; i <= msgs.length; i++) {
    for (const inj of sorted) {
      if (Math.max(0, msgs.length - Math.max(0, inj.depth)) === i) out.push({ label: `${inj.label} (depth ${inj.depth})`, role: inj.role, content: inj.content });
    }
    if (i < msgs.length) out.push(msgs[i]);
  }
  return out;
}

export const toMessages = (parts: PromptPart[]): LlmMessage[] => parts.map(({ role, content }) => ({ role, content }));

// ─── The built-in prompt (no preset) ─────────────────────────────────────────

export function buildChatPrompt(card: CardData, history: ChatMessage[], settings: ChatPromptSettings, opts: BuildOptions = {}): BuiltPrompt {
  const mode = opts.mode ?? 'reply';
  // Continuing: the reply being continued is the prefill, not history.
  const chat = mode === 'continue' ? history.slice(0, -1) : history;
  const { x, char, user, texts, setFields } = macroExpander(card, chat, settings, opts);

  const parts: PromptPart[] = [];
  const sys = (label: string, content: string) => {
    if (content.trim()) parts.push({ label, role: 'system', content });
  };

  // The lorebook first, so the main prompt's {{#if wiBefore}} knows what fired.
  const lore = settings.useLorebook ? scanLorebook(card.character_book, texts) : { active: [], dropped: [] };
  const loreAt = (place: LorePlace) => lore.active.filter((a) => lorePlace(a.entry) === place).map((a) => ({ name: describeEntry(a), content: x(a.entry.content) }));
  setFields({ wiBefore: loreAt('before').map((e) => e.content).filter(Boolean).join('\n'), wiAfter: loreAt('after').map((e) => e.content).filter(Boolean).join('\n') });

  const main = x(settings.mainPrompt);
  const cardSystem = settings.useCardSystemPrompt && card.system_prompt.trim();
  sys(cardSystem ? 'System prompt (card)' : 'Main prompt', cardSystem ? x(card.system_prompt, main) : main);

  for (const e of loreAt('before')) sys(`Lorebook: ${e.name}`, e.content);

  sys('Description', x(card.description));
  if (card.personality.trim()) sys('Personality', `${char}'s personality: ${x(card.personality)}`);
  if (card.scenario.trim()) sys('Scenario', `Scenario: ${x(card.scenario)}`);
  for (const e of loreAt('after')) sys(`Lorebook: ${e.name}`, e.content);
  if (settings.persona.trim()) sys('Persona', `${user}'s persona: ${x(settings.persona)}`);

  if (settings.includeExamples) {
    const blocks = exampleBlocks(card.mes_example).map((b) => x(b));
    if (blocks.length) {
      sys('Example dialogue', `Examples of how ${char} writes:\n\n${blocks.map((b) => `<example>\n${b}\n</example>`).join('\n\n')}`);
    }
  }

  parts.push(...historyParts(chat, cardDepthInjections(card, lore.active, x), x, { char, user }));

  const phiDefault = x(settings.defaultPostHistory);
  const cardPhi = settings.useCardPostHistory && card.post_history_instructions.trim();
  sys(cardPhi ? 'Post-history instructions (card)' : 'Post-history instructions', cardPhi ? x(card.post_history_instructions, phiDefault) : phiDefault);
  if (mode === 'impersonate') sys('Impersonation prompt', x(DEFAULT_IMPERSONATION));

  return {
    parts,
    messages: toMessages(parts),
    lore,
    prefill: mode === 'continue' ? opts.continueText : undefined,
    droppedHistory: 0,
  };
}

/** A greeting's text for opening a chat: 0 is first_mes, 1+ the alternates. */
export function greetingText(card: CardData, index: number): string {
  if (index < 0) return '';
  return index === 0 ? card.first_mes : card.alternate_greetings[index - 1] ?? '';
}

export function newMessage(role: ChatMessage['role'], text: string, model?: string): ChatMessage {
  return { id: uuid(), role, swipes: [text], swipe: 0, createdAt: Date.now(), model };
}

/** Expanded for display, as the model will see it. */
export function displayText(card: CardData, text: string, userName: string): string {
  return expandMacros(text, { char: card.nickname || card.name || 'Character', user: userName || 'User' });
}
