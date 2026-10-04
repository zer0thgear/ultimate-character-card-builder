import type { LlmMessage } from '@/types/llm';

// The home screen's helper: a chat that answers questions about UCCB
// itself, from its own docs (docs/TOUR.md, docs/FEATURES.md, README.md),
// in a voice you pick. The docs are too long to send whole every turn, so
// each request gets the tour, an outline of the feature reference, the
// macro list, and the parts of the reference the question is about.

// ─── Personalities ───────────────────────────────────────────────────────────

export interface HelperPersonality {
  id: string;
  label: string;
  /** Said under the picker. */
  blurb: string;
  /** How it talks, for the system prompt. */
  prompt: string;
  /** Its opening line (shown, not generated). */
  greeting: string;
}

export const CUSTOM_PERSONALITY = 'custom';

export const HELPER_PERSONALITIES: HelperPersonality[] = [
  {
    id: 'plain',
    label: 'Helpful',
    blurb: 'Friendly and to the point.',
    prompt: 'You are friendly, clear and to the point.',
    greeting: "Hi! Ask me anything about UCCB: where a button is, what a setting does, which macros work, how to get a card from blank to chatting.",
  },
  {
    id: 'dry',
    label: 'Dry wit',
    blurb: 'Deadpan, sardonic, terribly understated.',
    prompt:
      'You have a bone-dry, deadpan wit, like a long-suffering butler who has seen everything twice. Understatement, sardonic asides, the occasional raised eyebrow you can hear. Never cruel, never gushing, never an exclamation mark.',
    greeting: 'Ah. A visitor. I know where every button in this app is, which puts me one up on most people who use it. What can I do for you?',
  },
  {
    id: 'brat',
    label: 'Teasing brat',
    blurb: 'Smug, teasing, acts like helping is a huge favor.',
    prompt:
      "You are a smug, teasing brat. You act like every question is obvious, call the user things like \"dummy\" or \"silly\", sigh dramatically, make them say please, and gloat about knowing things they don't. You always help in the end (you'd never admit you like helping), and the answer itself is complete and correct.",
    greeting: "Ugh, you again? Fine. I *guess* I can explain the app to you. Again. What is it this time, dummy?",
  },
  {
    id: 'mommy',
    label: 'Mommy',
    blurb: 'Warm, doting, so proud of you, sweetie.',
    prompt:
      'You are a warm, doting mommy figure. You call the user "sweetie", "honey" and "my clever little writer", praise every question, fuss over whether they\'ve had water and a snack, and gently scold them for staying up making cards. Affectionate and nurturing, laid on thick.',
    greeting: "Hello, sweetie! Come here, let Mommy help you with your cards. Have you had some water today? Now, what are we making?",
  },
  {
    id: 'bored',
    label: 'Bored',
    blurb: "Couldn't care less. Answers anyway.",
    prompt:
      'You are bored out of your mind and completely uninterested. Write in lowercase, with sighs, "whatever", "i guess" and trailing off... Minimum enthusiasm, maximum apathy. But the answer is still right and has every step it needs, delivered as if it costs you something.',
    greeting: "oh. hi. i'm supposed to help with the app or whatever. ask, i guess.",
  },
  {
    id: 'tsundere',
    label: 'Tsundere',
    blurb: "It's not like it WANTS to help you or anything.",
    prompt:
      'You are a classic tsundere. You insist you are not helping because you like the user, stammer ("I-it\'s not like..."), call them "baka", get flustered at thanks, and then help thoroughly and a little too eagerly.',
    greeting: "H-hmph! I'm only here because someone has to explain this app. It's not like I was waiting for you or anything! ...So? What do you want?",
  },
  {
    id: 'hype',
    label: 'Hype',
    blurb: 'Your biggest fan. VERY excited.',
    prompt:
      'You are an over-the-top hype cheerleader. Every question is AMAZING, every card idea is going to be LEGENDARY. Caps for emphasis, lots of exclamation marks, pep talk energy. Still give the real steps.',
    greeting: "OH WOW, HI!!! You're about to make the BEST cards ever and I get to help!!! Ask me ANYTHING about UCCB!",
  },
  {
    id: 'villain',
    label: 'Villain',
    blurb: 'Grandiose, theatrical, monologues about buttons.',
    prompt:
      'You are a theatrical evil overlord who has, for reasons of your own, deigned to explain this app. Grandiose monologues, "foolish mortal", dramatic reveals of where buttons are, schemes and maniacal laughter. Your directions are nonetheless precise.',
    greeting: 'So. You have come seeking the secrets of the Ultimate Character Card Builder. Very well, mortal. Ask, and I shall reveal... everything. Mwahaha.',
  },
];

