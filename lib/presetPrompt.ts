import type { CardData } from '@/types/card';
import type { LlmMessage } from '@/types/llm';
import type { ChatMessage } from '@/types/project';
import type { ChatPreset, PresetPrompt } from '@/lib/stPreset';
import { scanLorebook, describeEntry } from '@/lib/lorebookScan';
import {
  cardDepthInjections,
  guideText,
  exampleBlocks,
  historyParts,
  lorePlace,
  macroExpander,
  toMessages,
  type BuildOptions,
  type BuiltPrompt,
  type ChatPromptSettings,
  type DepthInjection,
  type PromptPart,
} from '@/lib/chatPrompt';

// A prompt built the way SillyTavern's prompt manager builds one from a
// chat-completion preset: its prompts in its order (only the enabled ones),
// markers filled in from the card, the card's system prompt and post-history
// instructions replacing Main and Post-History Instructions unless the
// preset forbids it, in-chat prompts injected at their depths, the history
// trimmed to the context size, and continue / impersonate / send-if-empty
// done the preset's way.

/** Rough token count for fitting the context: a little over the usual 4
 *  characters a token, to err on the side of fitting. */
const estimate = (text: string) => Math.ceil(text.length / 3.5) + 4;

function fillFormat(format: string, value: string, placeholder: string, x: (t: string) => string) {
  if (!value.trim()) return '';
  // ST formats use {0} (world info) or the macro itself ({{personality}}).
  return x(format.replace('{0}', value).replace(placeholder, value));
}

