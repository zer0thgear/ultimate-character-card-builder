import type { CardData } from '@/types/card';
import type { LlmMessage } from '@/types/llm';
import type { ActorId, AdventureEntry, AdventureSession, AdventureSettings, AdventureWorld, CallUsage, DiceRoll, SceneState, WorldEntry, WorldOverrides } from '@/types/adventure';
import { macroExpander } from '@/lib/chatPrompt';
import { scanLorebook, type LoreDefaults } from '@/lib/lorebookScan';
import { uuid } from '@/lib/uuid';

// Adventure mode's engine (see types/adventure.ts). A turn is a few model
// calls in a row: the Director plans it as JSON, the app rolls any dice it
// asked for, the Narrator writes what happens, then each character the
// Director picked is played by a call of its own. The calls themselves are
// passed in (TurnDeps.call), so this file stays free of the network.

// ─── The world ───────────────────────────────────────────────────────────────

export const emptyWorld = (): AdventureWorld => ({ settings: [], personae: [], rules: '' });

export type WorldList = 'settings' | 'personae';

/** An entry as one adventure sees it, and where it came from. */
export type ShownEntry = WorldEntry & { origin: 'card' | 'changed' | 'added' | 'removed' };

/** A card's list with an adventure's changes laid over it: the card's
 *  entries in order (changed or left out ones marked), then the ones added. */
export function overlayList(card: WorldEntry[], over: Record<string, WorldEntry | null> | undefined): ShownEntry[] {
  const o = over ?? {};
  const ids = new Set(card.map((e) => e.id));
  const shown: ShownEntry[] = card.map((e) => {
    if (!(e.id in o)) return { ...e, origin: 'card' };
    const v = o[e.id];
    return v ? { ...v, id: e.id, origin: 'changed' } : { ...e, origin: 'removed' };
  });
  for (const [id, v] of Object.entries(o)) if (!ids.has(id) && v) shown.push({ ...v, id, origin: 'added' });
  return shown;
}

/** The world one adventure plays in: the card's, with its changes. */
export function effectiveWorld(world: AdventureWorld | undefined, over: WorldOverrides | undefined): AdventureWorld {
  const w = world ?? emptyWorld();
  const live = (list: WorldList) =>
    overlayList(w[list], over?.[list])
      .filter((e) => e.origin !== 'removed')
      .map(({ id, name, text }) => ({ id, name, text }));
  return { settings: live('settings'), personae: live('personae'), rules: over?.rules ?? w.rules };
}

/** An adventure's changes with one more: `entry` for this adventure only
 *  (null leaves it out here; undefined goes back to the card's). */
export function withOverride(over: WorldOverrides | undefined, list: WorldList, id: string, entry: WorldEntry | null | undefined): WorldOverrides {
  const next: WorldOverrides = { ...over, [list]: { ...over?.[list] } };
  const map = next[list]!;
  if (entry === undefined) delete map[id];
  else map[id] = entry;
  if (!Object.keys(map).length) delete next[list];
  return next;
}

/** What the Scout found, merged into a world: entries whose name is already
 *  there are left as you have them, new ones are added. */
export function mergeWorld(world: AdventureWorld | undefined, found: Pick<AdventureWorld, 'settings' | 'personae' | 'rules'>, now = Date.now()): AdventureWorld {
  const w = world ?? emptyWorld();
  const merge = (have: WorldEntry[], add: WorldEntry[]) => {
    const names = new Set(have.map((e) => e.name.trim().toLowerCase()));
    return [...have, ...add.filter((e) => !names.has(e.name.trim().toLowerCase()))];
  };
  return {
    ...w,
    settings: merge(w.settings, found.settings),
    personae: merge(w.personae, found.personae),
    rules: w.rules.trim() ? w.rules : found.rules,
    scannedAt: now,
  };
}

/** Rules to start from, for the Rules box. */
export const RULE_EXAMPLES: { label: string; text: string }[] = [
  {
    label: 'Creature catching',
    text: `Creature catching:
- Wild creatures can be caught with a capture ball once weakened; a roll decides it (harder the healthier and rarer the creature).
- {{user}} carries at most six creatures; others go to storage.
- Creatures have a type, a level and up to four moves; they gain levels from battles.
- Track {{user}}'s team, items and badges in your notes.`,
  },
  {
    label: 'Hit points and combat',
    text: `Combat:
- {{user}} has 20 HP; ordinary foes 5–15. A hit deals 1d6 (1d8 with a real weapon), more for big monsters.
- Attacks, dodges and spells are rolled against the target's difficulty.
- At 0 HP {{user}} is knocked out, not killed, unless the stakes were made clear.
- Track HP and conditions in your notes and mention changes in the narration.`,
  },
  {
    label: 'Survival',
    text: `Survival:
- Track food, water, light and a short inventory in your notes; each day of travel uses a ration and a waterskin.
- Nights outside without a fire or shelter cost {{user}} 1 point of stamina (of 5); at 0 they can't push on.
- Foraging and hunting need a roll; the wilds get more dangerous the longer they stay out.`,
  },
  {
    label: 'Social standing',
    text: `Reputation:
- Each faction has a standing with {{user}} from -3 (hostile) to +3 (devoted), starting at 0. Track them in your notes.
- Persuading, lying and intimidating are rolled; standing gives +1 or -1 per point.
- Broken promises lower standing; favors raise it.`,
  },
];

