import type { CardData } from '@/types/card';
import type { LlmMessage } from '@/types/llm';
import type { ChatMessage } from '@/types/project';
import { expandMacros } from '@/lib/macros';
import { scanLorebook, describeEntry, type ScanResult } from '@/lib/lorebookScan';

// Builds the prompt a test chat sends, the way a SillyTavern-style frontend
// builds it from a card, so testing here tells you how the card will play
// there. Each part is labelled so the prompt inspector can show what came
// from where.

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
}

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
};

export interface PromptPart {
  label: string;
  role: LlmMessage['role'];
  content: string;
}

export interface BuiltPrompt {
  parts: PromptPart[];
  messages: LlmMessage[];
  lore: ScanResult;
}

/** A message's current text. */
export const messageText = (m: ChatMessage) => m.swipes[m.swipe] ?? '';

/** The example dialogue split at each <START>, macros expanded. */
export function exampleBlocks(mesExample: string): string[] {
  return mesExample
    .split(/<START>/i)
    .map((b) => b.trim())
    .filter(Boolean);
}

export function buildChatPrompt(
  card: CardData,
  history: ChatMessage[],
  settings: ChatPromptSettings,
  opts: { now?: Date; random?: () => number } = {},
): BuiltPrompt {
  const char = card.nickname || card.name || 'Character';
  const user = settings.userName || 'User';
  const x = (text: string, original?: string) => expandMacros(text ?? '', { char, user, original, ...opts }).trim();

  const parts: PromptPart[] = [];
  const sys = (label: string, content: string) => {
    if (content.trim()) parts.push({ label, role: 'system', content });
  };

  const main = x(settings.mainPrompt);
  sys(
    settings.useCardSystemPrompt && card.system_prompt.trim() ? 'System prompt (card)' : 'Main prompt',
    settings.useCardSystemPrompt && card.system_prompt.trim() ? x(card.system_prompt, main) : main,
  );

  const texts = history.map(messageText);
  const lore = settings.useLorebook ? scanLorebook(card.character_book, texts) : { active: [], dropped: [] };
  const loreAt = (position: 'before_char' | 'after_char') =>
    lore.active
      .filter((a) => (a.entry.position === 'after_char' ? 'after_char' : 'before_char') === position)
      .map((a) => ({ name: describeEntry(a), content: x(a.entry.content) }));
  for (const e of loreAt('before_char')) sys(`Lorebook: ${e.name}`, e.content);

  sys('Description', x(card.description));
  if (card.personality.trim()) sys('Personality', `${char}'s personality: ${x(card.personality)}`);
  if (card.scenario.trim()) sys('Scenario', `Scenario: ${x(card.scenario)}`);
  for (const e of loreAt('after_char')) sys(`Lorebook: ${e.name}`, e.content);
  if (settings.persona.trim()) sys('Persona', `${user}'s persona: ${x(settings.persona)}`);

  if (settings.includeExamples) {
    const blocks = exampleBlocks(card.mes_example).map((b) => x(b));
    if (blocks.length) {
      sys('Example dialogue', `Examples of how ${char} writes:\n\n${blocks.map((b) => `<example>\n${b}\n</example>`).join('\n\n')}`);
    }
  }

  history.forEach((m, i) => {
    const content = x(messageText(m));
    if (!content) return;
    parts.push({ label: i === 0 && m.role === 'assistant' ? 'Greeting' : m.role === 'user' ? user : m.role === 'assistant' ? char : 'System', role: m.role, content });
  });

  const phiDefault = x(settings.defaultPostHistory);
  const phi = settings.useCardPostHistory && card.post_history_instructions.trim() ? x(card.post_history_instructions, phiDefault) : phiDefault;
  sys(settings.useCardPostHistory && card.post_history_instructions.trim() ? 'Post-history instructions (card)' : 'Post-history instructions', phi);

  return { parts, messages: parts.map(({ role, content }) => ({ role, content })), lore };
}

/** A greeting's text for opening a chat: 0 is first_mes, 1+ the alternates. */
export function greetingText(card: CardData, index: number): string {
  if (index < 0) return '';
  return index === 0 ? card.first_mes : card.alternate_greetings[index - 1] ?? '';
}

export function newMessage(role: ChatMessage['role'], text: string, model?: string): ChatMessage {
  return { id: crypto.randomUUID(), role, swipes: [text], swipe: 0, createdAt: Date.now(), model };
}

/** Expanded for display, as the model will see it. */
export function displayText(card: CardData, text: string, userName: string): string {
  return expandMacros(text, { char: card.nickname || card.name || 'Character', user: userName || 'User' });
}
