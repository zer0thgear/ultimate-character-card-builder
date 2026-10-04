import { describe, expect, it } from 'vitest';
import type { LlmMessage } from '@/types/llm';
import type { ActorId, AdventureEntry, AdventureWorld } from '@/types/adventure';
import { DEFAULT_ADVENTURE_SETTINGS } from '@/types/adventure';
import {
  activeLore,
  callsPerTurn,
  castMessages,
  describeRoll,
  directorMessages,
  directorNotes,
  effectiveWorld,
  extractJson,
  judgeRoll,
  knownName,
  newCastFrom,
  mergeWorld,
  narratorMessages,
  openingMessages,
  overlayList,
  parsePlan,
  turnBeats,
  parseScout,
  rollDice,
  runTurn,
  scoutMessages,
  tallyUsage,
  transcript,
  undoLastTurn,
  withOverride,
  type AdventureCtx,
  type TurnDeps,
} from '@/lib/adventure';
import { newCard, newEntry, newLorebook } from '@/lib/cardSpec';

const card = () => {
  const c = newCard().data;
  c.name = 'Ann';
  c.description = '{{char}} is a knight sworn to {{user}}.';
  c.personality = 'brave';
  c.scenario = 'A border fort.';
  c.first_mes = 'Ann salutes you.';
  c.character_book = { ...newLorebook(), entries: [{ ...newEntry(), keys: ['dragon'], content: 'The dragon Vex sleeps under the hill.', name: 'Vex' }] };
  return c;
};

const world = (): AdventureWorld => ({
  settings: [{ id: 's1', name: 'The fort', text: 'A stone fort on the border.' }],
  personae: [
    { id: 'p1', name: 'Ann', text: 'A knight, loyal to {{user}}.' },
    { id: 'p2', name: 'Grim', text: 'A grumpy quartermaster.' },
  ],
  rules: '- {{user}} has 10 HP.',
});

const ctx = (patch: Partial<AdventureCtx> = {}): AdventureCtx => ({
  card: card(),
  userName: 'Bob',
  persona: 'A wandering sellsword.',
  world: world(),
  settings: DEFAULT_ADVENTURE_SETTINGS,
  dice: true,
  lore: {},
  ...patch,
});

const entry = (patch: Partial<AdventureEntry>): AdventureEntry => ({ id: Math.random().toString(36).slice(2), turn: 1, kind: 'narration', text: '', createdAt: 0, ...patch });

describe('the world', () => {
  it("lays an adventure's changes over the card's entries", () => {
    const card = world().personae;
    const shown = overlayList(card, { p1: { id: 'p1', name: 'Ann', text: 'Wounded.' }, p2: null, x: { id: 'x', name: 'Vex', text: 'A dragon.' } });
    expect(shown.map((e) => [e.name, e.origin])).toEqual([
      ['Ann', 'changed'],
      ['Grim', 'removed'],
      ['Vex', 'added'],
    ]);
    expect(shown[0].text).toBe('Wounded.');
  });

  it("plays in the card's world, minus what's left out, with the adventure's rules", () => {
    const w = effectiveWorld(world(), { personae: { p2: null }, rules: 'No magic.' });
    expect(w.personae.map((p) => p.name)).toEqual(['Ann']);
    expect(w.settings).toHaveLength(1);
    expect(w.rules).toBe('No magic.');
    expect(effectiveWorld(undefined, undefined)).toEqual({ settings: [], personae: [], rules: '' });
  });

  it('sets and clears overrides', () => {
    let o = withOverride(undefined, 'settings', 's1', null);
    expect(o.settings).toEqual({ s1: null });
    o = withOverride(o, 'settings', 's1', undefined);
    expect(o.settings).toBeUndefined();
  });

  it("merges the Scout's finds without touching entries you have", () => {
    const merged = mergeWorld(world(), { settings: [{ id: 'n', name: 'the FORT', text: 'other' }, { id: 'm', name: 'Village', text: 'v' }], personae: [], rules: 'new rules' }, 5);
    expect(merged.settings.map((s) => s.name)).toEqual(['The fort', 'Village']);
    expect(merged.settings[0].text).toBe('A stone fort on the border.');
    expect(merged.rules).toBe('- {{user}} has 10 HP.');
    expect(merged.scannedAt).toBe(5);
    expect(mergeWorld(undefined, { settings: [], personae: [], rules: 'r' }).rules).toBe('r');
  });
});

