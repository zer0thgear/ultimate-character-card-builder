import type { CardData } from '@/types/card';
import type { LlmMessage } from '@/types/llm';
import { fieldLabel, getPath } from '@/lib/cardPath';
import { entryName } from '@/lib/cardSpec';

// The writing assistant's requests: each builds the messages for one job,
// with the card as context. Replies are meant to be dropped straight into
// a field, so every job asks for the text alone.

export type FieldAction = 'rewrite' | 'expand' | 'shorten' | 'polish' | 'draft' | 'continue';

export const FIELD_ACTIONS: { value: FieldAction; label: string; hint: string }[] = [
  { value: 'rewrite', label: 'Rewrite', hint: 'Rewrite it following your instruction' },
  { value: 'draft', label: 'Draft', hint: 'Write it from scratch (uses what the field has as notes)' },
  { value: 'expand', label: 'Expand', hint: 'Add depth and detail, keeping what is there' },
  { value: 'shorten', label: 'Tighten', hint: 'Cut it down without losing substance' },
  { value: 'polish', label: 'Polish', hint: 'Fix grammar, flow and consistency; keep the meaning' },
  { value: 'continue', label: 'Continue', hint: 'Write more after the end' },
];

const SYSTEM = `You are an expert character card writer helping a creator build a roleplay character card (the SillyTavern / Chub "Tavern card" format). You write vivid, specific, well-structured prose, match the card's established voice and formatting conventions (for example *actions in asterisks* and "quoted speech" if the card uses them), and keep {{char}} and {{user}} macros exactly as written. You never add commentary, headings or quotation marks around your answer unless the field itself calls for them.`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The card as context, skipping the field being worked on. */
export function cardContext(card: CardData, skipPath?: string, budget = 12000): string {
  const parts: string[] = [];
  const add = (path: string, label: string, max: number) => {
    if (path === skipPath) return;
    const text = getPath(card, path).trim();
    if (text) parts.push(`<${label}>\n${clip(text, max)}\n</${label}>`);
  };
  if (card.name) parts.push(`<name>${card.name}</name>`);
  if (card.tags.length) parts.push(`<tags>${card.tags.join(', ')}</tags>`);
  add('description', 'description', budget * 0.4);
  add('personality', 'personality', budget * 0.1);
  add('scenario', 'scenario', budget * 0.1);
  add('first_mes', 'first_message', budget * 0.15);
  add('mes_example', 'example_messages', budget * 0.1);
  add('system_prompt', 'system_prompt', budget * 0.05);
  const book = card.character_book?.entries.filter((e) => e.content.trim()) ?? [];
  if (book.length) {
    parts.push(`<lorebook_entries>\n${book.slice(0, 30).map((e) => `- ${entryName(e) || e.keys.join('/')}: ${clip(e.content, 200)}`).join('\n')}\n</lorebook_entries>`);
  }
  return parts.join('\n\n') || '(The card is still empty.)';
}

const FIELD_GUIDANCE: Record<string, string> = {
  description:
    "The description is the core of the card: who {{char}} is (appearance, background, personality, habits, speech, relationships, what they want). It's sent with every message, so it should be dense and specific rather than flowery.",
  personality: 'A short summary of personality traits, usually a comma-separated list or one or two sentences.',
  scenario: 'The situation the roleplay starts in: where, when, and what is going on between {{char}} and {{user}}.',
  first_mes:
    "The greeting: the opening message of the chat, written as {{char}}. It sets the scene, the tone and the prose style the model will copy, and leaves {{user}} something to respond to. Never write {{user}}'s actions or words.",
  mes_example:
    'Example dialogue showing how {{char}} talks and writes. Each example starts with <START> on its own line, followed by lines like "{{user}}: ..." and "{{char}}: ...".',
  system_prompt: 'A system prompt that replaces the frontend default for this card. It can include the default back with {{original}}.',
  post_history_instructions: 'Instructions sent after the chat history (a "jailbreak" / UJB), for rules the model must not forget. Keep it short. {{original}} includes the frontend default.',
  creator_notes: "Notes shown to people browsing the card: what it's about, recommended settings, content warnings. Not sent to the model.",
};

