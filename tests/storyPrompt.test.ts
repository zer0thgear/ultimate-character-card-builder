import { describe, expect, it } from 'vitest';
import { newCard } from '@/lib/cardSpec';
import {
  buildStoryRequest,
  cleanContinuation,
  currentTake,
  fitStory,
  insertNote,
  joinContinuation,
  normalizeStory,
  personaFields,
  proofreadMessages,
  storyLore,
  type StoryContext,
} from '@/lib/storyPrompt';
import type { StoryPersona, StorySession } from '@/types/project';

const card = () => {
  const c = newCard().data;
  c.name = 'Mira';
  c.description = '{{char}} is a smuggler who owes {{user}} money.';
  c.personality = 'Wry';
  return c;
};
const ctx = (over: Partial<StoryContext> = {}): StoryContext => ({ card: card(), userName: 'Sam', userDescription: 'A tired captain.', ...over });
const persona = (over: Partial<StoryPersona>): StoryPersona => ({ id: over.name ?? 'p', name: '', aliases: [], description: '', always: false, enabled: true, ...over });
const story = (over: Partial<StorySession> = {}): StorySession => normalizeStory({ id: 's', ...over });
const count = (t: string) => t.length;

describe('Dramatis Personae', () => {
  it('reads linked personae live from the card and the persona', () => {
    expect(personaFields(persona({ link: 'char' }), ctx())).toEqual({ name: 'Mira', description: 'Mira is a smuggler who owes Sam money.\nPersonality: Wry' });
    expect(personaFields(persona({ link: 'user' }), ctx())).toEqual({ name: 'Sam', description: 'A tired captain.' });
  });

  it('brings someone in when their name or an alias is in the recent paragraphs', () => {
    const personae = [persona({ name: 'Oren', description: 'A dockhand.', aliases: ['the kid'] }), persona({ name: 'Vex', description: 'A rival.' }), persona({ link: 'char', always: true })];
    const near = storyLore(story({ text: 'Long ago.\nThe kid waved from the pier.', personae, scanDepth: 1 }), ctx());
    expect(near.personae.map((p) => p.name)).toEqual(['Oren', 'Mira']);
    // Mentioned, but further back than the scan depth looks.
    const far = storyLore(story({ text: 'Vex laughed.\nRain.\nMore rain.', personae, scanDepth: 2 }), ctx());
    expect(far.personae.map((p) => p.name)).toEqual(['Mira']);
  });

  it('leaves out personae that are off or have no description', () => {
    const personae = [persona({ name: 'Oren', description: 'A dockhand.', enabled: false }), persona({ name: 'Vex', always: true })];
    expect(storyLore(story({ text: 'Oren and Vex.', personae }), ctx()).personae).toEqual([]);
  });

  it("reads the card's lorebook against the story, unless it's switched off", () => {
    const c = card();
    c.character_book = { extensions: {}, entries: [{ keys: ['harbor'], content: 'The harbor of {{char}}', extensions: {}, enabled: true, insertion_order: 0, use_regex: false }] };
    const lore = storyLore(story({ text: 'They reached the harbor.' }), ctx({ card: c }));
    expect(lore.lore.map((a) => a.entry.content)).toEqual(['The harbor of Mira']);
    expect(storyLore(story({ text: 'They reached the harbor.', useLorebook: false }), ctx({ card: c })).lore).toEqual([]);
  });
});

describe('fitting the story', () => {
  it('keeps the whole story when it fits, or there is no limit', () => {
    expect(fitStory('abc\ndef', undefined, count)).toEqual({ text: 'abc\ndef', trimmed: false });
    expect(fitStory('abc\ndef', 100, count)).toEqual({ text: 'abc\ndef', trimmed: false });
  });

  it('drops whole paragraphs from the start first', () => {
    expect(fitStory('one one\ntwo two\nthree', 15, count)).toEqual({ text: 'two two\nthree', trimmed: true });
  });

  it('cuts a too-long last paragraph at a word', () => {
    expect(fitStory('alpha beta gamma delta', 12, count)).toEqual({ text: 'gamma delta', trimmed: true });
    // Never starting mid-word.
    expect(fitStory('alpha beta gamma delta', 10, count)).toEqual({ text: 'delta', trimmed: true });
  });
});

describe('the author’s note', () => {
  it('goes a few lines from the end', () => {
    expect(insertNote('a\nb\nc\nd', 'note', 3)).toBe('a\n[ note ]\nb\nc\nd');
    expect(insertNote('a', 'note', 3)).toBe('[ note ]\na');
    expect(insertNote('a\nb', '  ', 3)).toBe('a\nb');
  });
});