describe('dice', () => {
  const fixed = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it('rolls dice specs with modifiers', () => {
    const r = rollDice('2d6+1', fixed(0, 0.99));
    expect(r.rolls).toEqual([1, 6]);
    expect(r.total).toBe(8);
    expect(r.dice).toBe('2d6+1');
  });

  it('rolls a d20 for anything that is not dice, and marks naturals', () => {
    const r = rollDice('a stealth check', fixed(0.999));
    expect(r.dice).toBe('1d20');
    expect(r.critical).toBe('success');
    expect(rollDice('d20', fixed(0)).critical).toBe('failure');
  });

  it('adds an extra modifier', () => {
    expect(rollDice('1d20', fixed(0.5), -2)).toMatchObject({ rolls: [11], modifier: -2, total: 9, dice: '1d20-2' });
  });

  it('judges against a difficulty, naturals winning', () => {
    expect(judgeRoll({ dice: '1d20', rolls: [12], modifier: 0, total: 12 }, 12)).toEqual({ dc: 12, outcome: 'success' });
    expect(judgeRoll({ dice: '1d20', rolls: [11], modifier: 0, total: 11 }, 12).outcome).toBe('failure');
    expect(judgeRoll({ dice: '1d20', rolls: [20], modifier: 0, total: 20, critical: 'success' }, 30).outcome).toBe('success');
    expect(judgeRoll({ dice: '1d20', rolls: [5], modifier: 0, total: 5 }, undefined)).toEqual({});
  });

  it('describes a roll', () => {
    expect(describeRoll({ reason: 'Picking the lock', dice: '1d20+2', rolls: [12], modifier: 2, total: 14, dc: 15, outcome: 'failure' })).toBe('Picking the lock: 1d20+2 → 14 (12+2) vs 15: failure');
  });
});