// ─── Dice ────────────────────────────────────────────────────────────────────

/** Dice like "1d20", "2d6+1", "d8-1"; a spec that isn't dice rolls 1d20. */
export function rollDice(spec: string, random: () => number = Math.random, extraModifier = 0): Omit<DiceRoll, 'reason'> {
  const m = spec.trim().toLowerCase().replace(/\s+/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/);
  const count = m ? Math.min(20, Math.max(1, Number(m[1] || 1))) : 1;
  const sides = m ? Math.min(1000, Math.max(2, Number(m[2]))) : 20;
  const modifier = (m ? Number(m[3] || 0) : 0) + extraModifier;
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  const dice = `${count}d${sides}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`;
  const critical = count === 1 && sides === 20 ? (rolls[0] === 20 ? 'success' : rolls[0] === 1 ? 'failure' : undefined) : undefined;
  return { dice, rolls, modifier, total, ...(critical ? { critical } : {}) };
}

/** A roll against a difficulty: met or beaten is a success; a natural 20 or 1
 *  on a d20 always succeeds or fails. */
export function judgeRoll(roll: Omit<DiceRoll, 'reason'>, dc: number | undefined): Pick<DiceRoll, 'outcome' | 'dc'> {
  if (dc === undefined || !Number.isFinite(dc)) return {};
  const outcome = roll.critical ?? (roll.total >= dc ? 'success' : 'failure');
  return { dc, outcome };
}

/** "Picking the lock: 1d20+2 → 14 (12+2) vs 15: failure". */
export function describeRoll(r: DiceRoll): string {
  const parts = r.rolls.length > 1 || r.modifier ? ` (${r.rolls.join('+')}${r.modifier ? (r.modifier > 0 ? `+${r.modifier}` : r.modifier) : ''})` : '';
  const vs = r.dc !== undefined ? ` vs ${r.dc}` : '';
  const crit = r.critical ? ` (natural ${r.critical === 'success' ? 20 : 1})` : '';
  return `${r.reason ? `${r.reason}: ` : ''}${r.dice} → ${r.total}${parts}${vs}${r.outcome ? `: ${r.outcome}` : ''}${crit}`;
}

// ─── The Director's plan ─────────────────────────────────────────────────────

/** One step of a turn, in order: a passage of narration, or one
 *  character's part. */
export type Beat = { narrate: string } | { name: string; direction: string };

export const isNarration = (b: Beat): b is { narrate: string } => 'narrate' in b;

export interface DirectorPlan {
  scene?: SceneState;
  roll?: { reason: string; dice: string; dc?: number; modifier?: number } | null;
  /** The turn in order: narration and characters, interleaved. */
  beats: Beat[];
  /** The characters who act, in order (from the beats). */
  actors: { name: string; direction: string }[];
  /** Characters the Director brought into the story this turn. */
  newCast: { name: string; text: string }[];
  notes: string;
}

/** The first JSON object in a reply (in a code fence, or with words around
 *  it), or null. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    const body = c.slice(start, end + 1);
    try {
      return JSON.parse(body);
    } catch {
      // Trailing commas are the usual slip.
      try {
        return JSON.parse(body.replace(/,\s*([}\]])/g, '$1'));
      } catch {
        /* next */
      }
    }
  }
  return null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

const actorsOf = (beats: Beat[]) => beats.filter((b): b is { name: string; direction: string } => !isNarration(b));

function toActor(a: unknown): { name: string; direction: string } | null {
  if (typeof a === 'string') return a.trim() ? { name: a.trim(), direction: '' } : null;
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const name = str(o.actor ?? o.name ?? o.character);
  return name ? { name, direction: str(o.direction ?? o.does ?? o.brief) } : null;
}

/** The plan's beats: "beats" in order, or (an older plan) "narration" and
 *  then "actors". */
function parseBeats(raw: Record<string, unknown>): Beat[] {
  if (Array.isArray(raw.beats)) {
    const beats: Beat[] = [];
    for (const b of raw.beats) {
      const o = b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
      const brief = o ? str(o.narrate ?? o.narration ?? o.narrator) : '';
      if (brief) beats.push({ narrate: brief });
      else {
        const a = toActor(b);
        if (a) beats.push(a);
      }
    }
    return beats;
  }
  const actors = (Array.isArray(raw.actors) ? raw.actors : []).map(toActor).filter((a): a is { name: string; direction: string } => !!a);
  return [...(str(raw.narration) ? [{ narrate: str(raw.narration) }] : []), ...actors];
}

