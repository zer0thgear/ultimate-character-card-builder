// SillyTavern chat-completion presets (the JSON "Export preset" writes from
// the AI Response Configuration panel): their prompt manager (prompts, their
// order and on/off state), the format strings, and the samplers. Parsed into
// a ChatPreset that lib/presetPrompt.ts builds a prompt from.

import { uuid } from '@/lib/uuid';

export type PromptRole = 'system' | 'user' | 'assistant';

/** The prompt manager's placeholders, filled in from the card and chat. */
export const MARKERS = [
  'chatHistory',
  'dialogueExamples',
  'worldInfoBefore',
  'worldInfoAfter',
  'charDescription',
  'charPersonality',
  'scenario',
  'personaDescription',
] as const;
export type Marker = (typeof MARKERS)[number];

export interface PresetPrompt {
  identifier: string;
  name: string;
  role: PromptRole;
  content: string;
  /** A placeholder (see MARKERS) rather than text of its own. */
  marker: boolean;
  /** 0: where it sits in the order; 1: in the chat, `depth` messages from the end. */
  injectionPosition: 0 | 1;
  injectionDepth: number;
  injectionOrder: number;
  /** A card's system prompt / post-history instructions can't replace it. */
  forbidOverrides: boolean;
  /** ST's built-in prompts (main, nsfw, jailbreak, enhanceDefinitions). */
  systemPrompt: boolean;
}

export interface PresetOrderItem {
  identifier: string;
  enabled: boolean;
}

export interface PresetSamplers {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  top_a?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  max_tokens?: number;
  seed?: number;
  reasoning_effort?: string;
}

