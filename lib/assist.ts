import type { CardData } from '@/types/card';
import type { LlmImage, LlmMessage } from '@/types/llm';
import { fieldLabel, getPath } from '@/lib/cardPath';
import { entryName } from '@/lib/cardSpec';

// The writing assistant's requests: each builds the messages for one job,
// with the card as context. Replies are meant to be dropped straight into
// a field, so every job asks for the text alone.
//
// The wording is in templates (ASSIST_TEMPLATES), editable in Settings →
// Assistant, with {{placeholders}} filled in per request. A paragraph whose
// placeholder comes out empty (no instruction given, say) is left out.
// {{char}}, {{user}} and any other macro that isn't a placeholder are kept
// as written.

export type FieldAction = 'rewrite' | 'expand' | 'shorten' | 'polish' | 'draft' | 'continue';

export const FIELD_ACTIONS: { value: FieldAction; label: string; hint: string }[] = [
  { value: 'rewrite', label: 'Rewrite', hint: 'Rewrite it following your instruction' },
  { value: 'draft', label: 'Draft', hint: 'Write it from scratch (uses what the field has as notes)' },
  { value: 'expand', label: 'Expand', hint: 'Add depth and detail, keeping what is there' },
  { value: 'shorten', label: 'Tighten', hint: 'Cut it down without losing substance' },
  { value: 'polish', label: 'Polish', hint: 'Fix grammar, flow and consistency; keep the meaning' },
  { value: 'continue', label: 'Continue', hint: 'Write more after the end' },
];

// ─── Templates ───────────────────────────────────────────────────────────────

const WRITER = `You are an expert character card writer helping a creator build a roleplay character card (the SillyTavern / Chub "Tavern card" format). You write vivid, specific, well-structured prose, match the card's established voice and formatting conventions (for example *actions in asterisks* and "quoted speech" if the card uses them), and keep {{char}} and {{user}} macros exactly as written. You never add commentary, headings or quotation marks around your answer unless the field itself calls for them.`;

const TAG_RULES = `NovelAI's image models are prompted with Danbooru-style tags: lowercase, comma-separated, most important first, using real Danbooru tag names (e.g. "long hair", "blue eyes", "hair between eyes", "black thighhighs", "looking at viewer"). Use {tag} to emphasise and [tag] to de-emphasise only when it matters. No sentences, no names of the character, no quality tags like "masterpiece".`;

export interface AssistTemplate {
  key: string;
  /** The job it belongs to, for grouping in Settings. */
  group: string;
  label: string;
  /** The placeholders it can use. */
  vars: string[];
  /** Said beside it in Settings (what the reply must look like, say). */
  note?: string;
  text: string;
}

