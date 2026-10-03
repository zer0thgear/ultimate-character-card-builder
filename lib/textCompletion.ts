import type { CardData } from '@/types/card';
import type { LlmMessage } from '@/types/llm';
import type { ChatMessage } from '@/types/project';
import { scanLorebook, describeEntry } from '@/lib/lorebookScan';
import {
  DEFAULT_IMPERSONATION,
  authorsNoteParts,
  cardDepthInjections,
  exampleBlocks,
  guideText,
  historyParts,
  loreDefaults,
  lorePlace,
  macroExpander,
  replyPoints,
  summaryDepthInjections,
  summaryPart,
  toMessages,
  type BuildOptions,
  type BuiltPrompt,
  type ChatPromptSettings,
  type PromptPart,
} from '@/lib/chatPrompt';
import { uuid } from '@/lib/uuid';

// Text completion, as SillyTavern does it for local models (KoboldCpp,
// llama.cpp, text-generation-webui, vLLM…): the prompt is one string, laid
// out by an instruct template (the turn markers a model was trained on,
// like ChatML's <|im_start|>) and a context template (the story string:
// how the card, persona and lorebook sit at the top). Both import from
// SillyTavern's Advanced Formatting exports.

export type NamesBehavior = 'none' | 'force' | 'always';

export interface InstructTemplate {
  id: string;
  name: string;
  input_sequence: string;
  input_suffix: string;
  output_sequence: string;
  output_suffix: string;
  system_sequence: string;
  system_suffix: string;
  /** Before the first reply / the reply being written, in place of output_sequence. */
  first_output_sequence: string;
  last_output_sequence: string;
  /** Around the story string. */
  story_string_prefix: string;
  story_string_suffix: string;
  stop_sequence: string;
  /** Each sequence on its own line, around the text. */
  wrap: boolean;
  /** Fill macros in the sequences. */
  macro: boolean;
  names_behavior: NamesBehavior;
  /** System messages are sent as the user's. */
  system_same_as_user: boolean;
  /** Each sequence is also a stop string. */
  sequences_as_stop_strings: boolean;
  /** Anything else SillyTavern wrote, kept for export. */
  extra?: Record<string, unknown>;
}

export interface ContextTemplate {
  id: string;
  name: string;
  story_string: string;
  example_separator: string;
  chat_start: string;
  /** The separators are also stop strings. */
  use_stop_strings: boolean;
  /** "\n{{user}}:" stops the reply. */
  names_as_stop_strings: boolean;
  extra?: Record<string, unknown>;
}

/** SillyTavern's Default story string. */
export const DEFAULT_STORY_STRING =
  "{{#if system}}{{system}}\n{{/if}}{{#if wiBefore}}{{wiBefore}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}{{#if personality}}{{char}}'s personality: {{personality}}\n{{/if}}{{#if scenario}}Scenario: {{scenario}}\n{{/if}}{{#if wiAfter}}{{wiAfter}}\n{{/if}}{{#if persona}}{{persona}}\n{{/if}}{{trim}}";