/** The Director's reply as a plan. One that isn't JSON still makes a turn:
 *  its text becomes the Narrator's brief, and the card's character acts. */
export function parsePlan(text: string, fallbackActor: string): DirectorPlan & { parsed: boolean } {
  const raw = extractJson(text) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') {
    const beats: Beat[] = [{ narrate: text.trim() }, ...(fallbackActor ? [{ name: fallbackActor, direction: '' }] : [])];
    return { beats, actors: actorsOf(beats), newCast: [], notes: '', parsed: false };
  }
  const s = raw.scene as Record<string, unknown> | undefined;
  const scene: SceneState | undefined =
    s && typeof s === 'object'
      ? {
          location: str(s.location),
          present: Array.isArray(s.present) ? s.present.map(str).filter(Boolean) : [],
          situation: str(s.situation),
          ...(str(s.time) ? { time: str(s.time) } : {}),
        }
      : undefined;
  const r = raw.roll as Record<string, unknown> | null | undefined;
  const dc = r && typeof r === 'object' ? Number(r.dc) : NaN;
  const mod = r && typeof r === 'object' ? Number(r.modifier) : NaN;
  const roll =
    r && typeof r === 'object' && (str(r.reason) || str(r.dice))
      ? { reason: str(r.reason), dice: str(r.dice) || '1d20', ...(Number.isFinite(dc) ? { dc } : {}), ...(Number.isFinite(mod) && mod ? { modifier: mod } : {}) }
      : null;
  const beats = parseBeats(raw);
  const newCast = (Array.isArray(raw.new_cast) ? raw.new_cast : Array.isArray(raw.newCast) ? raw.newCast : [])
    .map((c) => (typeof c === 'string' ? { name: c.trim(), text: '' } : c && typeof c === 'object' ? { name: str((c as Record<string, unknown>).name), text: str((c as Record<string, unknown>).text ?? (c as Record<string, unknown>).description) } : null))
    .filter((c): c is { name: string; text: string } => !!c?.name);
  return { scene, roll, beats, actors: actorsOf(beats), newCast, notes: str(raw.notes), parsed: true };
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

/** Everything a call is built from: the card, who you are, the world as this
 *  adventure has it, and how adventures run. */
export interface AdventureCtx {
  card: CardData;
  userName: string;
  persona: string;
  world: AdventureWorld;
  settings: AdventureSettings;
  dice: boolean;
  /** The card's lorebook, scanned against the story (null: left out). */
  lore: LoreDefaults | null;
}

const charName = (card: CardData) => card.nickname || card.name || 'Character';

/** Macro expansion ({{char}}, {{user}} and friends) for this card and you. */
function expander(ctx: AdventureCtx) {
  return macroExpander(ctx.card, [], { userName: ctx.userName || 'User', persona: ctx.persona }).x;
}

/** The story so far as a script, newest last, cut from the start to fit
 *  `budget` characters. Director entries are left out (only the Director
 *  sees its own notes, separately); a note to the Director is only for it. */
export function transcript(entries: AdventureEntry[], userName: string, budget: number, opts: { notes?: boolean } = {}): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    let line: string | null = null;
    if (e.kind === 'action') line = `[${userName}] ${e.text}`;
    else if (e.kind === 'narration') line = `[Narrator] ${e.text}`;
    else if (e.kind === 'character') line = `[${e.speaker ?? 'Character'}] ${e.text}`;
    else if (e.kind === 'roll' && e.roll) line = `[Dice] ${describeRoll(e.roll)}`;
    else if (e.kind === 'note' && opts.notes) line = `[${userName}, to the Director] ${e.text}`;
    if (!line || !e.text.trim()) continue;
    if (used + line.length > budget && lines.length) break;
    lines.push(line);
    used += line.length + 2;
  }
  return lines.reverse().join('\n\n');
}

/** The lorebook entries the recent story calls up. */
export function activeLore(ctx: AdventureCtx, entries: AdventureEntry[]): string[] {
  if (!ctx.lore) return [];
  const texts = entries.filter((e) => e.kind !== 'director' && e.text.trim()).map((e) => e.text);
  const x = expander(ctx);
  return scanLorebook(ctx.card.character_book, texts, { defaults: ctx.lore }).active.map((a) => x(a.entry.content)).filter(Boolean);
}

const bullets = (list: WorldEntry[], x: (t: string) => string) => list.map((e) => `- ${x(e.name)}: ${x(e.text)}`).join('\n');