export const personalityById = (id: string) => HELPER_PERSONALITIES.find((p) => p.id === id);

// ─── Docs ────────────────────────────────────────────────────────────────────

export interface HelpDocs {
  tour: string;
  features: string;
  readme: string;
}

export interface DocChunk {
  /** Which file, and the headings it sits under ("Test chat › SillyTavern presets"). */
  title: string;
  text: string;
  /** Its place in the docs, to put picked chunks back in reading order. */
  order: number;
}

const CHUNK_SIZE = 2500;

/** Splits a markdown doc at its headings, and long sections into chunks of
 *  whole paragraphs (or list items), each titled with its headings. */
export function chunkDoc(name: string, markdown: string, start = 0): DocChunk[] {
  const chunks: DocChunk[] = [];
  const path: string[] = [];
  let body: string[] = [];
  const flush = () => {
    const blocks = body.join('\n').split(/\n(?=\s*\n|- |\d+\. )/).map((b) => b.trim()).filter(Boolean);
    body = [];
    let text = '';
    const title = [name, ...path.slice(1).filter(Boolean)].join(' › ');
    const push = () => {
      if (text.trim()) chunks.push({ title, text: text.trim(), order: start + chunks.length });
      text = '';
    };
    for (const b of blocks) {
      if (text && text.length + b.length > CHUNK_SIZE) push();
      text += `${text ? '\n' : ''}${b}`;
    }
    push();
  };
  for (const line of markdown.split('\n')) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      const depth = h[1].length - 1;
      path.length = depth;
      path[depth] = h[2].trim();
      continue;
    }
    body.push(line);
  }
  flush();
  return chunks;
}

const STOP = new Set(
  'the and for are but not you your yours with can how what where when why who which does did this that there then than its into from have has had was were will would could should about any all get got use using used make made just like want need some them they their our out one two also way thing things please help app uccb button buttons'.split(' '),
);

/** A question's search words: lowercase, without common words and plural s. */
export function searchTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[{}]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  return [...new Set(words)];
}

/** The chunks most about `query`, up to `budget` characters, in reading
 *  order. A word in a chunk's headings counts three times; rarer words
 *  count for more. */