export interface ChatPreset {
  id: string;
  name: string;
  prompts: PresetPrompt[];
  /** The prompt manager's order, with each prompt's on/off state. */
  order: PresetOrderItem[];
  samplers: PresetSamplers;
  /** Context size: history past this (minus the reply) is left out. */
  maxContext?: number;
  formats: {
    wi: string;
    scenario: string;
    personality: string;
  };
  newChatPrompt: string;
  newExampleChatPrompt: string;
  continueNudgePrompt: string;
  impersonationPrompt: string;
  /** Sent as the user's turn when you send nothing. */
  sendIfEmpty: string;
  /** Claude only in SillyTavern: the start of the reply, written for the model. */
  assistantPrefill: string;
  /** Continue by prefilling the reply (instead of the nudge prompt). */
  continuePrefill: boolean;
  continuePostfix: string;
  squashSystemMessages: boolean;
  /** SillyTavern's character_names_behavior: -1 none, 0 default, 1 completion, 2 in content. */
  namesBehavior: number;
  importedAt: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const numOr = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The names ST gives its markers and built-ins, for prompts that come
 *  without one. */
const DEFAULT_NAMES: Record<string, string> = {
  main: 'Main Prompt',
  nsfw: 'Auxiliary Prompt',
  jailbreak: 'Post-History Instructions',
  enhanceDefinitions: 'Enhance Definitions',
  chatHistory: 'Chat History',
  dialogueExamples: 'Chat Examples',
  worldInfoBefore: 'World Info (before)',
  worldInfoAfter: 'World Info (after)',
  charDescription: 'Char Description',
  charPersonality: 'Char Personality',
  scenario: 'Scenario',
  personaDescription: 'Persona Description',
};

/** ST's own default order, used when a preset has none. */
const DEFAULT_ORDER = ['main', 'worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'enhanceDefinitions', 'nsfw', 'worldInfoAfter', 'dialogueExamples', 'chatHistory', 'jailbreak'];

function parsePrompt(raw: unknown): PresetPrompt | null {
  if (!isObject(raw)) return null;
  const identifier = str(raw.identifier);
  if (!identifier) return null;
  const marker = raw.marker === true || (MARKERS as readonly string[]).includes(identifier);
  const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : 'system';
  return {
    identifier,
    name: str(raw.name) || DEFAULT_NAMES[identifier] || identifier,
    role,
    content: str(raw.content),
    marker,
    injectionPosition: raw.injection_position === 1 ? 1 : 0,
    injectionDepth: numOr(raw.injection_depth) ?? 4,
    injectionOrder: numOr(raw.injection_order) ?? 100,
    forbidOverrides: raw.forbid_overrides === true,
    systemPrompt: raw.system_prompt === true,
  };
}

/** The order ST actually uses: the "global" prompt list (character_id
 *  100001), else the default one (100000), else whichever there is. */
function pickOrder(raw: unknown, prompts: PresetPrompt[]): PresetOrderItem[] {
  if (Array.isArray(raw) && raw.length) {
    const lists = raw.filter(isObject);
    const chosen = lists.find((l) => l.character_id === 100001) ?? lists.find((l) => l.character_id === 100000) ?? lists[0];
    const order = Array.isArray(chosen?.order) ? chosen.order : [];
    const items = order
      .filter(isObject)
      .map((o) => ({ identifier: str(o.identifier), enabled: o.enabled !== false }))
      .filter((o) => o.identifier && prompts.some((p) => p.identifier === o.identifier));
    if (items.length) return items;
  }
  const known = DEFAULT_ORDER.filter((id) => prompts.some((p) => p.identifier === id));
  const rest = prompts.filter((p) => !known.includes(p.identifier)).map((p) => p.identifier);
  return [...known, ...rest].map((identifier) => ({ identifier, enabled: true }));
}

export class PresetImportError extends Error {}

/** Reads a SillyTavern chat-completion preset. */
export function parseStPreset(json: unknown, fileName = 'Preset'): ChatPreset {
  if (!isObject(json)) throw new PresetImportError("That file isn't a SillyTavern preset.");
  if (!Array.isArray(json.prompts) && !Array.isArray(json.prompt_order)) {
    if ('instruct' in json || 'input_sequence' in json || 'story_string' in json) {
      throw new PresetImportError("That looks like a text-completion (instruct/context) preset. Only chat-completion presets can be imported so far.");
    }
    throw new PresetImportError("That file has no prompts, so it isn't a chat-completion preset.");
  }
  const prompts = (Array.isArray(json.prompts) ? json.prompts : []).map(parsePrompt).filter((p): p is PresetPrompt => !!p);
  // Markers a preset leaves out of `prompts` still work if its order names them.
  for (const m of MARKERS) {
    if (!prompts.some((p) => p.identifier === m)) {
      prompts.push({ identifier: m, name: DEFAULT_NAMES[m], role: 'system', content: '', marker: true, injectionPosition: 0, injectionDepth: 4, injectionOrder: 100, forbidOverrides: false, systemPrompt: true });
    }
  }
  const s = json;
  return {
    id: uuid(),
    name: str(s.name) || fileName.replace(/\.json$/i, ''),
    prompts,
    order: pickOrder(s.prompt_order, prompts),
    samplers: {
      temperature: numOr(s.temperature),
      top_p: numOr(s.top_p),
      top_k: numOr(s.top_k) || undefined,
      top_a: numOr(s.top_a) || undefined,
      min_p: numOr(s.min_p) || undefined,
      frequency_penalty: numOr(s.frequency_penalty),
      presence_penalty: numOr(s.presence_penalty),
      repetition_penalty: numOr(s.repetition_penalty) && numOr(s.repetition_penalty) !== 1 ? numOr(s.repetition_penalty) : undefined,
      max_tokens: numOr(s.openai_max_tokens),
      seed: numOr(s.seed) !== undefined && numOr(s.seed)! >= 0 ? numOr(s.seed) : undefined,
      reasoning_effort: typeof s.reasoning_effort === 'string' ? s.reasoning_effort : undefined,
    },
    maxContext: numOr(s.openai_max_context),
    formats: {
      wi: str(s.wi_format, '{0}'),
      scenario: str(s.scenario_format, '{{scenario}}'),
      personality: str(s.personality_format, '{{personality}}'),
    },
    newChatPrompt: str(s.new_chat_prompt, '[Start a new Chat]'),
    newExampleChatPrompt: str(s.new_example_chat_prompt, '[Example Chat]'),
    continueNudgePrompt: str(s.continue_nudge_prompt, '[Continue the following message. Do not include ANY parts of the original message. Use capitalization and punctuation as if your reply is a part of the original message: {{lastChatMessage}}]'),
    impersonationPrompt: str(s.impersonation_prompt, "[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as {{char}} or system. Don't describe actions of {{char}}.]"),
    sendIfEmpty: str(s.send_if_empty),
    assistantPrefill: str(s.assistant_prefill),
    continuePrefill: s.continue_prefill === true,
    continuePostfix: str(s.continue_postfix, ' '),
    squashSystemMessages: s.squash_system_messages === true,
    namesBehavior: typeof s.names_behavior === 'number' ? s.names_behavior : typeof s.character_names_behavior === 'number' ? s.character_names_behavior : 0,
    importedAt: Date.now(),
  };
}

export const promptById = (preset: ChatPreset, id: string) => preset.prompts.find((p) => p.identifier === id);

/**
 * The preset's samplers as a connection's params. Only what each provider
 * takes: Claude gets the reply length and effort (current Claude models
 * refuse temperature and friends); OpenAI-compatible servers and NovelAI
 * get the rest as set in the preset.
 */
export function presetParams(preset: ChatPreset, kind: 'novelai' | 'openai' | 'anthropic'): Partial<import('@/types/llm').SamplerParams> {
  const s = preset.samplers;
  const out: Record<string, unknown> = {};
  if (s.max_tokens) out.max_tokens = s.max_tokens;
  if (kind === 'anthropic') {
    const effort = ({ min: 'low', low: 'low', medium: 'medium', high: 'high', max: 'max' } as Record<string, string>)[s.reasoning_effort ?? ''];
    if (effort) out.effort = effort;
    return out;
  }
  for (const k of ['temperature', 'top_p', 'top_k', 'top_a', 'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'seed'] as const) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  return out;
}