function sceneText(scene: SceneState | undefined): string {
  if (!scene || !(scene.location || scene.situation || scene.present.length)) return '(not set yet)';
  return [scene.location && `Location: ${scene.location}`, scene.time && `Time: ${scene.time}`, scene.present.length && `Present: ${scene.present.join(', ')}`, scene.situation && `Situation: ${scene.situation}`]
    .filter(Boolean)
    .join('\n');
}

/** The shared context block every actor reads. */
function contextBlock(ctx: AdventureCtx, entries: AdventureEntry[], scene: SceneState | undefined, opts: { card?: boolean; notes?: boolean } = {}): string {
  const x = expander(ctx);
  const user = ctx.userName || 'User';
  const w = ctx.world;
  const lore = activeLore(ctx, entries);
  const card = ctx.card;
  const parts: string[] = [];
  if (opts.card !== false) {
    const about = [x(card.description), card.personality.trim() && `Personality: ${x(card.personality)}`, card.scenario.trim() && `Scenario: ${x(card.scenario)}`].filter(Boolean).join('\n\n');
    if (about) parts.push(`<card name="${charName(card)}">\n${about}\n</card>`);
  }
  const world = [w.settings.length && `## Settings\n${bullets(w.settings, x)}`, w.personae.length && `## Cast\n${bullets(w.personae, x)}`].filter(Boolean).join('\n\n');
  if (world) parts.push(`<world>\n${world}\n</world>`);
  if (lore.length) parts.push(`<lore>\n${lore.join('\n\n')}\n</lore>`);
  if (w.rules.trim()) parts.push(`<rules>\n${x(w.rules)}\n</rules>`);
  parts.push(`<player name="${user}">\n${x(ctx.persona) || `${user} is the player character.`}\n</player>`);
  parts.push(`<scene>\n${sceneText(scene)}\n</scene>`);
  parts.push(`<story_so_far>\n${transcript(entries, user, ctx.settings.historyBudget, { notes: opts.notes }) || '(nothing yet)'}\n</story_so_far>`);
  return parts.join('\n\n');
}

const povLine = (ctx: AdventureCtx) => {
  const user = ctx.userName || 'User';
  return ctx.settings.pov === 'second' ? `Address ${user} as "you" (second person).` : `Write in third person; ${user} is "${user}".`;
};
const styleLine = (ctx: AdventureCtx) => (ctx.settings.style.trim() ? `\nStyle: ${ctx.settings.style.trim()}` : '');