describe('the request', () => {
  const s = story({ text: 'Mira counted the coins.', memory: 'A noir tale about {{char}}.', authorsNote: 'Keep it tense.', personae: [persona({ link: 'char', always: true })] });

  it('gives a text-completion model one raw prompt to write on from', () => {
    const r = buildStoryRequest(s, ctx(), { mode: 'text', direction: 'a knock at the door' });
    expect(r.prompt).toBe('A noir tale about Mira.\n***\nMira: Mira is a smuggler who owes Sam money.\nPersonality: Wry\n***\n' + "[ Author's note: Keep it tense. Next: a knock at the door ]\nMira counted the coins.");
    expect(r.prompt!.endsWith('Mira counted the coins.')).toBe(true);
  });

  it('asks a chat model for the next part, with memory, personae and lore in the system prompt', () => {
    const r = buildStoryRequest({ ...s, words: 150 }, ctx(), { mode: 'chat' });
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(r.messages[0].content).toContain('Write about 150 words.');
    expect(r.messages[0].content).toContain('## Memory\nA noir tale about Mira.');
    expect(r.messages[0].content).toContain('## Dramatis Personae\nMira: Mira is a smuggler');
    expect(r.messages[1].content).toBe("<story>\nMira counted the coins.\n</story>\n\nAuthor's note (keep this in mind): Keep it tense.\n\nContinue the story from exactly where it stops.");
  });

  it('asks a chat model to begin when the page is blank', () => {
    const r = buildStoryRequest(story(), ctx(), { mode: 'chat', instructions: 'Write {{words}} words.' });
    expect(r.messages).toEqual([
      { role: 'system', content: 'Write 200 words.' },
      { role: 'user', content: 'Begin the story.' },
    ]);
  });

  it("leaves out the story's start when it doesn't fit the context", () => {
    const long = story({ text: Array.from({ length: 50 }, (_, i) => `Paragraph ${i} goes on for a while.`).join('\n') });
    const r = buildStoryRequest(long, ctx(), { mode: 'chat', maxContext: 400, maxTokens: 100, count, instructions: 'Write.' });
    expect(r.trimmed).toBe(true);
    expect(r.messages[1].content).toContain('[…]\nParagraph');
    expect(r.messages[1].content).toContain('Paragraph 49 goes on for a while.');
    expect(r.messages.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(400 - 100);
  });
});

describe('joining a continuation', () => {
  it('cleans wrappers and repeats of the story’s end off it', () => {
    expect(cleanContinuation('```\n<continuation>\nShe ran.\n</continuation>\n```', 'x')).toBe('She ran.');
    expect(cleanContinuation('Mira counted the coins. Then she left.', 'At dusk, Mira counted the coins.')).toBe(' Then she left.');
    expect(cleanContinuation('Then she left.', 'Mira counted the coins.')).toBe('Then she left.');
    expect(cleanContinuation('Mira counted the coins. <continuation>Then she left.</continuation>', 'Mira counted the coins.')).toBe('Then she left.');
  });

  it('puts a space between words, and none before punctuation', () => {
    expect(joinContinuation('She ran.', 'Then stopped.')).toBe(' Then stopped.');
    expect(joinContinuation('She ran', ', then stopped.')).toBe(', then stopped.');
    expect(joinContinuation('She ran ', 'fast.')).toBe('fast.');
    expect(joinContinuation('She said, “', 'Run.”')).toBe('Run.”');
    expect(joinContinuation('', 'Once.')).toBe('Once.');
  });

  it('gives the proofreader the end of the story and the continuation', () => {
    const m = proofreadMessages('The story.', 'More.');
    expect(m[0].role).toBe('system');
    expect(m[1].content).toContain('<story_end>\nThe story.\n</story_end>');
    expect(m[1].content).toContain('<continuation>\nMore.\n</continuation>');
  });
});

describe('the latest take', () => {
  it('is current only while the story still ends with it', () => {
    const last = { start: 5, outputs: [' then', ' later'], index: 1 };
    expect(currentTake({ text: 'Begin later', last })).toEqual(last);
    expect(currentTake({ text: 'Begin later!', last })).toBeNull();
    expect(currentTake({ text: 'Begin', last })).toBeNull();
    expect(currentTake({ text: 'Begin later' })).toBeNull();
  });
});