export const ASSIST_TEMPLATES: AssistTemplate[] = [
  // ✨ on a field
  { key: 'field.system', group: '✨ Field tools', label: 'System prompt', vars: [], text: WRITER },
  {
    key: 'field.user',
    group: '✨ Field tools',
    label: 'Request',
    vars: ['card', 'field', 'current', 'guidance', 'task', 'instruction', 'reply'],
    note: "{{task}} is the action's text below, {{reply}} the reply rule (left out for Continue), {{guidance}} what the field is for (built in, per field).",
    text: `<card>
{{card}}
</card>

<field name="{{field}}">
{{current}}
</field>

About this field: {{guidance}}

{{task}}

The creator's instruction: {{instruction}}

{{reply}}`,
  },
  { key: 'field.reply', group: '✨ Field tools', label: 'Reply rule', vars: ['field'], text: 'Reply with only the new text of the {{field}}.' },
  { key: 'field.rewrite', group: '✨ Field tools', label: 'Rewrite', vars: ['field'], text: `Rewrite the {{field}}.` },
  { key: 'field.draft', group: '✨ Field tools', label: 'Draft (field empty)', vars: ['field'], text: `Write the {{field}}.` },
  {
    key: 'field.draftNotes',
    group: '✨ Field tools',
    label: 'Draft (field has notes)',
    vars: ['field'],
    text: `Write the {{field}} from scratch. Treat its current text as the creator's notes and ideas.`,
  },
  { key: 'field.expand', group: '✨ Field tools', label: 'Expand', vars: ['field'], text: `Expand the {{field}}: add depth, specifics and texture while keeping everything already there.` },
  { key: 'field.shorten', group: '✨ Field tools', label: 'Tighten', vars: ['field'], text: `Tighten the {{field}}: make it shorter and punchier without losing any important detail.` },
  { key: 'field.polish', group: '✨ Field tools', label: 'Polish', vars: ['field'], text: `Polish the {{field}}: fix grammar, spelling, flow and consistency. Keep the meaning, content and voice the same.` },
  { key: 'field.continue', group: '✨ Field tools', label: 'Continue', vars: ['field'], note: 'The reply is appended to the field.', text: 'Continue the {{field}} from exactly where it ends. Reply with only the new text to append.' },

  // New greeting
  { key: 'greeting.system', group: '✨ New greeting', label: 'System prompt', vars: [], text: WRITER },
  {
    key: 'greeting.user',
    group: '✨ New greeting',
    label: 'Request',
    vars: ['card', 'greetings', 'instruction'],
    note: "{{greetings}} is the card's greetings so far, each cut to 1500 characters.",
    text: `<card>
{{card}}
</card>

<existing_greetings>
{{greetings}}
</existing_greetings>

Write a new alternate greeting for this card: a different opening situation from the existing ones, in the same prose style and formatting. The greeting: the opening message of the chat, written as {{char}}. It sets the scene, the tone and the prose style the model will copy, and leaves {{user}} something to respond to. Never write {{user}}'s actions or words.

The creator's instruction: {{instruction}}

Reply with only the greeting.`,
  },

  // Lorebook entry
  { key: 'lorebook.system', group: '✨ Lorebook entry', label: 'System prompt', vars: [], text: WRITER },
  {
    key: 'lorebook.user',
    group: '✨ Lorebook entry',
    label: 'Request',
    vars: ['card', 'topic'],
    note: 'Keep the NAME: / KEYS: / CONTENT: reply format; that is how the entry is read back.',
    text: `<card>
{{card}}
</card>

Write a lorebook entry about: {{topic}}

Reply in exactly this format and nothing else:
NAME: <short entry name>
KEYS: <comma-separated trigger keywords, 2 to 6 of them>
CONTENT:
<the entry text: terse, factual reference prose, under 150 words>`,
  },

  // Card tags
  { key: 'tags.system', group: '✨ Card tags', label: 'System prompt', vars: [], text: WRITER },
  {
    key: 'tags.user',
    group: '✨ Card tags',
    label: 'Request',
    vars: ['card'],
    note: 'The reply is split on commas.',
    text: `<card>
{{card}}
</card>

Suggest 6 to 12 short tags for listing this card on a card site like Chub (genre, setting, character type, themes, e.g. "fantasy", "female", "tsundere", "slow burn"). Reply with only the tags, comma-separated, lowercase.`,
  },

  // Card review
  { key: 'review.system', group: '✨ Card review', label: 'System prompt', vars: [], text: WRITER },
  {
    key: 'review.user',
    group: '✨ Card review',
    label: 'Request',
    vars: ['card'],
    text: `<card>
{{card}}
</card>

Review this card as an experienced card creator would. Point out, concisely and specifically: contradictions between fields; anything important that's missing; places where the model is likely to misbehave (speaking for {{user}}, unclear formatting, vague traits); greetings that don't give {{user}} anything to respond to; token-heavy passages that could be cut. End with the three changes that would improve it most. Use short bullet points.`,
  },

  // Art
  { key: 'appearance.system', group: '✨ Character prompt (art)', label: 'System prompt', vars: [], text: `You turn character descriptions into image-generation prompts. ${TAG_RULES}` },
  {
    key: 'appearance.user',
    group: '✨ Character prompt (art)',
    label: 'Request',
    vars: ['card', 'instruction'],
    note: 'The reply becomes one line of tags.',
    text: `<card>
{{card}}
</card>

Write the character prompt for this character's default look: gender/count tag first (e.g. "1girl"), then body, face, hair, eyes, notable features, then default outfit. Leave out pose, expression, background and setting.

Also: {{instruction}}

Reply with only the tags.`,
  },
  { key: 'scene.system', group: '✨ Scene prompt (art)', label: 'System prompt', vars: [], text: `You turn roleplay scenes into image-generation prompts. ${TAG_RULES}` },
  {
    key: 'scene.user',
    group: '✨ Scene prompt (art)',
    label: 'Request',
    vars: ['card', 'scene', 'instruction'],
    note: '{{scene}} is the greeting being illustrated. The reply becomes one line of tags.',
    text: `<card>
{{card}}
</card>

<scene>
{{scene}}
</scene>

Write the scene prompt for an illustration of this moment: framing (e.g. "cowboy shot", "upper body"), pose, expression, action, location, lighting and background. Leave out the character's own appearance (that has its own prompt).

Also: {{instruction}}

Reply with only the tags.`,
  },

  // Writing from a picture (a vision model sees it with the request)
  { key: 'vision.system', group: '✨ Write from an image', label: 'System prompt', vars: [], text: WRITER },
  {
    key: 'vision.appearance',
    group: '✨ Write from an image',
    label: 'Physical description',
    vars: ['card', 'instruction'],
    note: 'The picture is sent with it.',
    text: `<card>
{{card}}
</card>

The attached image shows {{char}}. Write a physical description of {{char}} as they look in it, for the card's description: build, face, hair, eyes, skin, notable features, and what they're wearing. Describe what's visible or clearly implied, and don't invent backstory. Match the card's existing voice and format, so it can sit in the description (or replace the part that describes their look).

The creator's instruction: {{instruction}}

Reply with only the description.`,
  },
  {
    key: 'vision.greeting',
    group: '✨ Write from an image',
    label: 'Greeting from the scene',
    vars: ['card', 'greetings', 'instruction'],
    note: 'The picture is sent with it.',
    text: `<card>
{{card}}
</card>

<existing_greetings>
{{greetings}}
</existing_greetings>

Write a new greeting for this card that opens on the moment in the attached image: the place, the situation, {{char}}'s pose, expression and outfit. Written as {{char}}, in the card's prose style and formatting, it sets the scene and leaves {{user}} something to respond to. Never write {{user}}'s actions or words.

The creator's instruction: {{instruction}}

Reply with only the greeting.`,
  },
  {
    key: 'vision.ask',
    group: '✨ Write from an image',
    label: 'Ask about it',
    vars: ['card', 'instruction'],
    note: 'The picture is sent with it; {{instruction}} is your question.',
    text: `<card>
{{card}}
</card>

The attached image was made for this card. {{instruction}}`,
  },

  // Brainstorm
  {
    key: 'brainstorm.system',
    group: '✨ Brainstorm',
    label: 'System prompt',
    vars: ['card'],
    note: 'Your messages and its replies follow it.',
    text: `You are a creative partner helping a creator develop a roleplay character card. You can see the card as it currently is. Brainstorm freely, be specific and concrete, offer options when asked for ideas, and when you write text meant for the card, match its voice and keep {{char}}/{{user}} macros. Be concise unless asked for more.

<card>
{{card}}
</card>`,
  },
];