/** The Director's request: plan this turn, as JSON. */
export function directorMessages(ctx: AdventureCtx, entries: AdventureEntry[], scene: SceneState | undefined, opts: { notes?: string; directorNote?: string } = {}): LlmMessage[] {
  const user = ctx.userName || 'User';
  const dice = ctx.dice
    ? `Dice are on: when the outcome of what ${user} attempts is uncertain and matters, ask for a roll and the app rolls real dice. Don't roll for trivial things. Write the first narration brief for both results ("On success: … On failure: …").`
    : 'Dice are off: decide outcomes yourself, fairly, and set "roll" to null.';
  const system = `You are the Director, the game master of an interactive roleplay adventure. ${user} is the player character, controlled only by the human player. You don't write the story's prose: each turn you decide what happens and brief the actors who write it. The Narrator describes the scene and events; the Cast plays the other characters, one at a time.

Each turn, read the world, the scene and the latest events, then plan:
- How the world responds to ${user}'s latest action (or, if they did nothing, what happens next). Keep the story moving, give the other characters goals of their own, and keep it fair and consistent.
- ${dice}
- The turn as beats, in the order things happen. A "narrate" beat is a brief for the Narrator; an "actor" beat gives one character their part. Usually start with narration of what came of ${user}'s action.
- Only characters with something to add get a beat: a reply, a reaction, a move that matters. Being present isn't enough; often one does, sometimes none. At most ${ctx.settings.maxActors} character beats, only characters present, never ${user}.
- Let things happen in sequence: a character can answer what another just said or did, and a short narration beat can fall between characters when the scene moves on (not every time). Don't have the Narrator describe what a character will do on their own beat.
- Keep the rules (if any) and apply them consistently; keep track of anything they need in your notes.
- Anyone you bring into the story who isn't in the Cast yet (a new character, a named creature, someone the player meets) goes in "new_cast" with a short sheet, so they're played the same way from then on.

Reply with only a JSON object, no other text:
{
  "scene": {"location": "where", "time": "when", "present": ["everyone present, ${user} included"], "situation": "one or two sentences on what's going on now"},
  "roll": null or {"reason": "what is being attempted", "dice": "1d20", "dc": 12, "modifier": 0},
  "beats": [
    {"narrate": "the Narrator's brief: what happens, and what came of ${user}'s action"},
    {"actor": "a character's name", "direction": "what they do or want, in a few words"},
    {"narrate": "optional: what happens next, between characters"},
    {"actor": "another character", "direction": "e.g. answers the first one"}
  ],
  "new_cast": [{"name": "a newcomer's name", "text": "who they are, how they look, act and talk"}],
  "notes": "your private notes: plans, secrets, timers, and the rules' bookkeeping (items, HP, captured creatures…)"
}`;
  const parts = [contextBlock(ctx, entries, scene, { notes: true })];
  if (opts.notes?.trim()) parts.push(`<your_notes_so_far>\n${opts.notes.trim()}\n</your_notes_so_far>`);
  const last = entries.at(-1);
  const acted = last?.kind === 'action' || last?.kind === 'note';
  parts.push(
    opts.directorNote?.trim()
      ? `${user}'s player says to you, out of character: "${opts.directorNote.trim()}". Take it into account, then plan the next turn.`
      : acted
        ? `Plan the turn that answers ${user}'s latest action.`
        : `${user} waits and lets things unfold. Plan what happens next.`,
  );
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Where a beat falls in its turn: who acts later, and whether the turn's
 *  already under way. */
export interface BeatPlace {
  /** Characters with a beat later this turn. */
  upcoming?: string[];
  /** A beat after one of the characters'. */
  midTurn?: boolean;
}

/** The Narrator's request: the next passage, from the Director's brief. */
export function narratorMessages(ctx: AdventureCtx, entries: AdventureEntry[], scene: SceneState | undefined, brief: string, roll?: DiceRoll, place: BeatPlace = {}): LlmMessage[] {
  const user = ctx.userName || 'User';
  const upcoming = [...new Set(place.upcoming ?? [])];
  const system = `You are the Narrator of an interactive roleplay adventure. Write the next passage of the story: the setting, what happens and what came of ${user}'s latest action, following the Director's brief. ${povLine(ctx)}
- Never write ${user}'s dialogue, thoughts or choices beyond what the player wrote.
- The other characters speak and act for themselves, each on their own turn. ${upcoming.length ? `${upcoming.join(', ')} ${upcoming.length > 1 ? 'act' : 'acts'} right after this passage: don't write what they say or do, leave it to them.` : 'Keep to events and the world; give the characters at most a glance or a gesture.'}
- Don't retell what the story already shows; carry on from the latest moment.
- ${place.midTurn ? 'This passage falls between characters: keep it short, a few sentences on what happens next.' : 'One to three paragraphs.'} Prose only: no headings, labels or notes.${styleLine(ctx)}`;
  const rolled = roll ? `\n\nThe dice: ${describeRoll(roll)}. Narrate the ${roll.outcome ?? 'result'}${roll.critical ? ', and make it dramatic' : ''}.` : '';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${contextBlock(ctx, entries, scene)}\n\nThe Director's brief for this passage:\n${brief || 'Describe what happens next.'}${rolled}` },
  ];
}

/** Who a character is: their Cast entry, and the card itself
 *  for the card's own character. */
function characterSheet(ctx: AdventureCtx, name: string): string {
  const x = expander(ctx);
  const key = name.trim().toLowerCase();
  const entry = ctx.world.personae.find((p) => x(p.name).trim().toLowerCase() === key) ?? ctx.world.personae.find((p) => knownName(name, [x(p.name)]));
  const main = [ctx.card.name, ctx.card.nickname].some((n) => n?.trim().toLowerCase() === key);
  const parts = [entry && x(entry.text), main && x(ctx.card.description), main && ctx.card.personality.trim() && `Personality: ${x(ctx.card.personality)}`].filter(Boolean);
  return parts.length ? parts.join('\n\n') : `${name} isn't in the Cast yet: play them as the scene and story so far suggest, and keep them consistent.`;
}

/** One character's part of the turn. */
export function castMessages(ctx: AdventureCtx, entries: AdventureEntry[], scene: SceneState | undefined, actor: { name: string; direction: string }): LlmMessage[] {
  const user = ctx.userName || 'User';
  const system = `You are playing ${actor.name} in an interactive roleplay adventure. Write only ${actor.name}'s part of this turn: their dialogue, actions and body language, in character, reacting to what just happened. ${ctx.settings.pov === 'second' ? `Address ${user} as "you" in narration.` : `Write in third person.`}
- Never speak, act or decide for ${user}, and don't play the other characters.
- Carry on from the latest moment: answer what was just said or done, by anyone. If the story already shows ${actor.name} doing something, don't do it again.
- One to three short paragraphs. No headings, and don't start with your name.${styleLine(ctx)}`;
  const direction = actor.direction ? `\n\nThe Director's direction for ${actor.name} this turn: ${actor.direction}` : '';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `<character name="${actor.name}">\n${characterSheet(ctx, actor.name)}\n</character>\n\n${contextBlock(ctx, entries, scene, { card: false })}${direction}\n\nWrite ${actor.name}'s part now.` },
  ];
}