describe("the Director's plan", () => {
  it('finds JSON in a fence, among words, or with trailing commas', () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Plan: {"a": [1, 2,],} done')).toEqual({ a: [1, 2] });
    expect(extractJson('no json here')).toBeNull();
  });

  it('reads a plan', () => {
    const plan = parsePlan(
      JSON.stringify({
        scene: { location: 'Gate', present: ['Bob', 'Ann'], situation: 'Raiders approach.', time: 'dusk' },
        roll: { reason: 'Spot the raiders', dice: '1d20', dc: '13' },
        narration: 'Describe the raiders.',
        actors: [{ name: 'Ann', direction: 'draws her sword' }, 'Grim', { direction: 'nameless' }],
        notes: 'Raiders: 5.',
      }),
      'Ann',
    );
    expect(plan.parsed).toBe(true);
    expect(plan.scene).toEqual({ location: 'Gate', present: ['Bob', 'Ann'], situation: 'Raiders approach.', time: 'dusk' });
    expect(plan.roll).toEqual({ reason: 'Spot the raiders', dice: '1d20', dc: 13 });
    expect(plan.actors).toEqual([
      { name: 'Ann', direction: 'draws her sword' },
      { name: 'Grim', direction: '' },
    ]);
  });

  it("makes a turn of a reply that isn't JSON", () => {
    const plan = parsePlan('The raiders charge.', 'Ann');
    expect(plan).toMatchObject({ parsed: false, beats: [{ narrate: 'The raiders charge.' }, { name: 'Ann', direction: '' }], actors: [{ name: 'Ann', direction: '' }] });
    expect(plan.roll).toBeUndefined();
  });

  it('reads beats in order, and an older plan as narration then actors', () => {
    const plan = parsePlan(JSON.stringify({ beats: [{ narrate: 'The gate creaks.' }, { actor: 'Ann', direction: 'warns Bob' }, { narrate: '' }, { narrate: 'A horn sounds.' }, { name: 'Grim', direction: 'answers Ann' }, 'Mira', 42] }), 'Ann');
    expect(plan.beats).toEqual([{ narrate: 'The gate creaks.' }, { name: 'Ann', direction: 'warns Bob' }, { narrate: 'A horn sounds.' }, { name: 'Grim', direction: 'answers Ann' }, { name: 'Mira', direction: '' }]);
    expect(plan.actors.map((a) => a.name)).toEqual(['Ann', 'Grim', 'Mira']);
    expect(parsePlan(JSON.stringify({ narration: 'n', actors: ['Ann'] }), 'Ann').beats).toEqual([{ narrate: 'n' }, { name: 'Ann', direction: '' }]);
  });

  it('plays only what a turn allows: never you, maxActors characters, narration merged', () => {
    const beats = turnBeats({ beats: [{ narrate: 'a' }, { narrate: 'b' }, { name: 'Bob', direction: '' }, { name: 'Ann', direction: '' }, { narrate: 'c' }, { name: 'Grim', direction: '' }, { narrate: 'd' }, { name: 'Mira', direction: '' }, { narrate: 'e' }] }, 2, 'Bob');
    expect(beats).toEqual([{ narrate: 'a\nb' }, { name: 'Ann', direction: '' }, { narrate: 'c' }, { name: 'Grim', direction: '' }, { narrate: 'd\ne' }]);
    expect(turnBeats({ beats: [] }, 2, 'Bob')).toEqual([{ narrate: '' }]);
    expect(turnBeats({ beats: [{ name: 'Ann', direction: '' }] }, 2, 'Bob')).toEqual([{ name: 'Ann', direction: '' }]);
  });
});

describe('the Scout', () => {
  it('reads what it found', () => {
    const found = parseScout('{"settings":[{"name":"Fort","text":"Stone."},{"text":"no name"}],"personae":[{"name":"Ann","description":"A knight."}],"rules":["HP 10","No magic"]}');
    expect(found?.settings.map((s) => s.name)).toEqual(['Fort']);
    expect(found?.personae[0]).toMatchObject({ name: 'Ann', text: 'A knight.' });
    expect(found?.rules).toBe('- HP 10\n- No magic');
    expect(parseScout('nope')).toBeNull();
  });

  it('is sent the card and its lorebook', () => {
    const [, user] = scoutMessages(card());
    expect(user.content).toContain('# Ann');
    expect(user.content).toContain('The dragon Vex sleeps');
  });
});

