import type { LlmMessage } from '@/types/llm';
import type { ChatMessage, ChatSessionSummary } from '@/types/project';
import { estimateTokens, messageText, type SummaryInjection } from '@/lib/chatPrompt';

// A chat's running summary, the way SillyTavern's Summarize extension keeps
// one: the model is asked (with the chat's own prompt, and the summary so
// far in it) to sum the story up, and the summary goes back into every
// prompt after that, by default right after the main prompt.

export type SummaryPosition = SummaryInjection['position'] | 'none';

export interface SummarySettings {
  /** Words the summary should keep to; 0 for no target. */
  targetWords: number;
  /** Summarize on its own once this many messages are new since the last
   *  summary (0: never). */
  everyMessages: number;
  /** …or once the new messages come to this many tokens (0: never). */
  everyTokens: number;
  /** What the model is asked; {{words}} is the target, and a sentence with
   *  it is left out when there's no target. */
  prompt: string;
  /** How the summary is sent, with {{summary}} where it goes. */
  template: string;
  position: SummaryPosition;
  /** Messages from the end, when it goes in the chat. */
  depth: number;
  role: LlmMessage['role'];
}

/** SillyTavern's Summarize defaults. */
export const DEFAULT_SUMMARY_SETTINGS: SummarySettings = {
  targetWords: 200,
  everyMessages: 10,
  everyTokens: 0,
  prompt:
    'Ignore previous instructions. Summarize the most important facts and events in the story so far. If a summary already exists in your memory, use that as a base and expand with new facts. Limit the summary to {{words}} words or less. Your response should include nothing but the summary.',
  template: '[Summary: {{summary}}]',
  position: 'after',
  depth: 2,
  role: 'system',
};

export const summarySettings = (s?: Partial<SummarySettings>): SummarySettings => ({ ...DEFAULT_SUMMARY_SETTINGS, ...s });

/** What the model is asked, with the target filled in (or left out). */
export function summaryInstruction(s: SummarySettings): string {
  const prompt = s.prompt.trim() || DEFAULT_SUMMARY_SETTINGS.prompt;
  if (s.targetWords > 0) return prompt.split('{{words}}').join(String(s.targetWords));
  return prompt
    .replace(/[^.!?\n]*\{\{words\}\}[^.!?\n]*[.!?]?/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/** The summary as it goes into the prompt, or nothing. */
export function summaryInjection(summary: ChatSessionSummary | undefined, s: SummarySettings): SummaryInjection | undefined {
  if (!summary?.text.trim() || s.position === 'none') return undefined;
  const template = s.template.includes('{{summary}}') ? s.template : DEFAULT_SUMMARY_SETTINGS.template;
  return { content: template.split('{{summary}}').join(summary.text.trim()), position: s.position, depth: Math.max(0, s.depth), role: s.role };
}

/** The messages after the last one the summary covers (all of them if it
 *  covers none, or that message is gone). */
export function newSinceSummary(messages: ChatMessage[], summary: ChatSessionSummary | undefined): ChatMessage[] {
  const at = summary?.through ? messages.findIndex((m) => m.id === summary.through) : -1;
  return messages.slice(at + 1);
}

/** Whether enough is new since the last summary to write another. */
export function summaryDue(messages: ChatMessage[], summary: ChatSessionSummary | undefined, s: SummarySettings): boolean {
  const fresh = newSinceSummary(messages, summary).filter((m) => messageText(m).trim());
  if (!fresh.length) return false;
  if (s.everyMessages > 0 && fresh.length >= s.everyMessages) return true;
  return s.everyTokens > 0 && fresh.reduce((n, m) => n + estimateTokens(messageText(m)), 0) >= s.everyTokens;
}