/** A bespoke opening, written by the Director. */
export function openingMessages(ctx: AdventureCtx, opts: { prompt?: string; greeting?: string }): LlmMessage[] {
  const user = ctx.userName || 'User';
  const x = expander(ctx);
  const system = `You are the Director, the game master of an interactive roleplay adventure, and you're opening a new one. Write its first scene: set the place and the situation, bring in who's there, and end on a moment that invites ${user} to act. ${povLine(ctx)} Never act, speak or decide for ${user}. Two to four paragraphs of prose, nothing else.${styleLine(ctx)}`;
  const parts = [contextBlock(ctx, [], undefined)];
  if (opts.greeting?.trim()) parts.push(`Build on the card's greeting, but make the scene your own:\n<greeting>\n${x(opts.greeting)}\n</greeting>`);
  if (opts.prompt?.trim()) parts.push(`The player asked for: ${opts.prompt.trim()}`);
  parts.push('Write the opening scene now.');
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

const SCOUT_BUDGET = 60000;

/** The Scout's request: the card's settings, characters and rules, as JSON. */
export function scoutMessages(card: CardData): LlmMessage[] {
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
  const lore = (card.character_book?.entries ?? [])
    .filter((e) => e.enabled !== false && e.content.trim())
    .map((e) => `### ${e.name || e.comment || e.keys.join(', ') || 'Entry'}\n${clip(e.content.trim(), 3000)}`);
  let loreText = '';
  for (const l of lore) {
    if (loreText.length + l.length > SCOUT_BUDGET) break;
    loreText += `${l}\n\n`;
  }
  const field = (label: string, t: string) => (t?.trim() ? `## ${label}\n${clip(t.trim(), 12000)}` : '');
  const source = [
    `# ${card.name || 'Character'}`,
    field('Description', card.description),
    field('Personality', card.personality),
    field('Scenario', card.scenario),
    field('First message', card.first_mes),
    field('Example dialogue', card.mes_example),
    loreText && `## Lorebook\n${loreText.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const system = `You read character cards (for roleplay) and their lorebooks, and list what an adventure set in them needs. {{user}} is the player: never list them.

Reply with only a JSON object, no other text:
{
  "settings": [{"name": "a place, faction, organization, item of note or world fact", "text": "a few sentences on it"}],
  "personae": [{"name": "a character's name", "text": "who they are, how they look, act and talk, and how they relate to {{user}}"}],
  "rules": "any game-like rules or mechanics the card describes, as a short list; empty if none"
}
List the card's own character first in personae. Keep each text to a few sentences, faithful to the source, in plain prose. Use {{user}} for the player and the characters' own names otherwise.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: source },
  ];
}

/** The Scout's reply as entries (null if it isn't the JSON asked for). */
export function parseScout(text: string): Pick<AdventureWorld, 'settings' | 'personae' | 'rules'> | null {
  const raw = extractJson(text) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  const list = (v: unknown): WorldEntry[] =>
    (Array.isArray(v) ? v : [])
      .map((e) => (e && typeof e === 'object' ? { id: uuid(), name: str((e as Record<string, unknown>).name), text: str((e as Record<string, unknown>).text ?? (e as Record<string, unknown>).description) } : null))
      .filter((e): e is WorldEntry => !!e?.name);
  const rules = Array.isArray(raw.rules) ? raw.rules.map(str).filter(Boolean).map((r) => `- ${r}`).join('\n') : str(raw.rules);
  return { settings: list(raw.settings), personae: list(raw.personae), rules };
}

// ─── A turn ──────────────────────────────────────────────────────────────────

const nameKey = (n: string) => n.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Whether `name` is someone already known: the same name, or one with a
 *  title or a surname more or less ("Captain Vex" is Vex). */
export function knownName(name: string, known: string[]): boolean {
  const k = nameKey(name);
  if (!k) return true;
  return known.some((n) => {
    const m = nameKey(n);
    return !!m && (m === k || ` ${m} `.includes(` ${k} `) || ` ${k} `.includes(` ${m} `));
  });
}

/** The characters a plan brings in who aren't in the Cast (nor you, nor the
 *  card's character): the Director's newcomers, and anyone acting this
 *  turn without a sheet. */
export function newCastFrom(plan: Pick<DirectorPlan, 'newCast' | 'actors'>, ctx: AdventureCtx, turn: number): WorldEntry[] {
  const x = expander(ctx);
  const known = [ctx.userName || 'User', ctx.card.name, ctx.card.nickname ?? '', ...ctx.world.personae.map((p) => x(p.name))];
  const found: WorldEntry[] = [];
  const consider = (name: string, text: string) => {
    if (knownName(name, [...known, ...found.map((f) => f.name)])) return;
    found.push({ id: uuid(), name: name.trim(), text: text.trim() || `Came into the story in turn ${turn}.` });
  };
  for (const c of plan.newCast) consider(c.name, c.text);
  for (const a of plan.actors) consider(a.name, a.direction ? `Came into the story in turn ${turn}: ${a.direction}.` : '');
  return found;
}