describe('prompts', () => {
  const story = [entry({ kind: 'action', text: 'I look for the dragon.', speaker: 'Bob' }), entry({ kind: 'director', text: 'Narration: x\nNotes: secret' }), entry({ kind: 'note', text: 'make it scary' })];

  it('writes the story as a script, without the Director, cut to fit', () => {
    expect(transcript(story, 'Bob', 1000)).toBe('[Bob] I look for the dragon.');
    expect(transcript(story, 'Bob', 1000, { notes: true })).toContain('[Bob, to the Director] make it scary');
    const long = [entry({ text: 'a'.repeat(50) }), entry({ text: 'b'.repeat(50) })];
    expect(transcript(long, 'Bob', 70)).toBe(`[Narrator] ${'b'.repeat(50)}`);
  });

  it('calls up lorebook entries from the story', () => {
    expect(activeLore(ctx(), story)).toEqual(['The dragon Vex sleeps under the hill.']);
    expect(activeLore(ctx({ lore: null }), story)).toEqual([]);
  });

  it("gives the Director the world, rules, its notes and dice, with macros expanded", () => {
    const [system, user] = directorMessages(ctx(), story, undefined, { notes: 'secret' });
    expect(system.content).toContain('Dice are on');
    expect(system.content).toContain('At most 2 character beats');
    expect(user.content).toContain('Ann is a knight sworn to Bob.');
    expect(user.content).toContain('- Bob has 10 HP.');
    expect(user.content).toContain('<your_notes_so_far>\nsecret');
    expect(directorMessages(ctx({ dice: false }), [], undefined)[0].content).toContain('Dice are off');
  });

  it('tells the Narrator the roll', () => {
    const [, user] = narratorMessages(ctx(), story, undefined, 'Describe the hill.', { reason: 'Search', dice: '1d20', rolls: [20], modifier: 0, total: 20, dc: 10, outcome: 'success', critical: 'success' });
    expect(user.content).toContain('Describe the hill.');
    expect(user.content).toContain('Search: 1d20 → 20 vs 10: success');
    expect(user.content).toContain('make it dramatic');
  });

  it("gives each character their sheet, and the card's own character the card", () => {
    const ann = castMessages(ctx(), story, undefined, { name: 'Ann', direction: 'worried' })[1].content;
    expect(ann).toContain('A knight, loyal to Bob.');
    expect(ann).toContain('Ann is a knight sworn to Bob.');
    expect(ann).toContain('worried');
    expect(castMessages(ctx(), story, undefined, { name: 'Stranger', direction: '' })[1].content).toContain("isn't in the Cast yet");
  });

  it('opens from a greeting and a wish', () => {
    const [, user] = openingMessages(ctx(), { greeting: 'Hello {{user}}.', prompt: 'a siege' });
    expect(user.content).toContain('Hello Bob.');
    expect(user.content).toContain('a siege');
  });
});