export const DEFAULT_TEMPLATES: Record<string, string> = Object.fromEntries(ASSIST_TEMPLATES.map((t) => [t.key, t.text]));

// Your edits (Settings → Assistant), kept with the LLM settings; the store
// hands them over here (store/llmStore.ts).
let overrides: Record<string, string> = {};
export function setTemplateOverrides(next: Record<string, string> | undefined) {
  overrides = next ?? {};
}

const template = (key: string) => overrides[key] ?? DEFAULT_TEMPLATES[key] ?? '';

/**
 * Fills a template's {{placeholders}} from `vars`. A paragraph (text
 * between blank lines) using a placeholder that's empty is dropped;
 * {{macros}} that aren't in `vars` stay as they are.
 */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text
    .split(/\n[ \t]*\n/)
    .flatMap((para) => {
      let empty = false;
      const out = para.replace(/\{\{(\w+)\}\}/g, (m, name: string) => {
        if (!Object.hasOwn(vars, name)) return m;
        if (!vars[name].trim()) empty = true;
        return vars[name];
      });
      return empty || !out.trim() ? [] : [out];
    })
    .join('\n\n')
    .trim();
}

const job = (name: string, vars: Record<string, string>): LlmMessage[] => {
  const system = fillTemplate(template(`${name}.system`), vars);
  const user = fillTemplate(template(`${name}.user`), vars);
  return [...(system ? [{ role: 'system' as const, content: system }] : []), { role: 'user' as const, content: user }];
};

// ─── The card as context ─────────────────────────────────────────────────────

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

// ─── Jobs ────────────────────────────────────────────────────────────────────