export interface ActorResult {
  text: string;
  usage?: CallUsage;
  error?: string;
}

export interface TurnDeps {
  /** One model call for `actor`, streaming its text to onText. */
  call: (actor: ActorId, label: string, messages: LlmMessage[], onText?: (text: string) => void) => Promise<ActorResult>;
  /** The story as it grows (each new entry, and as each streams in). */
  onChange: (entries: AdventureEntry[], scene: SceneState | undefined) => void;
  random?: () => number;
  now?: () => number;
  /** Stops before the next call once aborted. */
  signal?: AbortSignal;
}

export interface TurnInput {
  ctx: AdventureCtx;
  session: Pick<AdventureSession, 'entries' | 'scene'>;
  /** What you do or say (empty: let things unfold). */
  action?: string;
  /** Said to the Director, out of character, instead. */
  toDirector?: boolean;
  /** Redo: the turn's action is already there. */
  redo?: boolean;
  /** The turn's number (a redo plays its turn again); the next by default. */
  turn?: number;
}

export const nextTurn = (entries: AdventureEntry[]) => entries.reduce((n, e) => Math.max(n, e.turn), 0) + 1;

/** The latest notes the Director kept. */
export function directorNotes(entries: AdventureEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].kind === 'director') return (entries[i].text.match(/\nNotes: ([\s\S]*)$/)?.[1] ?? '').trim();
  return '';
}

/** How a plan reads, folded under the turn. */
export function planText(plan: DirectorPlan): string {
  const lines = plan.beats.length ? plan.beats.map((b, i) => `${i + 1}. ${isNarration(b) ? `Narrator: ${b.narrate}` : b.direction ? `${b.name}: ${b.direction}` : b.name}`) : ['(no beats)'];
  if (plan.roll) lines.push(`Roll: ${plan.roll.reason || 'yes'} (${plan.roll.dice}${plan.roll.dc !== undefined ? ` vs ${plan.roll.dc}` : ''})`);
  if (plan.notes) lines.push(`Notes: ${plan.notes}`);
  return lines.join('\n');
}

/** The beats a turn plays: never you, at most `maxActors` characters and one
 *  more narration than that (back-to-back narration runs as one), and a
 *  passage of narration when the plan has nothing at all. */
export function turnBeats(plan: Pick<DirectorPlan, 'beats'>, maxActors: number, userName: string): Beat[] {
  const userKey = userName.trim().toLowerCase();
  const max = Math.max(0, maxActors);
  const out: Beat[] = [];
  let acting = 0;
  let narrating = 0;
  for (const b of plan.beats) {
    if (isNarration(b)) {
      const last = out.at(-1);
      if (last && isNarration(last)) out[out.length - 1] = { narrate: `${last.narrate}\n${b.narrate}` };
      else if (narrating < max + 1) {
        out.push(b);
        narrating++;
      }
    } else if (b.name.trim().toLowerCase() !== userKey && acting < max) {
      out.push(b);
      acting++;
    }
  }
  return out.length ? out : [{ narrate: '' }];
}

export interface TurnResult {
  entries: AdventureEntry[];
  scene: SceneState | undefined;
  /** Newcomers to the Cast, for the adventure to keep. */
  newCast: WorldEntry[];
  error?: string;
}

/**
 * Plays one turn: your action (if any), the Director's plan, a roll, then
 * the beats in order (narration and characters, interleaved), adding each
 * to the story as it comes. An error or a stop leaves what was written so far.
 */
