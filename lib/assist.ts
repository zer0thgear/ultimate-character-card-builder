import type { CardData } from '@/types/card';
import type { LlmImage, LlmMessage } from '@/types/llm';
import { CHARACTER_NOTE_PATH, fieldLabel, getPath } from '@/lib/cardPath';
import { entryName } from '@/lib/cardSpec';
import { packLayer } from '@/lib/packLayer';

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

const TAG_RULES = `The image model is prompted with Danbooru-style tags: lowercase, comma-separated, most important first, using real Danbooru tag names (e.g. "long hair", "blue eyes", "hair between eyes", "black thighhighs", "looking at viewer"). {{emphasis}} No sentences, no quality tags like "masterpiece", and no artist or art-style tags: the style has its own field.

Character tags: when a character is clearly an established one from an existing franchise (the card names them or plainly describes them), use their Danbooru character tag and their series' copyright tag, e.g. "princess peach, super mario bros." or "hatsune miku, vocaloid", right after "girl"/"boy"/"other" (or the count tags). The model knows them, so don't hold back; keep the look tags that matter too, especially where the card's version differs (a new outfit, say). Original characters get no name tags, only their look.

{{datasets}}`;

// What the tag rules say differs by where the gens are made (the Image
// tab's connection, set by store/imageConnections.ts): NovelAI's {emphasis}
// and its dataset tags, or the (tag:1.2) weights A1111 and ComfyUI read.
let artBackend: 'novelai' | 'sd' = 'novelai';
export const setArtBackend = (kind: 'novelai' | 'sd') => (artBackend = kind);
const artVars = (): Record<string, string> =>
  artBackend === 'novelai'
    ? {
        emphasis: 'Use {tag} to emphasise and [tag] to de-emphasise only when it matters.',
        datasets: 'Two special tags go first when they apply: "nsfw" if the image should show nudity or sexual content, and "fur dataset" if the character is anthro or furry (an animal-person, not a human with animal ears or a tail).',
      }
    : {
        emphasis: 'Use (tag:1.2) to emphasise and (tag:0.8) to de-emphasise only when it matters.',
        datasets: 'Put "nsfw" first if the image should show nudity or sexual content.',
      };

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

  // 🧙 Lorebook wizard (lib/loreWizard.ts)
  {
    key: 'loreWizard.planner',
    group: '🧙 Lorebook wizard',
    label: 'Planner: system prompt',
    vars: [],
    note: 'The planner plans the lorebook and turns your messages into changes; it never writes entries itself.',
    text: `You are the planner of a lorebook wizard: you help a creator build a whole lorebook (SillyTavern world info) for a roleplay card. A lorebook is a set of entries; each is short reference text that goes into the prompt only when one of its keys (trigger words) comes up in the chat, or always, for the few entries every reply needs.

You plan; a writer writes each entry from your plan. You never write entry text yourself.

A good plan:
- Covers what a roleplay in this world will actually bring up: places, people, factions, history, customs, items, creatures, whatever the creator asks for.
- Has one topic per entry, and doesn't repeat what the card's description already says: the lorebook adds to it.
- Gives each entry the keys a chat would really use: names, nicknames, short forms, plurals where they differ. 2 to 6 per entry, never common words ("the", "city", "man").
- Marks "always" only for the one or two entries every reply needs (the world's core premise); most entries have keys.

Reply with JSON only, no other text.`,
  },
  {
    key: 'loreWizard.plan',
    group: '🧙 Lorebook wizard',
    label: 'Planner: first plan',
    vars: ['card', 'existing', 'pitch', 'focus', 'count'],
    note: 'Keep the JSON reply shape; that is how the plan is read back. {{existing}} lists the entries the card already has.',
    text: `<card>
{{card}}
</card>

The lorebook already has these entries (don't plan them again):
{{existing}}

The creator's pitch: {{pitch}}

Focus on: {{focus}}

Plan about {{count}} entries.

Reply with JSON in this shape:
{
  "message": "a few sentences to the creator: what you planned and why, and one or two questions whose answers would make the lorebook better",
  "entries": [
    { "name": "entry name", "category": "place, person, faction, history, custom, item, creature or other", "keys": ["key", "another key"], "always": false, "brief": "one or two sentences: what the entry will cover" }
  ]
}`,
  },
  {
    key: 'loreWizard.review',
    group: '🧙 Lorebook wizard',
    label: 'Planner: review a lorebook',
    vars: ['card', 'draft', 'pitch', 'focus'],
    note: 'For a session started from the card\'s lorebook. Keep the JSON reply shape; that is how the changes are read back.',
    text: `<card>
{{card}}
</card>

The lorebook as it stands:
<lorebook>
{{draft}}
</lorebook>

What the creator wants: {{pitch}}

Focus on: {{focus}}

Review the lorebook: what works, what's missing, what's thin, vague or contradicts the card or itself, and keys that will misfire (too common, shared, missing). Then propose changes: rewrites of entries that need it, new entries for the gaps, removals only for entries that are redundant or harmful. Nothing is rewritten until the creator agrees, so explain your reasons in the message.

Reply with JSON in this shape, listing only what you'd change:
{
  "message": "your thoughts on the lorebook, for the creator: strengths, problems and what you propose, and a question if one would help",
  "changes": [
    { "op": "add", "name": "entry name", "category": "...", "keys": ["key"], "always": false, "brief": "what it will cover" },
    { "op": "edit", "entry": "an existing entry's name", "name": "its new name, only if renamed", "keys": ["only if they change"], "always": "true or false, only if it changes", "rewrite": "what the writer should change in its text" },
    { "op": "remove", "entry": "an existing entry's name" }
  ]
}`,
  },
  {
    key: 'loreWizard.revise',
    group: '🧙 Lorebook wizard',
    label: 'Planner: your message',
    vars: ['card', 'pitch', 'draft', 'conversation', 'message'],
    note: 'Keep the JSON reply shape; that is how the changes are read back. {{draft}} is the lorebook so far (plans, and written entries cut short).',
    text: `<card>
{{card}}
</card>

The creator's pitch: {{pitch}}

<lorebook_draft>
{{draft}}
</lorebook_draft>

What you and the creator said so far:
{{conversation}}

The creator says: {{message}}

Work out what to change in the draft. Reply with JSON in this shape, listing only what changes ("changes" is empty if nothing does, say for a question):
{
  "message": "a sentence or two to the creator: what you're changing, or the answer to their question",
  "changes": [
    { "op": "add", "name": "entry name", "category": "...", "keys": ["key"], "always": false, "brief": "what it will cover" },
    { "op": "edit", "entry": "an existing entry's name", "name": "its new name, only if renamed", "keys": ["only if they change"], "always": "true or false, only if it changes", "brief": "a new brief, for a planned entry", "rewrite": "for a written entry: what the writer should change in its text" },
    { "op": "remove", "entry": "an existing entry's name" }
  ]
}`,
  },
  {
    key: 'loreWizard.writer',
    group: '🧙 Lorebook wizard',
    label: 'Writer: system prompt',
    vars: [],
    text: `You write lorebook entries (SillyTavern world info) for a roleplay card. An entry goes into the prompt when its keys come up, so it is reference text for the model, not prose for a reader: terse, specific and factual, third person, present tense, dense with what a roleplay would use (what it is, what it looks like, who is involved, how it matters to {{char}} and the story). No headings, no list of keys, no actions or words for {{user}}. Call the card's character {{char}} and the player {{user}} where they come up. Stay consistent with the card and the other entries, and add to them rather than repeating them.`,
  },
  {
    key: 'loreWizard.write',
    group: '🧙 Lorebook wizard',
    label: 'Writer: one entry',
    vars: ['card', 'plan', 'written', 'current', 'name', 'keys', 'brief', 'instruction', 'length'],
    note: "{{plan}} is every entry's name and brief, {{written}} the entries written so far (cut short), {{current}} the entry's text when it's rewritten, {{instruction}} what to change.",
    text: `<card>
{{card}}
</card>

The whole lorebook, as planned:
{{plan}}

<written_entries>
{{written}}
</written_entries>

<current_text>
{{current}}
</current_text>

Write the entry "{{name}}" (keys: {{keys}}). It covers: {{brief}}

What to change: {{instruction}}

Length: {{length}}.

Reply with only the entry's text.`,
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
  { key: 'appearance.system', group: '✨ Character prompt (art)', label: 'System prompt', vars: ['emphasis', 'datasets'], note: '{{emphasis}} and {{datasets}} are filled in for where gens are made (NovelAI, or A1111 / ComfyUI).', text: `You turn character descriptions into image-generation prompts. ${TAG_RULES}` },
  {
    key: 'appearance.user',
    group: '✨ Character prompt (art)',
    label: 'Request',
    vars: ['card', 'names', 'instruction'],
    note: "Keep the CHARACTER <name>: reply format; each line goes to the character slot of that name. {{names}} lists the slots there already.",
    text: `<card>
{{card}}
</card>

Write the character prompt for each character this card is about, for their default look: "girl", "boy" or "other" first, then body, face, hair, eyes, notable features, then default outfit. Leave out pose, expression, background and setting. A card about one character gets one prompt; a card about several (a duo, a group) gets one each.

The character prompts so far are named: {{names}}. Use those names for the same characters.

Also: {{instruction}}

Reply with one line per character, in exactly this form and nothing else:
CHARACTER <name>: <tags>`,
  },
  {
    key: 'entryAppearance.user',
    group: '✨ Character prompt (art)',
    label: 'Request (from a lorebook entry)',
    vars: ['card', 'entry', 'name', 'names', 'instruction'],
    note: 'For 🎨 on a lorebook entry: {{entry}} is its text, {{name}} its name. Keep the CHARACTER <name>: reply format; the line goes to the character slot of that name.',
    text: `<card>
{{card}}
</card>

<lorebook_entry name="{{name}}">
{{entry}}
</lorebook_entry>

Write the character prompt for the character this lorebook entry describes, for their default look: "girl", "boy" or "other" first, then body, face, hair, eyes, notable features, then default outfit. Go by the entry; use the card only for what the entry leaves out about them. Leave out pose, expression, background and setting.

The character prompts so far are named: {{names}}. If the entry is about one of them, use that name; otherwise use the character's name from the entry.

Also: {{instruction}}

Reply with one line, in exactly this form and nothing else:
CHARACTER <name>: <tags>`,
  },
  { key: 'scene.system', group: '✨ Scene prompt (art)', label: 'System prompt', vars: ['emphasis', 'datasets'], note: '{{emphasis}} and {{datasets}} are filled in for where gens are made (NovelAI, or A1111 / ComfyUI).', text: `You turn roleplay scenes into image-generation prompts. ${TAG_RULES}` },
  {
    key: 'cast.user',
    group: '✨ Scene prompt (art)',
    label: 'Request (V4 and later: a prompt per character)',
    vars: ['card', 'scene', 'characters', 'positions', 'instruction'],
    note: "Keep the SCENE: / CHARACTER <name>: reply format; that's how it's read back. {{characters}} is the character prompts so far; {{positions}} is the placing rule, when Place characters is on.",
    text: `<card>
{{card}}
</card>

<scene>
{{scene}}
</scene>

<current_characters>
{{characters}}
</current_characters>

Write the prompts for an illustration of this moment. First the main prompt: the count tags (e.g. "1girl", "2girls", "1girl, 1boy"), then framing (e.g. "cowboy shot", "upper body"), location, lighting and background. Then a prompt for each character shown: "girl", "boy" or "other" first, then their look (keeping the tags of their current prompt above, changing only what this moment changes, like clothes), then their pose, expression and action. When characters interact, tag it on both: "source#hug" on the one doing it, "target#hug" on the one it's done to, "mutual#hug" when they do it together. Leave out characters who aren't in the moment, and give each character the name they have above.

{{positions}}

Also: {{instruction}}

Reply in exactly this form and nothing else:
SCENE: <tags>
CHARACTER <name>: <tags>`,
  },
  {
    key: 'scene.user',
    group: '✨ Scene prompt (art)',
    label: 'Request (V3: one prompt)',
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

  // References (any job, when you attach cards or pictures)
  {
    key: 'references.user',
    group: '📎 References',
    label: 'Attached cards and pictures',
    vars: ['cards', 'pictures'],
    note: 'Goes before your request when you attach references. {{cards}} is each card, sent the way the card being worked on is; {{pictures}} names the attached pictures (sent with the message, for a vision model).',
    text: `The user attached these for reference. They are not the card being worked on: use them the way the user asks (a style to match, a character who appears alongside, a place or facts to draw on, inspiration). Don't copy from them unless asked.

{{cards}}

{{pictures}}`,
  },

  {
    key: 'references.art',
    group: '📎 References',
    label: 'For the art prompt writers',
    vars: [],
    note: "Given to ✨ From description and ✨ From greeting (as their instruction) when you've attached art references in the Image tab.",
    text: `Use the attached references for how things look: describe what the pictures show as tags (hair, eyes, build, outfit, setting), and let the card fill in what they don't. A reference card is another character who may appear; take their look from it.`,
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

// Your edit, else an extension pack's (lib/packLayer.ts), else the built-in.
const template = (key: string) => overrides[key] ?? packLayer().templates[key]?.text ?? DEFAULT_TEMPLATES[key] ?? '';
/** A template as it stands (your edit, else a pack's, else the built-in one). */
export const templateText = template;

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

const job = (name: string, vars: Record<string, string>, systemOf = name): LlmMessage[] => {
  const system = fillTemplate(template(`${systemOf}.system`), vars);
  const user = fillTemplate(template(`${name}.user`), vars);
  return [...(system ? [{ role: 'system' as const, content: system }] : []), { role: 'user' as const, content: user }];
};

// ─── The card as context ─────────────────────────────────────────────────────

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The card as context, skipping the field being worked on. */
export function cardContext(card: CardData, skipPath?: string, budget = 12000, opts: { lorebook?: boolean } = {}): string {
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
  add(CHARACTER_NOTE_PATH, 'character_note', budget * 0.05);
  const lore = opts.lorebook === false ? '' : lorebookContext(card, skipPath, budget * 0.35);
  if (lore) parts.push(lore);
  return parts.join('\n\n') || '(The card is still empty.)';
}

/**
 * The lorebook as context: every entry that's switched on (the chat never
 * uses the others), with its name, keywords and whether it's always on, in
 * full while they fit `budget`, else each trimmed to an even share, so none
 * is left out. The entry being worked on is skipped (it's the field).
 */
export function lorebookContext(card: CardData, skipPath: string | undefined, budget: number): string {
  const entries = card.character_book?.entries ?? [];
  const skip = skipPath?.match(/^character_book\.entries\.(\d+)\./)?.[1];
  const shown = entries.filter((e, i) => e.content.trim() && String(i) !== skip);
  const on = shown.filter((e) => e.enabled !== false);
  const off = shown.length - on.length;
  const offNote = off ? `(${off} more entr${off === 1 ? 'y is' : 'ies are'} switched off.)` : '';
  if (!on.length) return offNote ? `<lorebook>\n${offNote}\n</lorebook>` : '';
  const total = on.reduce((n, e) => n + e.content.trim().length, 0);
  const share = total <= budget ? Infinity : Math.max(150, Math.floor(budget / on.length));
  const attr = (v: string) => v.replace(/"/g, "'");
  const body = on
    .map((e) => {
      const keys = e.constant ? 'always on' : e.keys.join(', ');
      return `<entry name="${attr(entryName(e) || e.keys[0] || 'entry')}" keys="${attr(keys)}">\n${clip(e.content.trim(), share)}\n</entry>`;
    })
    .join('\n');
  return `<lorebook>\n${body}${offNote ? `\n${offNote}` : ''}\n</lorebook>`;
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
  [CHARACTER_NOTE_PATH]:
    "The character's note: a short instruction sent inside the chat, a few messages from the end, with every reply (SillyTavern's Character's Note), for what the model tends to forget: tone, length, a running rule. Keep it brief.",
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
export function appearanceTagsMessages(card: CardData, instruction: string, names: string[] = []): LlmMessage[] {
  return job('appearance', { ...artVars(), card: cardContext(card, undefined, 8000), names: names.filter(Boolean).join(', '), instruction: instruction.trim() });
}

/** A lorebook entry's character (a sister, a rival, a companion), as tags
 *  for their character prompt. */
export function entryAppearanceMessages(card: CardData, entry: { name: string; content: string }, instruction: string, names: string[] = []): LlmMessage[] {
  return job(
    'entryAppearance',
    { ...artVars(), card: cardContext(card, undefined, 4000), entry: clip(entry.content.trim(), 6000), name: entry.name || 'unnamed', names: names.filter(Boolean).join(', '), instruction: instruction.trim() },
    'appearance',
  );
}

/** Where the cast writer puts characters, when asked to (NovelAI's grid). */
const POSITION_RULE =
  'Also place each character on NovelAI\'s 5×5 grid, columns A to E from left to right and rows 1 to 5 from top to bottom (C3 is the centre), with a line POSITION <name>: <cell> after their CHARACTER line.';

/** A greeting's moment as a V4+ prompt set: the main prompt and one per
 *  character in it (read with lib/castPrompt.ts). */
export function castSceneMessages(card: CardData, greeting: string, instruction: string, current: { label?: string; prompt: string }[], positions: boolean): LlmMessage[] {
  return job('cast', {
    ...artVars(),
    card: cardContext(card, undefined, 5000),
    scene: clip(greeting, 4000),
    characters: current.filter((c) => c.prompt.trim()).map((c) => `${c.label || 'Unnamed'}: ${c.prompt.trim()}`).join('\n'),
    positions: positions ? POSITION_RULE : '',
    instruction: instruction.trim(),
  }, 'scene');
}

/** A greeting's scene (pose, expression, setting, framing) as tags for the
 *  base prompt, to illustrate it. */
export function sceneTagsMessages(card: CardData, greeting: string, instruction: string): LlmMessage[] {
  return job('scene', { ...artVars(), card: cardContext(card, undefined, 5000), scene: clip(greeting, 4000), instruction: instruction.trim() });
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

/** The text that introduces attached references (see lib/references.ts). */
export function referencesText(vars: { cards: string; pictures: string }): string {
  return fillTemplate(template('references.user'), vars);
}

/** What the art writers are told when there are references. */
export const artReferenceNote = () => template('references.art');

/** Brainstorm (the Ideas tab): a free-form chat that always sees the card. */
/** Brainstorm's request. Without the lorebook (`lorebook: false`), its
 *  entries go only as references you attach. */
export function brainstormMessages(card: CardData, thread: LlmMessage[], opts: { lorebook?: boolean } = {}): LlmMessage[] {
  const system = fillTemplate(template('brainstorm.system'), { card: cardContext(card, undefined, 20000, opts) });
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
  {
    label: '🎨 Character prompt (art, from the first lorebook entry)',
    build: (card) => {
      const e = card.character_book?.entries[0];
      return entryAppearanceMessages(card, { name: e?.name || e?.comment || '', content: e?.content ?? '(a lorebook entry)' }, '');
    },
  },
  { label: '✨ Scene prompt (art, V4+, from the first message)', build: (card) => castSceneMessages(card, card.first_mes, '', [], false) },
  { label: '✨ Scene prompt (art, V4+, placing characters)', build: (card) => castSceneMessages(card, card.first_mes, '', [], true) },
  { label: '✨ Scene prompt (art, V3, from the first message)', build: (card) => sceneTagsMessages(card, card.first_mes, '') },
  { label: '✨ Brainstorm', build: (card) => brainstormMessages(card, [{ role: 'user', content: '(your message)' }]) },
  { label: '✨ From an image: physical description (+ the picture)', build: (card) => visionMessages(card, 'appearance', '(your guidance)', []) },
  { label: '✨ From an image: greeting (+ the picture)', build: (card) => visionMessages(card, 'greeting', '(your guidance)', []) },
  { label: '✨ From an image: ask (+ the picture)', build: (card) => visionMessages(card, 'ask', '(your question)', []) },
];

/** NovelAI's dataset switches, when a prompt writer put them in its tags:
 *  they're taken out (the form's switches add them, in the right place)
 *  and reported, for the switches to be turned on. */
export function takeDatasetTags(tags: string): { tags: string; nsfw: boolean; fur: boolean } {
  let nsfw = false;
  let fur = false;
  const kept = tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => {
      // Emphasis around it ({nsfw}, [fur dataset]) still counts.
      const bare = t.replace(/^[\s{}[\]()]+|[\s{}[\]()]+$/g, '').toLowerCase();
      if (bare === 'nsfw') return !(nsfw = true);
      if (bare === 'fur dataset') return !(fur = true);
      return t !== '';
    });
  // Nothing taken out: the text exactly as it was.
  return { tags: nsfw || fur ? kept.join(', ') : tags, nsfw, fur };
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