describe('a turn', () => {
  const plan = (p: object) => JSON.stringify({ scene: { location: 'Gate', present: ['Bob', 'Ann', 'Grim'], situation: 's' }, narration: 'brief', actors: [], notes: 'n', roll: null, ...p });
  const deps = (replies: Partial<Record<ActorId, string | ((m: LlmMessage[]) => string)>>, extra: Partial<TurnDeps> = {}) => {
    const calls: { actor: ActorId; label: string }[] = [];
    const d: TurnDeps = {
      call: async (actor, label, messages, onText) => {
        calls.push({ actor, label });
        const r = replies[actor];
        const text = typeof r === 'function' ? r(messages) : (r ?? '');
        onText?.(text);
        return { text, usage: { actor, connection: 'c', model: 'm', input: 10, output: 5 } };
      },
      onChange: () => {},
      random: () => 0.5,
      now: () => 1,
      ...extra,
    };
    return { d, calls };
  };

  it('plans, rolls, narrates, then plays each character (never you), at most maxActors', async () => {
    const { d, calls } = deps({
      director: plan({ roll: { reason: 'Climb', dice: '1d20', dc: 10 }, actors: [{ name: 'Bob' }, { name: 'Ann', direction: 'helps' }, { name: 'Grim' }, { name: 'Extra' }] }),
      narrator: 'You climb.',
      cast: (m) => (m[1].content.includes('<character name="Ann">') ? 'Ann helps.' : 'Grim grumbles.'),
    });
    const r = await runTurn({ ctx: ctx(), session: { entries: [] }, action: 'I climb the wall.' }, d);
    expect(r.error).toBeUndefined();
    expect(calls.map((c) => c.label)).toEqual(['🎬 Director', '📜 Narrator', '🎭 Ann', '🎭 Grim']);
    expect(r.entries.map((e) => [e.kind, e.speaker ?? '', e.turn])).toEqual([
      ['action', 'Bob', 1],
      ['director', '', 1],
      ['roll', 'Bob', 1],
      ['narration', '', 1],
      ['character', 'Ann', 1],
      ['character', 'Grim', 1],
    ]);
    expect(r.entries[2].roll).toMatchObject({ total: 11, dc: 10, outcome: 'success' });
    expect(r.scene?.location).toBe('Gate');
    expect(tallyUsage(r.entries.map((e) => e.usage))).toMatchObject({ calls: 4, input: 40, output: 20, unpriced: 4 });
  });

  it('plays the beats in order: narration between characters, each seeing what came before', async () => {
    const narratorSeen: string[] = [];
    const castSeen: string[] = [];
    const { d, calls } = deps({
      director: plan({ roll: { reason: 'Climb', dice: '1d20', dc: 10 }, beats: [{ narrate: 'the climb' }, { actor: 'Ann', direction: 'teases Bob' }, { narrate: 'a horn sounds' }, { actor: 'Grim', direction: 'answers Ann' }] }),
      narrator: (m) => (narratorSeen.push(m[0].content + m[1].content), narratorSeen.length === 1 ? 'You climb.' : 'A horn.'),
      cast: (m) => (castSeen.push(m[1].content), m[1].content.includes('<character name="Ann">') ? 'Ann laughs.' : 'Grim snaps back.'),
    });
    const r = await runTurn({ ctx: ctx(), session: { entries: [] }, action: 'I climb the wall.' }, d);
    expect(calls.map((c) => c.label)).toEqual(['🎬 Director', '📜 Narrator', '🎭 Ann', '📜 Narrator', '🎭 Grim']);
    expect(r.entries.map((e) => e.kind)).toEqual(['action', 'director', 'roll', 'narration', 'character', 'narration', 'character']);
    // The first passage knows who's next and leaves them be; it alone narrates the roll.
    expect(narratorSeen[0]).toContain("Ann, Grim act right after this passage: don't write what they say or do");
    expect(narratorSeen[0]).toContain('Narrate the success');
    expect(narratorSeen[1]).toContain('Grim acts right after');
    expect(narratorSeen[1]).toContain('falls between characters');
    expect(narratorSeen[1]).not.toContain('Narrate the success');
    // Grim hears Ann, and the horn.
    expect(castSeen[1]).toContain('[Ann] Ann laughs.');
    expect(castSeen[1]).toContain('[Narrator] A horn.');
    expect(castSeen[1]).toContain('answers Ann');
  });

  it('skips the roll with dice off', async () => {
    const { d } = deps({ director: plan({ roll: { reason: 'Climb', dice: '1d20', dc: 10 } }), narrator: 'ok' });
    const r = await runTurn({ ctx: ctx({ dice: false }), session: { entries: [] }, action: 'x' }, d);
    expect(r.entries.some((e) => e.kind === 'roll')).toBe(false);
  });

  it('sends a note to the Director as its instruction, kept out of the story', async () => {
    const seen: string[] = [];
    const { d } = deps({ director: (m) => (seen.push(m[1].content), plan({})), narrator: 'ok' });
    const r = await runTurn({ ctx: ctx(), session: { entries: [] }, action: 'add a dragon', toDirector: true }, d);
    expect(r.entries[0]).toMatchObject({ kind: 'note', text: 'add a dragon' });
    expect(seen[0]).toContain('out of character: "add a dragon"');
  });

  it("stops at an error, keeping what's written", async () => {
    const { d } = deps({ director: plan({ actors: [{ name: 'Ann' }] }), narrator: 'ok' });
    const failing: TurnDeps = { ...d, call: async (actor, label, m, onText) => (actor === 'cast' ? { text: '', error: 'boom' } : d.call(actor, label, m, onText)) };
    const r = await runTurn({ ctx: ctx(), session: { entries: [] }, action: 'x' }, failing);
    expect(r.error).toBe('boom');
    expect(r.entries.map((e) => e.kind)).toEqual(['action', 'director', 'narration']);
  });

  it('stops once aborted', async () => {
    const controller = new AbortController();
    const { d, calls } = deps({ director: () => (controller.abort(), plan({ actors: [{ name: 'Ann' }] })) }, { signal: controller.signal });
    await runTurn({ ctx: ctx(), session: { entries: [] } }, d);
    expect(calls.map((c) => c.actor)).toEqual(['director']);
  });

  it('keeps the Director’s notes from turn to turn', async () => {
    const { d } = deps({ director: plan({ notes: 'Raiders: 5' }), narrator: 'ok' });
    const r = await runTurn({ ctx: ctx(), session: { entries: [] }, action: 'x' }, d);
    expect(directorNotes(r.entries)).toBe('Raiders: 5');
  });

  it('redoes the last turn from your action, with the scene from before it', async () => {
    const { d } = deps({ director: plan({}), narrator: 'first' });
    const before = { location: 'Hall', present: [], situation: 'calm' };
    const r = await runTurn({ ctx: ctx(), session: { entries: [entry({ turn: 0, text: 'Opening' })], scene: before }, action: 'x' }, d);
    const undone = undoLastTurn(r);
    expect(undone.entries.map((e) => e.kind)).toEqual(['narration', 'action']);
    expect(undone.scene).toEqual(before);
    const again = await runTurn({ ctx: ctx(), session: undone, redo: true, turn: 1 }, deps({ director: plan({}), narrator: 'second' }).d);
    expect(again.entries.filter((e) => e.kind === 'action')).toHaveLength(1);
    expect(again.entries.at(-1)).toMatchObject({ kind: 'narration', text: 'second', turn: 1 });
  });

  it('counts the calls a turn makes', () => {
    expect(callsPerTurn({ maxActors: 2 })).toBe(6);
  });
});

