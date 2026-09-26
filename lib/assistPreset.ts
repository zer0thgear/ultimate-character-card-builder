import type { CardData } from '@/types/card';
import type { LlmMessage } from '@/types/llm';
import type { ChatPreset, PresetPrompt } from '@/lib/stPreset';
import { macroExpander } from '@/lib/chatPrompt';
import { squash } from '@/lib/presetPrompt';

// A SillyTavern preset around the writing assistant's requests. The
// assistant already sends the card itself, so the preset's markers (card
// fields, chat history, examples) are skipped; its own prompts are kept:
// those ordered before Chat History go before the assistant's request, the
// rest (post-history instructions, in-chat prompts) after it, as they
// would sit around a chat. Which of them to include is the creator's
// choice, since a roleplay preset's "write {{char}}'s next reply" can
// pull against a writing task.

/** The preset's own prompts (not markers), in order, enabled in the preset. */
export function assistablePrompts(preset: ChatPreset): { prompt: PresetPrompt; before: boolean }[] {
  const byId = new Map(preset.prompts.map((p) => [p.identifier, p]));
  let seenHistory = false;
  const out: { prompt: PresetPrompt; before: boolean }[] = [];
  for (const item of preset.order) {
    if (item.identifier === 'chatHistory') seenHistory = true;
    const p = byId.get(item.identifier);
    if (!item.enabled || !p || p.marker || !p.content.trim()) continue;
    out.push({ prompt: p, before: !seenHistory && p.injectionPosition === 0 });
  }
  return out;
}

export function wrapWithPreset(
  messages: LlmMessage[],
  preset: ChatPreset,
  opts: { card?: CardData; userName: string; persona: string; excluded: string[] },
): LlmMessage[] {
  const card = opts.card;
  const x = card ? macroExpander(card, [], { userName: opts.userName, persona: opts.persona }).x : (t: string) => t.trim();
  const chosen = assistablePrompts(preset).filter(({ prompt }) => !opts.excluded.includes(prompt.identifier));
  const part = (p: PresetPrompt): LlmMessage => ({ role: p.role, content: x(p.content) });
  const before = chosen.filter((c) => c.before).map((c) => part(c.prompt));
  const after = chosen.filter((c) => !c.before).map((c) => part(c.prompt));
  const all = [...before, ...messages, ...after].filter((m) => m.content.trim());
  return preset.squashSystemMessages ? squash(all) : all;
}