export function pickChunks(chunks: DocChunk[], query: string, budget: number): DocChunk[] {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const lower = chunks.map((c) => ({ title: c.title.toLowerCase(), text: c.text.toLowerCase() }));
  const df = terms.map((t) => lower.filter((c) => c.title.includes(t) || c.text.includes(t)).length);
  const scored = chunks
    .map((c, i) => {
      let score = 0;
      terms.forEach((t, j) => {
        if (!df[j]) return;
        const idf = Math.log(1 + chunks.length / df[j]);
        const hits = Math.min(3, lower[i].text.split(t).length - 1) + (lower[i].title.includes(t) ? 3 : 0);
        score += hits * idf;
      });
      return { c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked: DocChunk[] = [];
  let used = 0;
  for (const { c } of scored) {
    if (used + c.text.length > budget) continue;
    picked.push(c);
    used += c.text.length;
  }
  return picked.sort((a, b) => a.order - b.order);
}

/** Every heading of a doc, indented, so the model knows what exists even
 *  where it wasn't sent the details. */
export function outline(markdown: string): string {
  return markdown
    .split('\n')
    .map((l) => l.match(/^(#{2,3})\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => `${m[1].length === 3 ? '  ' : ''}- ${m[2]}`)
    .join('\n');
}

export function docChunks(docs: HelpDocs): DocChunk[] {
  const features = chunkDoc('Feature reference', docs.features);
  const readme = chunkDoc('README', docs.readme, features.length);
  return [...features, ...readme];
}

// ─── Built-in answers ────────────────────────────────────────────────────────

/** The macros UCCB expands (lib/macros.ts), for "which macros work?". */
export const MACRO_REFERENCE = `Macros UCCB expands in card fields, presets, the author's note and chats (SillyTavern's set):
- {{char}}, {{user}} (also <BOT>, <USER>): the character's and your persona's names.
- {{original}}: in the card's system prompt or post-history instructions, the default prompt it replaces.
- {{description}}, {{personality}}, {{scenario}}, {{persona}}, {{mesExamples}}: card and persona fields.
- {{lastMessage}}, {{lastChatMessage}}, {{lastUserMessage}}, {{lastCharMessage}}: from the chat so far. {{model}}: the model's name.
- {{random:a,b,c}} or {{random::a::b}}: one option, rolled each time. {{pick:a,b}} or {{pick::a::b}}: one option, the same each time for the same text.
- {{roll:d20}}, {{roll:2d6+1}}: dice.
- Variables: {{setvar::name::value}}, {{getvar::name}}, {{addvar::name::n}}, {{incvar::name}}, {{decvar::name}}, and the setglobalvar/getglobalvar/… forms (same store), shared across one prompt.
- {{time}}, {{date}}, {{weekday}}, {{isotime}}, {{isodate}}, {{idle_duration}}.
- {{newline}}, {{trim}}, {{noop}}, {{// a comment}} (removed).
- {{wiBefore}}, {{wiAfter}}: the lorebook entries placed before/after the character this turn.
- Conditionals: {{#if description}}…{{else}}…{{/if}}, {{#unless x}}…{{/unless}}, !x, nesting. A condition is a field (description, personality, scenario, persona, mesExamples), wiBefore/wiAfter, a macro like getvar::mood, or a variable's name; true unless empty, "false" or "0".
Regex scripts also take {{match}} and $1 in their replacement.`;

/** Short answers to the questions people ask first. */
export const QUICK_ANSWERS = `- Settings: ⚙ Settings in the header, or Settings on the home screen. LLM connections, image backends, presets, personas, templates, folders, versions and extensions are all tabs there.
- Home screen: ⌂ in the header closes the open card and comes back here.
- Card formats: imports and exports PNG (V1/V2/V3 cards), JSON and CHARX; drop a file anywhere to import. 🔗 Import from a URL takes Chub or Cardbox links.
- The ✨ on a text field: the writing assistant (Rewrite, Draft, Expand, Tighten, Polish, Continue), using the assistant connection.
- Undo: ↶ ↷ in the header or Ctrl+Z / Ctrl+Y outside text boxes. 🕘 beside undo is version history.
- Everything saves by itself; Ctrl+S saves now. Data lives in the data/ folder next to the app.
- 🔍 in the test chat shows the exact prompt sent (the prompt inspector).
- Prompt tidbits (🎨 Image): + Tidbit under the scene, a character's prompt or negative, or the negative prompt adds a switchable piece, added to that prompt when on. ⇪ saves one to the Tidbit Library (bottom of the prompts, shared by every card) and 🔗 From library… links an entry under any prompt; \`__Name__\` in a prompt uses an entry too. A Random library entry is a wildcard: one line per picture.
- Writing mode: in Chat mode with a card open, ✍ Story (in the header's 🗨 Chat | ✍ Story | 🎲 Adventure switch) writes a story with the model in one document. ✍ Continue (Ctrl+Enter) writes on, ↻ writes the part again, ‹ › pick a version. 📖 Story settings: Memory, Author's note, Cast (character entries that come in when named, like lorebook entries; 🔍 Scan the story suggests characters the Cast is missing, each to Add or skip), the card's lorebook, the connection, and Proofread each part (chat connections).
- Library gens in a card's gallery: with a card open, 📚 Library → open an image → ☆ Add to gallery (or ☑ in the library toolbar to select several, then ☆ Add to gallery). They show in 🖼 Gallery under Kept with this card; ★ marks library images the card already has, and the same picture is never added twice.
- ? (outside a text box) or ⌨ in the header lists keyboard shortcuts.
- Adventure mode: in Chat mode, **🎲 Adventure** in the header's 🗨 Chat | ✍ Story | 🎲 Adventure switch. A Director plans each turn as ordered beats (narration, and only the characters with something to add, who can answer each other within the turn, with narration between them), the app rolls real dice, and the Narrator and each acting character get a call of their own (up to 6 calls a turn by default; costs show per turn). 🌍 World holds the card's Cast (its dramatis personae), settings and rules (🔍 Scan the card has the Scout list them), changeable per adventure; newcomers the Director brings in join the adventure's Cast by themselves (⇪ adds one to the card's); the setup screen picks which persona you play; ⚙ beside it gives each actor its own connection, edits the actors' prompts (↺ Default resets one) and adds your own actors (a prompt, and an optional brief the Director fills in its plan when it should run).`;

// ─── The request ─────────────────────────────────────────────────────────────

const RETRIEVED_BUDGET = 14000;

export function helperSystemPrompt(docs: HelpDocs, query: string, personality: string): string {
  const picked = pickChunks(docChunks(docs), query, RETRIEVED_BUDGET);
  const sections = picked.map((c) => `### ${c.title}\n${c.text}`).join('\n\n');
  return `You are the built-in helper of Ultimate Character Card Builder (UCCB), a local web app for writing SillyTavern-style roleplay character cards, drawing them (NovelAI, A1111, ComfyUI) and test-chatting with them through LLM connections. You answer questions about using UCCB: where things are, what buttons and settings do, which macros work, how to get something done.

How to answer:
- Answer from the UCCB reference below. Name buttons, tabs and settings the way the reference does, with their icons (⚙ Settings, ✨, 💬 Test chat…), and give the path to them (Settings → LLM connections).
- If the reference doesn't cover something, say you're not sure rather than making up a button or setting. General advice about writing cards or about SillyTavern is fine when you say that's what it is.
- Keep it short: a few sentences or a few steps, unless asked for more. Light Markdown (**bold**, lists, \`code\`) is fine.

Your personality:
${personality.trim() || HELPER_PERSONALITIES[0].prompt}
Commit to it and ham it up; it's meant to be over the top. But the facts never bend to the voice: every answer stays correct and complete.

<reference>
## Quick answers
${QUICK_ANSWERS}

## ${MACRO_REFERENCE}

## The tour
${docs.tour.trim()}

## What the feature reference covers
${outline(docs.features)}
${sections ? `\n## From the feature reference and README (the parts about this question)\n${sections}\n` : ''}</reference>`;
}

/** The messages for one turn: the system prompt (built for the latest
 *  questions) and the conversation. */
export function helperMessages(docs: HelpDocs, thread: LlmMessage[], personality: string): LlmMessage[] {
  // The latest question matters most; the one before keeps a follow-up
  // ("and where's that?") on topic.
  const asked = thread.filter((m) => m.role === 'user').slice(-2);
  const query = asked.map((m) => m.content).join('\n') + (asked.length ? `\n${asked[asked.length - 1].content}` : '');
  return [{ role: 'system', content: helperSystemPrompt(docs, query, personality) }, ...thread];
}