describe('newcomers to the Cast', () => {
  it('matches names loosely', () => {
    expect(knownName('Captain Vex', ['Vex'])).toBe(true);
    expect(knownName('vex', ['Captain Vex'])).toBe(true);
    expect(knownName('Vexa', ['Vex'])).toBe(false);
    expect(knownName('Mira', ['Ann', 'Grim'])).toBe(false);
  });

  it("reads the Director's newcomers", () => {
    const plan = parsePlan(JSON.stringify({ narration: 'n', actors: [], new_cast: [{ name: 'Mira', text: 'A smuggler.' }, 'Tobb', { text: 'nameless' }] }), 'Ann');
    expect(plan.newCast).toEqual([
      { name: 'Mira', text: 'A smuggler.' },
      { name: 'Tobb', text: '' },
    ]);
  });

  it('finds who is new: not you, not the card, not the Cast, not twice', () => {
    const found = newCastFrom({ newCast: [{ name: 'Mira', text: 'A smuggler.' }, { name: 'Grim', text: 'dup' }, { name: 'Bob', text: 'you' }], actors: [{ name: 'Mira', direction: 'x' }, { name: 'Sergeant Tobb', direction: 'barks orders' }, { name: 'Ann', direction: '' }] }, ctx(), 3);
    expect(found.map((f) => [f.name, f.text])).toEqual([
      ['Mira', 'A smuggler.'],
      ['Sergeant Tobb', 'Came into the story in turn 3: barks orders.'],
    ]);
  });

  it('adds them during a turn and plays them from their new sheet', async () => {
    const sheets: string[] = [];
    const d: TurnDeps = {
      call: async (actor, _label, messages) => {
        if (actor === 'cast') sheets.push(messages[1].content);
        const text = actor === 'director' ? JSON.stringify({ narration: 'n', actors: [{ name: 'Mira', direction: 'haggles' }], new_cast: [{ name: 'Mira', text: 'A smuggler with a scar.' }] }) : 'ok';
        return { text };
      },
      onChange: () => {},
    };
    const r = await runTurn({ ctx: ctx(), session: { entries: [] }, action: 'x' }, d);
    expect(r.newCast.map((c) => c.name)).toEqual(['Mira']);
    expect(r.entries.find((e) => e.kind === 'cast')?.text).toBe('New in the Cast: Mira');
    expect(sheets[0]).toContain('<character name="Mira">\nA smuggler with a scar.');
    const off = await runTurn({ ctx: ctx({ settings: { ...DEFAULT_ADVENTURE_SETTINGS, autoCast: false } }), session: { entries: [] }, action: 'x' }, d);
    expect(off.newCast).toEqual([]);
  });
});