function guidanceFor(path: string): string {
  if (path.startsWith('alternate_greetings.')) return FIELD_GUIDANCE.first_mes.replace('The greeting', 'An alternate greeting');
  if (path.startsWith('group_only_greetings.')) return 'A greeting used only in group chats, written as {{char}}.';
  if (path.startsWith('character_book.')) return 'A lorebook entry: facts inserted into the prompt when its keywords come up. Write it as terse, factual reference text.';
  return FIELD_GUIDANCE[path] ?? '';
}

export function fieldActionMessages(card: CardData, path: string, action: FieldAction, instruction: string): LlmMessage[] {
  const current = getPath(card, path);
  const label = fieldLabel(card, path);
  const task: Record<FieldAction, string> = {
    rewrite: `Rewrite the ${label}.`,
    draft: current.trim() ? `Write the ${label} from scratch. Treat its current text as the creator's notes and ideas.` : `Write the ${label}.`,
    expand: `Expand the ${label}: add depth, specifics and texture while keeping everything already there.`,
    shorten: `Tighten the ${label}: make it shorter and punchier without losing any important detail.`,
    polish: `Polish the ${label}: fix grammar, spelling, flow and consistency. Keep the meaning, content and voice the same.`,
    continue: `Continue the ${label} from exactly where it ends. Reply with only the new text to append.`,
  };
  const user = [
    `<card>\n${cardContext(card, path)}\n</card>`,
    `<field name="${label}">\n${current || '(empty)'}\n</field>`,
    guidanceFor(path) && `About this field: ${guidanceFor(path)}`,
    task[action],
    instruction.trim() && `The creator's instruction: ${instruction.trim()}`,
    action === 'continue' ? '' : `Reply with only the new text of the ${label}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}

// ─── Jobs that aren't one field ──────────────────────────────────────────────

export function newGreetingMessages(card: CardData, instruction: string): LlmMessage[] {
  const existing = [card.first_mes, ...card.alternate_greetings].filter((g) => g.trim());
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        `<card>\n${cardContext(card, 'first_mes')}\n</card>`,
        existing.length ? `<existing_greetings>\n${existing.map((g, i) => `<greeting ${i + 1}>\n${clip(g, 1500)}\n</greeting>`).join('\n')}\n</existing_greetings>` : '',
        `Write a new alternate greeting for this card: a different opening situation from the existing ones, in the same prose style and formatting. ${FIELD_GUIDANCE.first_mes}`,
        instruction.trim() && `The creator's instruction: ${instruction.trim()}`,
        'Reply with only the greeting.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

export function lorebookEntryMessages(card: CardData, topic: string): LlmMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `<card>\n${cardContext(card)}\n</card>\n\nWrite a lorebook entry about: ${topic}\n\nReply in exactly this format and nothing else:\nNAME: <short entry name>\nKEYS: <comma-separated trigger keywords, 2 to 6 of them>\nCONTENT:\n<the entry text: terse, factual reference prose, under 150 words>`,
    },
  ];
}

export function parseLorebookEntry(text: string): { name: string; keys: string[]; content: string } | null {
  const name = text.match(/^\s*NAME:\s*(.+)$/im)?.[1]?.trim();
  const keys = text.match(/^\s*KEYS:\s*(.+)$/im)?.[1];
  const content = text.split(/^\s*CONTENT:\s*$/im)[1]?.trim() ?? text.match(/CONTENT:\s*([\s\S]+)$/i)?.[1]?.trim();
  if (!content) return null;
  return { name: name ?? '', keys: (keys ?? '').split(',').map((k) => k.trim()).filter(Boolean), content };
}

export function cardTagsMessages(card: CardData): LlmMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `<card>\n${cardContext(card)}\n</card>\n\nSuggest 6 to 12 short tags for listing this card on a card site like Chub (genre, setting, character type, themes, e.g. "fantasy", "female", "tsundere", "slow burn"). Reply with only the tags, comma-separated, lowercase.`,
    },
  ];
}

export function critiqueMessages(card: CardData): LlmMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `<card>\n${cardContext(card, undefined, 30000)}\n</card>\n\nReview this card as an experienced card creator would. Point out, concisely and specifically: contradictions between fields; anything important that's missing; places where the model is likely to misbehave (speaking for {{user}}, unclear formatting, vague traits); greetings that don't give {{user}} anything to respond to; token-heavy passages that could be cut. End with the three changes that would improve it most. Use short bullet points.`,
    },
  ];
}