export async function runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnResult> {
  let { ctx } = input;
  let newCast: WorldEntry[] = [];
  const now = deps.now ?? Date.now;
  let entries = [...input.session.entries];
  let scene = input.session.scene;
  const sceneBefore = scene;
  const user = ctx.userName || 'User';
  const turn = input.turn ?? nextTurn(entries);
  const add = (e: Omit<AdventureEntry, 'id' | 'turn' | 'createdAt'>) => {
    const entry: AdventureEntry = { id: uuid(), turn, createdAt: now(), ...e };
    entries = [...entries, entry];
    deps.onChange(entries, scene);
    return entry.id;
  };
  const patch = (id: string, change: Partial<AdventureEntry>) => {
    entries = entries.map((e) => (e.id === id ? { ...e, ...change } : e));
    deps.onChange(entries, scene);
  };
  const stopped = () => deps.signal?.aborted === true;

  const action = input.action?.trim() ?? '';
  if (action && !input.redo) add(input.toDirector ? { kind: 'note', text: action } : { kind: 'action', speaker: user, text: action });
  const directorNote = input.toDirector ? action : entries.filter((e) => e.turn === turn && e.kind === 'note').at(-1)?.text;

  // 1. The Director plans.
  const notes = directorNotes(entries);
  const d = await deps.call('director', '🎬 Director', directorMessages(ctx, entries, scene, { notes, directorNote }));
  if (stopped()) return { entries, scene, newCast };
  if (d.error || !d.text.trim()) return { entries, scene, newCast, error: d.error ?? 'The Director sent nothing back.' };
  const plan = parsePlan(d.text, charName(ctx.card));
  if (plan.scene) scene = plan.scene;
  add({ kind: 'director', text: planText(plan) + (plan.parsed ? '' : '\n(The plan wasn\'t JSON: its text went to the Narrator as the brief.)'), sceneBefore: sceneBefore ?? { location: '', present: [], situation: '' }, usage: d.usage });
  const beats = turnBeats(plan, ctx.settings.maxActors, user);
  const actors = actorsOf(beats);
  if (ctx.settings.autoCast !== false) {
    newCast = newCastFrom({ newCast: plan.newCast, actors }, ctx, turn);
    if (newCast.length) {
      ctx = { ...ctx, world: { ...ctx.world, personae: [...ctx.world.personae, ...newCast] } };
      add({ kind: 'cast', text: `New in the Cast: ${newCast.map((c) => c.name).join(', ')}` });
    }
  }
  if (stopped()) return { entries, scene, newCast };

  // 2. Dice.
  let roll: DiceRoll | undefined;
  if (ctx.dice && plan.roll) {
    const r = rollDice(plan.roll.dice, deps.random, plan.roll.modifier ?? 0);
    roll = { reason: plan.roll.reason, ...r, ...judgeRoll(r, plan.roll.dc) };
    add({ kind: 'roll', speaker: user, text: describeRoll(roll), roll });
  }

  // 3. The beats in order: narration and each character, one call each,
  // every one seeing what came before it this turn.
  let rolled = false;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    const later = beats.slice(i + 1).filter((x) => !isNarration(x)).map((x) => (x as { name: string }).name);
    const midTurn = beats.slice(0, i).some((x) => !isNarration(x));
    const narrating = isNarration(b);
    const id = add(narrating ? { kind: 'narration', text: '' } : { kind: 'character', speaker: b.name, text: '' });
    const before = entries.filter((e) => e.id !== id);
    const r = narrating
      ? await deps.call('narrator', '📜 Narrator', narratorMessages(ctx, before, scene, b.narrate, rolled ? undefined : roll, { upcoming: later, midTurn }), (t) => patch(id, { text: t }))
      : await deps.call('cast', `🎭 ${b.name}`, castMessages(ctx, before, scene, b), (t) => patch(id, { text: t }));
    if (narrating) rolled = true;
    patch(id, { text: r.text.trim(), usage: r.usage });
    if (r.error) return { entries: entries.filter((e) => e.id !== id || e.text), scene, newCast, error: r.error };
    if (stopped()) return { entries, scene, newCast };
  }
  return { entries, scene, newCast };
}

/** The latest turn's entries gone, but for what you did (to play it again),
 *  and the scene as it was before it. */
export function undoLastTurn(session: Pick<AdventureSession, 'entries' | 'scene'>): Pick<AdventureSession, 'entries' | 'scene'> {
  const last = session.entries.reduce((n, e) => Math.max(n, e.turn), 0);
  if (last === 0) return session;
  const director = session.entries.find((e) => e.turn === last && e.kind === 'director');
  const before = director?.sceneBefore;
  return {
    entries: session.entries.filter((e) => e.turn !== last || e.kind === 'action' || e.kind === 'note'),
    scene: before && (before.location || before.situation || before.present.length) ? before : director ? undefined : session.scene,
  };
}

// ─── Costs ───────────────────────────────────────────────────────────────────

export interface UsageTally {
  calls: number;
  input: number;
  output: number;
  /** Dollars, for the calls whose price is known. */
  dollars: number;
  /** Some calls' cost isn't known (not OpenRouter, or no price). */
  unpriced: number;
  estimated: boolean;
}

export function tallyUsage(usages: (CallUsage | undefined)[]): UsageTally {
  const t: UsageTally = { calls: 0, input: 0, output: 0, dollars: 0, unpriced: 0, estimated: false };
  for (const u of usages) {
    if (!u) continue;
    t.calls++;
    t.input += u.input;
    t.output += u.output;
    if (u.dollars === undefined) t.unpriced++;
    else t.dollars += u.dollars;
    if (u.estimated) t.estimated = true;
  }
  return t;
}

/** How many calls a turn makes, at most: the Director, the Narrator, and one
 *  per acting character. */
/** The most calls a turn makes: the Director, each character and a passage
 *  of narration around each. */
export const callsPerTurn = (s: Pick<AdventureSettings, 'maxActors'>) => 2 + 2 * Math.max(0, s.maxActors);