const instruct = (name: string, t: Partial<InstructTemplate>): InstructTemplate => ({
  id: `builtin-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name,
  input_sequence: '',
  input_suffix: '',
  output_sequence: '',
  output_suffix: '',
  system_sequence: '',
  system_suffix: '',
  first_output_sequence: '',
  last_output_sequence: '',
  story_string_prefix: '',
  story_string_suffix: '',
  stop_sequence: '',
  wrap: false,
  macro: true,
  names_behavior: 'force',
  system_same_as_user: false,
  sequences_as_stop_strings: true,
  ...t,
});

/** A few of SillyTavern's built-in instruct templates, as it ships them. */
export const BUILTIN_INSTRUCT: InstructTemplate[] = [
  instruct('ChatML', {
    input_sequence: '<|im_start|>user',
    output_sequence: '<|im_start|>assistant',
    system_sequence: '<|im_start|>system',
    input_suffix: '<|im_end|>\n',
    output_suffix: '<|im_end|>\n',
    system_suffix: '<|im_end|>\n',
    story_string_prefix: '<|im_start|>system\n',
    story_string_suffix: '<|im_end|>\n',
    stop_sequence: '<|im_end|>',
    wrap: true,
  }),
  instruct('Llama 3 Instruct', {
    input_sequence: '<|start_header_id|>user<|end_header_id|>\n\n',
    output_sequence: '<|start_header_id|>assistant<|end_header_id|>\n\n',
    system_sequence: '<|start_header_id|>system<|end_header_id|>\n\n',
    input_suffix: '<|eot_id|>',
    output_suffix: '<|eot_id|>',
    system_suffix: '<|eot_id|>',
    story_string_prefix: '<|start_header_id|>system<|end_header_id|>\n\n',
    story_string_suffix: '<|eot_id|>',
    stop_sequence: '<|eot_id|>',
  }),
  instruct('Mistral V7', {
    input_sequence: '[INST] ',
    input_suffix: '[/INST]',
    output_sequence: ' ',
    output_suffix: '</s>',
    system_sequence: '[SYSTEM_PROMPT] ',
    system_suffix: '[/SYSTEM_PROMPT]',
    story_string_prefix: '[SYSTEM_PROMPT] ',
    story_string_suffix: '[/SYSTEM_PROMPT]',
    stop_sequence: '</s>',
  }),
  instruct('Gemma 2', {
    input_sequence: '<start_of_turn>user',
    output_sequence: '<start_of_turn>model',
    input_suffix: '<end_of_turn>\n',
    output_suffix: '<end_of_turn>\n',
    system_same_as_user: true,
    story_string_prefix: '<start_of_turn>user\n',
    story_string_suffix: '<end_of_turn>\n',
    stop_sequence: '<end_of_turn>',
    wrap: true,
  }),
  instruct('Alpaca', {
    input_sequence: '### Instruction:',
    output_sequence: '### Response:',
    input_suffix: '\n\n',
    output_suffix: '\n\n',
    system_suffix: '\n\n',
    wrap: true,
  }),
];

export const BUILTIN_CONTEXT: ContextTemplate[] = [
  { id: 'builtin-default', name: 'Default', story_string: DEFAULT_STORY_STRING, example_separator: '***', chat_start: '***', use_stop_strings: false, names_as_stop_strings: true },
  {
    id: 'builtin-minimalist',
    name: 'Minimalist',
    story_string: "{{#if system}}{{system}}\n{{/if}}{{#if wiBefore}}{{wiBefore}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}{{#if personality}}{{personality}}\n{{/if}}{{#if scenario}}{{scenario}}\n{{/if}}{{#if wiAfter}}{{wiAfter}}\n{{/if}}{{#if persona}}{{persona}}\n{{/if}}{{trim}}",
    example_separator: '',
    chat_start: '',
    use_stop_strings: false,
    names_as_stop_strings: true,
  },
];

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const INSTRUCT_KEYS = [
  'name', 'input_sequence', 'input_suffix', 'output_sequence', 'output_suffix', 'system_sequence', 'system_suffix', 'first_output_sequence', 'last_output_sequence', 'story_string_prefix', 'story_string_suffix',
  'stop_sequence', 'wrap', 'macro', 'names_behavior', 'system_same_as_user', 'sequences_as_stop_strings', 'names', 'names_force_groups',
];
const CONTEXT_KEYS = ['name', 'story_string', 'example_separator', 'chat_start', 'use_stop_strings', 'names_as_stop_strings'];

const rest = (raw: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(raw).filter(([k]) => !keys.includes(k)));

/** An instruct template from SillyTavern's export, or null if it isn't one. */
export function parseInstruct(raw: unknown): InstructTemplate | null {
  if (!isObject(raw) || (typeof raw.input_sequence !== 'string' && typeof raw.output_sequence !== 'string')) return null;
  // Older exports have names: true/false instead of names_behavior.
  const names: NamesBehavior = raw.names_behavior === 'none' || raw.names_behavior === 'always' || raw.names_behavior === 'force' ? raw.names_behavior : raw.names === true ? 'always' : 'force';
  return {
    id: uuid(),
    name: str(raw.name, 'Imported'),
    input_sequence: str(raw.input_sequence),
    input_suffix: str(raw.input_suffix),
    output_sequence: str(raw.output_sequence),
    output_suffix: str(raw.output_suffix, str(raw.separator_sequence)),
    system_sequence: str(raw.system_sequence),
    system_suffix: str(raw.system_suffix),
    first_output_sequence: str(raw.first_output_sequence),
    last_output_sequence: str(raw.last_output_sequence),
    story_string_prefix: str(raw.story_string_prefix, str(raw.system_sequence_prefix)),
    story_string_suffix: str(raw.story_string_suffix, str(raw.system_sequence_suffix)),
    stop_sequence: str(raw.stop_sequence),
    wrap: raw.wrap !== false,
    macro: raw.macro !== false,
    names_behavior: names,
    system_same_as_user: raw.system_same_as_user === true,
    sequences_as_stop_strings: raw.sequences_as_stop_strings !== false,
    extra: rest(raw, [...INSTRUCT_KEYS, 'separator_sequence', 'system_sequence_prefix', 'system_sequence_suffix']),
  };
}

/** A context template from SillyTavern's export, or null if it isn't one. */
export function parseContext(raw: unknown): ContextTemplate | null {
  if (!isObject(raw) || typeof raw.story_string !== 'string') return null;
  return {
    id: uuid(),
    name: str(raw.name, 'Imported'),
    story_string: raw.story_string,
    example_separator: str(raw.example_separator),
    chat_start: str(raw.chat_start),
    use_stop_strings: raw.use_stop_strings === true,
    names_as_stop_strings: raw.names_as_stop_strings !== false,
    extra: rest(raw, CONTEXT_KEYS),
  };
}

/**
 * What's in a SillyTavern file: an instruct template, a context template,
 * or both (its "master" export holds { instruct, context, … }).
 */
export function parseTemplateFile(json: unknown): { instruct?: InstructTemplate; context?: ContextTemplate } {
  if (isObject(json) && (isObject(json.instruct) || isObject(json.context))) {
    return { instruct: parseInstruct(json.instruct) ?? undefined, context: parseContext(json.context) ?? undefined };
  }
  return { instruct: parseInstruct(json) ?? undefined, context: parseContext(json) ?? undefined };
}

/** The template as SillyTavern exports it. */
export const exportInstruct = (t: InstructTemplate) => {
  const { id: _id, extra, ...fields } = t;
  void _id;
  return { ...extra, ...fields };
};
export const exportContext = (t: ContextTemplate) => {
  const { id: _id, extra, ...fields } = t;
  void _id;
  return { ...extra, ...fields };
};

// ─── Laying out the prompt ───────────────────────────────────────────────────

type Role = LlmMessage['role'];

interface Layout {
  t: InstructTemplate;
  /** Fills macros in the sequences, when the template says to. */
  m: (s: string) => string;
  char: string;
  user: string;
}

const join = (t: InstructTemplate, parts: string[]) => parts.filter((p) => p !== '').join(t.wrap ? '\n' : '');

/** One message in the template's turn markers. */
function turn(l: Layout, role: Role, text: string, opts: { first?: boolean; names?: boolean } = {}): string {
  const { t, m } = l;
  const asUser = role === 'user' || (role === 'system' && t.system_same_as_user);
  const prefix = m(asUser ? t.input_sequence : role === 'system' ? t.system_sequence : opts.first && t.first_output_sequence ? t.first_output_sequence : t.output_sequence);
  const suffix = m(asUser ? t.input_suffix : role === 'system' ? t.system_suffix : t.output_suffix);
  const named = opts.names && role !== 'system' ? `${role === 'user' ? l.user : l.char}: ${text}` : text;
  return join(t, [prefix, named]) + (t.wrap && suffix && !suffix.startsWith('\n') ? '\n' : '') + suffix;
}

/** Where the model starts writing: the reply's turn marker (and name). */
function replyStart(l: Layout, role: Role, names: boolean): string {
  const { t, m } = l;
  const prefix = role === 'user' ? m(t.input_sequence) : m(t.last_output_sequence || t.output_sequence);
  const name = names ? `${role === 'user' ? l.user : l.char}:` : '';
  return join(t, [prefix, name]) + (t.wrap && (prefix || name) ? '\n' : '');
}

/** The strings that end the reply. */
export function stopStrings(t: InstructTemplate, c: ContextTemplate | null, l: Pick<Layout, 'm' | 'user' | 'char'>): string[] {
  const out = new Set<string>();
  if (t.stop_sequence) out.add(l.m(t.stop_sequence));
  if (t.sequences_as_stop_strings) for (const s of [t.input_sequence, t.system_sequence, t.output_sequence]) if (s.trim()) out.add(l.m(s).trim() || l.m(s));
  if (c?.use_stop_strings) for (const s of [c.example_separator, c.chat_start]) if (s.trim()) out.add(`\n${s}`);
  if (c?.names_as_stop_strings !== false) out.add(`\n${l.user}:`);
  return [...out].filter(Boolean);
}

/**
 * Plain chat messages (the writing assistant's) as one text prompt: each in
 * the template's turn markers, and the reply's marker last (or the reply
 * so far, with `prefill`).
 */
export function messagesToText(messages: LlmMessage[], t: InstructTemplate, opts: { prefill?: boolean; char?: string; user?: string } = {}): { prompt: string; stop: string[] } {
  const l: Layout = { t, m: (s) => s, char: opts.char ?? 'Assistant', user: opts.user ?? 'User' };
  const list = opts.prefill ? messages.slice(0, -1) : messages;
  const body = list.map((msg) => turn(l, msg.role, msg.content)).join('');
  const tail = opts.prefill ? replyStart(l, 'assistant', false) + (messages[messages.length - 1]?.content ?? '') : replyStart(l, 'assistant', false);
  return { prompt: body + tail, stop: stopStrings(t, null, { ...l, user: l.user }) };
}

/**
 * The test chat's prompt as text, the way SillyTavern builds a text
 * completion: the story string (card, persona, lorebook) from the context
 * template in the instruct template's story markers, the example dialogue,
 * the chat start, the chat (author's note, character's note, summary and
 * at-depth lore in their places), then the post-history instructions and
 * the reply's turn marker. Fits the context size as the chat prompt does.
 */
export function buildTextPrompt(card: CardData, history: ChatMessage[], settings: ChatPromptSettings, t: InstructTemplate, c: ContextTemplate, opts: BuildOptions = {}): BuiltPrompt {
  const mode = opts.mode ?? 'reply';
  const chat = mode === 'continue' ? history.slice(0, -1) : history;
  const { x, lx, rx, char, user, texts, setFields } = macroExpander(card, chat, settings, opts);
  // Sequences keep their own spacing, so only the names are filled in them.
  const names_ = (s: string) => s.replace(/\{\{(char|user)\}\}/gi, (_, n: string) => (n.toLowerCase() === 'char' ? char : user));
  const l: Layout = { t, m: t.macro ? names_ : (s) => s, char, user };
  const names = t.names_behavior === 'always';

  const lore = settings.useLorebook ? scanLorebook(card.character_book, texts, { defaults: loreDefaults(settings), random: opts.random, generatedAt: replyPoints(chat) }) : { active: [], dropped: [] };
  const loreAt = (place: 'before' | 'after') => lore.active.filter((a) => lorePlace(a.entry) === place).map((a) => lx(a.entry.content)).filter(Boolean).join('\n');
  const main = x(settings.mainPrompt);
  const system = settings.useCardSystemPrompt && card.system_prompt.trim() ? x(card.system_prompt, main) : main;
  setFields({ wiBefore: loreAt('before'), wiAfter: loreAt('after'), system });

  const parts: PromptPart[] = [];
  const note = authorsNoteParts(opts.authorsNote, chat, x);
  const story = x(c.story_string);
  const top = [summaryPart(opts.summary, 'before'), note.before].filter((p): p is PromptPart => !!p?.content.trim());
  const below = [summaryPart(opts.summary, 'after'), note.after].filter((p): p is PromptPart => !!p?.content.trim());
  for (const p of top) parts.push(p);
  if (story.trim()) parts.push({ label: 'Story string', role: 'system', content: story });
  for (const p of below) parts.push(p);
  // The lorebook entries are in the story string; listed for the inspector.
  const loreNames = lore.active.filter((a) => lorePlace(a.entry) !== 'depth').map((a) => describeEntry(a));

  const examples = settings.includeExamples && !/\{\{mesExamples(Raw)?\}\}/i.test(c.story_string) ? exampleBlocks(card.mes_example).map((b) => x(b)) : [];
  const phiDefault = x(settings.defaultPostHistory);
  const phi = settings.useCardPostHistory && card.post_history_instructions.trim() ? x(card.post_history_instructions, phiDefault) : phiDefault;

  const injections = [...(note.injection ? [note.injection] : []), ...cardDepthInjections(card, lore.active, x, lx), ...summaryDepthInjections(opts.summary)];
  const toParts = (kept: ChatMessage[]) => historyParts(kept, injections, x, { char, user }, rx);

  const storyText = (ps: PromptPart[]) => ps.map((p) => (p.label === 'Story string' ? l.m(t.story_string_prefix) + p.content + l.m(t.story_string_suffix) : turn(l, 'system', p.content))).join('');
  const exampleText = examples.length ? examples.map((e) => (c.example_separator ? `${x(c.example_separator)}\n` : '') + e + '\n').join('') : '';
  const chatStart = c.chat_start ? `${x(c.chat_start)}\n` : '';
  const tailParts: PromptPart[] = [];
  if (phi.trim()) tailParts.push({ label: 'Post-history instructions', role: 'system', content: phi });
  if (mode === 'impersonate') tailParts.push({ label: 'Impersonation prompt', role: 'system', content: x(DEFAULT_IMPERSONATION) });
  if (opts.guide?.trim()) tailParts.push({ label: 'Guide (🧭)', role: 'system', content: x(guideText(settings.guideTemplate, opts.guide)) });

  const chatText = (ps: PromptPart[]) => {
    let firstReply = true;
    return ps
      .map((p) => {
        const first = p.role === 'assistant' && firstReply;
        if (p.role === 'assistant') firstReply = false;
        // historyParts names nothing itself; the template decides.
        return turn(l, p.role, p.content, { first, names });
      })
      .join('');
  };
  const replyRole: Role = mode === 'impersonate' ? 'user' : 'assistant';
  const ending = mode === 'continue' ? replyStart(l, 'assistant', names) + (opts.continueText ?? '') : replyStart(l, replyRole, names);
  const fixedText = storyText(parts) + exampleText + chatStart + chatText(tailParts) + ending;

  // Fit the context: the oldest messages go first.
  const estimate = (s: string) => Math.ceil(s.length / 3.5);
  let kept = chat;
  if (opts.maxContext && opts.maxContext > 0) {
    const budget = opts.maxContext - estimate(fixedText) - (opts.maxTokens ?? 0);
    while (kept.length > 1 && estimate(chatText(toParts(kept))) > budget) kept = kept.slice(1);
  }
  const history_ = toParts(kept);
  const text = storyText(parts) + exampleText + chatStart + chatText(history_) + chatText(tailParts) + ending;

  const allParts: PromptPart[] = [
    ...parts,
    ...(loreNames.length ? [{ label: `Lorebook (in the story string): ${loreNames.join(', ')}`, role: 'system' as const, content: '' }] : []),
    ...(examples.length ? [{ label: 'Example dialogue', role: 'system' as const, content: exampleText }] : []),
    ...(chatStart ? [{ label: 'Chat start', role: 'system' as const, content: chatStart }] : []),
    ...history_,
    ...tailParts,
  ].filter((p) => p.content.trim() || p.label.startsWith('Lorebook'));
  return {
    parts: allParts,
    messages: toMessages(allParts.filter((p) => p.content.trim())),
    lore,
    prefill: mode === 'continue' ? opts.continueText : undefined,
    droppedHistory: chat.length - kept.length,
    text,
    stop: stopStrings(t, c, l),
  };
}