/** Brainstorm (the Ideas tab): a free-form chat that always sees the card. */
export function brainstormMessages(card: CardData, thread: LlmMessage[]): LlmMessage[] {
  const system = `You are a creative partner helping a creator develop a roleplay character card. You can see the card as it currently is. Brainstorm freely, be specific and concrete, offer options when asked for ideas, and when you write text meant for the card, match its voice and keep {{char}}/{{user}} macros. Be concise unless asked for more.`;
  return [{ role: 'system', content: `${system}\n\n<card>\n${cardContext(card, undefined, 20000)}\n</card>` }, ...thread];
}

/** Every job, for Settings → Assistant to show its prompt before it runs. */
export const ASSIST_JOBS: { label: string; build: (card: CardData) => LlmMessage[] }[] = [
  ...FIELD_ACTIONS.map((a) => ({ label: `✨ Description: ${a.label}`, build: (card: CardData) => fieldActionMessages(card, 'description', a.value, '(your instruction)') })),
  { label: '✨ First message: Rewrite', build: (card) => fieldActionMessages(card, 'first_mes', 'rewrite', '(your instruction)') },
  { label: '✨ New greeting', build: (card) => newGreetingMessages(card, '(your instruction)') },
  { label: '✨ Lorebook entry', build: (card) => lorebookEntryMessages(card, '(your topic)') },
  { label: '✨ Card tags', build: (card) => cardTagsMessages(card) },
  { label: '✨ Card review', build: (card) => critiqueMessages(card) },
  { label: '✨ Character prompt (art)', build: (card) => appearanceTagsMessages(card, '') },
  { label: '✨ Scene prompt (art, from the first message)', build: (card) => sceneTagsMessages(card, card.first_mes, '') },
  { label: '✨ Brainstorm', build: (card) => brainstormMessages(card, [{ role: 'user', content: '(your message)' }]) },
];

// ─── Words → art ─────────────────────────────────────────────────────────────

const TAG_RULES = `NovelAI's image models are prompted with Danbooru-style tags: lowercase, comma-separated, most important first, using real Danbooru tag names (e.g. "long hair", "blue eyes", "hair between eyes", "black thighhighs", "looking at viewer"). Use {tag} to emphasise and [tag] to de-emphasise only when it matters. No sentences, no names of the character, no quality tags like "masterpiece".`;

/** The character's look, as tags for their character prompt. */
export function appearanceTagsMessages(card: CardData, instruction: string): LlmMessage[] {
  return [
    { role: 'system', content: `You turn character descriptions into image-generation prompts. ${TAG_RULES}` },
    {
      role: 'user',
      content: [
        `<card>\n${cardContext(card, undefined, 8000)}\n</card>`,
        "Write the character prompt for this character's default look: gender/count tag first (e.g. \"1girl\"), then body, face, hair, eyes, notable features, then default outfit. Leave out pose, expression, background and setting.",
        instruction.trim() && `Also: ${instruction.trim()}`,
        'Reply with only the tags.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

/** A greeting's scene (pose, expression, setting, framing) as tags for the
 *  base prompt, to illustrate it. */
export function sceneTagsMessages(card: CardData, greeting: string, instruction: string): LlmMessage[] {
  return [
    { role: 'system', content: `You turn roleplay scenes into image-generation prompts. ${TAG_RULES}` },
    {
      role: 'user',
      content: [
        `<card>\n${cardContext(card, undefined, 5000)}\n</card>`,
        `<scene>\n${clip(greeting, 4000)}\n</scene>`,
        "Write the scene prompt for an illustration of this moment: framing (e.g. \"cowboy shot\", \"upper body\"), pose, expression, action, location, lighting and background. Leave out the character's own appearance (that has its own prompt).",
        instruction.trim() && `Also: ${instruction.trim()}`,
        'Reply with only the tags.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

/** Tidies a tag reply: one line, no trailing period or stray quotes. */
export function cleanTags(text: string): string {
  return text
    .replace(/```[a-z]*|```/g, '')
    .replace(/^\s*(tags|prompt)\s*:\s*/i, '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/^["']|["'.]$/g, '')
    .replace(/(, )+$/, '')
    .trim();
}