export function fieldActionMessages(card: CardData, path: string, action: FieldAction, instruction: string): LlmMessage[] {
  const current = getPath(card, path);
  const field = fieldLabel(card, path);
  const taskKey = action === 'draft' && current.trim() ? 'field.draftNotes' : `field.${action}`;
  const task = fillTemplate(template(taskKey), { field });
  const reply = action === 'continue' ? '' : fillTemplate(template('field.reply'), { field });
  return job('field', { card: cardContext(card, path), field, current: current || '(empty)', guidance: guidanceFor(path), task, instruction: instruction.trim(), reply });
}

export function newGreetingMessages(card: CardData, instruction: string): LlmMessage[] {
  const existing = [card.first_mes, ...card.alternate_greetings].filter((g) => g.trim());
  return job('greeting', {
    card: cardContext(card, 'first_mes'),
    greetings: existing.map((g, i) => `<greeting ${i + 1}>\n${clip(g, 1500)}\n</greeting>`).join('\n'),
    instruction: instruction.trim(),
  });
}

export function lorebookEntryMessages(card: CardData, topic: string): LlmMessage[] {
  return job('lorebook', { card: cardContext(card), topic: topic.trim() });
}

export function parseLorebookEntry(text: string): { name: string; keys: string[]; content: string } | null {
  const name = text.match(/^\s*NAME:\s*(.+)$/im)?.[1]?.trim();
  const keys = text.match(/^\s*KEYS:\s*(.+)$/im)?.[1];
  const content = text.split(/^\s*CONTENT:\s*$/im)[1]?.trim() ?? text.match(/CONTENT:\s*([\s\S]+)$/i)?.[1]?.trim();
  if (!content) return null;
  return { name: name ?? '', keys: (keys ?? '').split(',').map((k) => k.trim()).filter(Boolean), content };
}

export function cardTagsMessages(card: CardData): LlmMessage[] {
  return job('tags', { card: cardContext(card) });
}

export function critiqueMessages(card: CardData): LlmMessage[] {
  return job('review', { card: cardContext(card, undefined, 30000) });
}

/** The character's look, as tags for their character prompt. */
export function appearanceTagsMessages(card: CardData, instruction: string): LlmMessage[] {
  return job('appearance', { card: cardContext(card, undefined, 8000), instruction: instruction.trim() });
}

/** A greeting's scene (pose, expression, setting, framing) as tags for the
 *  base prompt, to illustrate it. */
export function sceneTagsMessages(card: CardData, greeting: string, instruction: string): LlmMessage[] {
  return job('scene', { card: cardContext(card, undefined, 5000), scene: clip(greeting, 4000), instruction: instruction.trim() });
}

export type VisionJob = 'appearance' | 'greeting' | 'ask';

/** A job about a picture, sent with the request for a vision model. */
export function visionMessages(card: CardData, kind: VisionJob, instruction: string, images: LlmImage[]): LlmMessage[] {
  const existing = [card.first_mes, ...card.alternate_greetings].filter((g) => g.trim());
  const vars: Record<string, string> = {
    card: cardContext(card, undefined, 10000),
    greetings: existing.map((g, i) => `<greeting ${i + 1}>\n${clip(g, 1500)}\n</greeting>`).join('\n'),
    instruction: instruction.trim(),
  };
  const system = fillTemplate(template('vision.system'), vars);
  const user = fillTemplate(template(`vision.${kind}`), vars);
  return [...(system ? [{ role: 'system' as const, content: system }] : []), { role: 'user', content: user, images }];
}

/** Brainstorm (the Ideas tab): a free-form chat that always sees the card. */
export function brainstormMessages(card: CardData, thread: LlmMessage[]): LlmMessage[] {
  const system = fillTemplate(template('brainstorm.system'), { card: cardContext(card, undefined, 20000) });
  return [...(system ? [{ role: 'system' as const, content: system }] : []), ...thread];
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
  { label: '✨ From an image: physical description (+ the picture)', build: (card) => visionMessages(card, 'appearance', '(your guidance)', []) },
  { label: '✨ From an image: greeting (+ the picture)', build: (card) => visionMessages(card, 'greeting', '(your guidance)', []) },
  { label: '✨ From an image: ask (+ the picture)', build: (card) => visionMessages(card, 'ask', '(your question)', []) },
];

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