export function buildPresetPrompt(card: CardData, history: ChatMessage[], settings: ChatPromptSettings, preset: ChatPreset, opts: BuildOptions = {}): BuiltPrompt {
  const mode = opts.mode ?? 'reply';
  const continuing = mode === 'continue';
  // Continuing with a prefill: the reply being continued isn't history.
  const prefillContinue = continuing && preset.continuePrefill;
  let chat = prefillContinue ? history.slice(0, -1) : history;
  const { x, char, user, texts, setFields } = macroExpander(card, chat, settings, opts);

  const lore = settings.useLorebook ? scanLorebook(card.character_book, texts) : { active: [], dropped: [] };
  const loreText = (place: 'before' | 'after') =>
    lore.active
      .filter((a) => lorePlace(a.entry) === place)
      .map((a) => x(a.entry.content))
      .filter(Boolean)
      .join('\n');
  // For {{wiBefore}} / {{wiAfter}} and {{#if wiBefore}} in the preset.
  setFields({ wiBefore: loreText('before'), wiAfter: loreText('after') });

  // Chat-positioned prompts, the card's note and at-depth lore all go into
  // the history at their depths.
  const prompts = new Map(preset.prompts.map((p) => [p.identifier, p]));
  const enabled = preset.order.filter((o) => o.enabled).map((o) => prompts.get(o.identifier)).filter((p): p is PresetPrompt => !!p);
  const injections: DepthInjection[] = [
    ...enabled
      .filter((p) => !p.marker && p.injectionPosition === 1)
      .map((p) => ({ label: p.name, role: p.role, content: x(p.content), depth: p.injectionDepth, order: p.injectionOrder })),
    ...cardDepthInjections(card, lore.active, x),
  ];

  // Send if empty: the user's turn when they sent nothing.
  if (mode === 'reply' && opts.emptySend && preset.sendIfEmpty.trim() && chat[chat.length - 1]?.role !== 'user') {
    chat = [...chat, { id: 'send-if-empty', role: 'user', swipes: [preset.sendIfEmpty], swipe: 0, createdAt: Date.now() }];
  }
  const names = { char, user, inContent: preset.namesBehavior === 2 };

  // Everything but the history, in order, with a slot where it goes.
  const before: PromptPart[] = [];
  const after: PromptPart[] = [];
  let historyAt: PromptPart[] | null = null;
  const push = (part: PromptPart) => {
    if (part.content.trim()) (historyAt ? after : before).push(part);
  };

  for (const p of enabled) {
    if (!p.marker && p.injectionPosition === 1) continue;
    if (p.marker) {
      switch (p.identifier) {
        case 'charDescription':
          push({ label: p.name, role: p.role, content: x(card.description) });
          break;
        case 'charPersonality':
          push({ label: p.name, role: p.role, content: fillFormat(preset.formats.personality, x(card.personality), '{{personality}}', x) });
          break;
        case 'scenario':
          push({ label: p.name, role: p.role, content: fillFormat(preset.formats.scenario, x(card.scenario), '{{scenario}}', x) });
          break;
        case 'personaDescription':
          push({ label: p.name, role: p.role, content: x(settings.persona) });
          break;
        case 'worldInfoBefore':
        case 'worldInfoAfter': {
          const text = loreText(p.identifier === 'worldInfoBefore' ? 'before' : 'after');
          if (text) push({ label: `${p.name}: ${lore.active.filter((a) => lorePlace(a.entry) === (p.identifier === 'worldInfoBefore' ? 'before' : 'after')).map(describeEntry).join(', ')}`, role: p.role, content: fillFormat(preset.formats.wi, text, '{{wi}}', x) });
          break;
        }
        case 'dialogueExamples':
          if (settings.includeExamples) {
            for (const block of exampleBlocks(card.mes_example)) {
              push({ label: 'Example chat', role: 'system', content: x(preset.newExampleChatPrompt) });
              push({ label: p.name, role: 'system', content: x(block) });
            }
          }
          break;
        case 'chatHistory':
          if (preset.newChatPrompt.trim()) before.push({ label: 'New chat prompt', role: 'system', content: x(preset.newChatPrompt) });
          historyAt = [];
          break;
        default:
          break;
      }
      continue;
    }
    let content = p.content;
    let label = p.name;
    if (p.identifier === 'main' && settings.useCardSystemPrompt && card.system_prompt.trim() && !p.forbidOverrides) {
      content = x(card.system_prompt, x(p.content));
      label = `${p.name} (card's system prompt)`;
    } else if (p.identifier === 'jailbreak' && settings.useCardPostHistory && card.post_history_instructions.trim() && !p.forbidOverrides) {
      content = x(card.post_history_instructions, x(p.content));
      label = `${p.name} (card's post-history instructions)`;
    } else content = x(content);
    push({ label, role: p.role, content });
  }

  // Continue / impersonate go last, after the post-history instructions.
  if (continuing && !prefillContinue) after.push({ label: 'Continue nudge', role: 'system', content: x(preset.continueNudgePrompt) });
  if (mode === 'impersonate') after.push({ label: 'Impersonation prompt', role: 'system', content: x(preset.impersonationPrompt) });
  // 🧭 A guide goes last of all, nearest the reply.
  if (opts.guide?.trim()) after.push({ label: 'Guide (🧭)', role: 'system', content: x(guideText(settings.guideTemplate, opts.guide)) });

  // Fit the history into the context size, dropping the oldest first.
  let chatParts = historyAt ? historyParts(chat, injections, x, names) : [];
  let droppedHistory = 0;
  if (historyAt && preset.maxContext && preset.maxContext > 0) {
    const fixed = [...before, ...after].reduce((n, p) => n + estimate(p.content), 0) + (opts.maxTokens ?? preset.samplers.max_tokens ?? 0);
    const budget = preset.maxContext - fixed;
    let kept = chat;
    while (kept.length > 1 && historyParts(kept, injections, x, names).reduce((n, p) => n + estimate(p.content), 0) > budget) kept = kept.slice(1);
    droppedHistory = chat.length - kept.length;
    if (droppedHistory) chatParts = historyParts(kept, injections, x, names);
  }

  const parts = [...before, ...chatParts, ...after];
  let messages: LlmMessage[] = toMessages(parts);
  if (preset.squashSystemMessages) messages = squash(messages);

  // Continuing by prefill: the reply so far (plus the preset's postfix).
  // A plain reply: the preset's assistant prefill, which SillyTavern only
  // sends to Claude.
  let prefill: string | undefined;
  if (prefillContinue) prefill = (opts.continueText ?? '') + preset.continuePostfix;
  else if (mode === 'reply' && opts.kind === 'anthropic' && preset.assistantPrefill.trim()) prefill = x(preset.assistantPrefill);

  return { parts, messages, lore, prefill, droppedHistory };
}

/** Runs of system messages merged into one, as SillyTavern's "Squash
 *  system messages" does. */
export function squash(messages: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (m.role === 'system' && last?.role === 'system') last.content += `\n${m.content}`;
    else out.push({ ...m });
  }
  return out;
}
