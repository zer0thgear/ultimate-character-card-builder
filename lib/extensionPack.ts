import { DEFAULT_TEMPLATES } from '@/lib/assist';
import { ADVENTURE_DEFAULT_PROMPTS } from '@/lib/adventure';
import { emptyLayer, type LoreLengthOption, type LoreSizeOption, type PackActor, type PackLayer } from '@/lib/packLayer';

// Extension packs: shareable add-ons that change what the app asks the
// model and what its wizards offer, without code. A pack is one JSON file
// (a manifest and what it contributes); installing it keeps it in
// data/packs/, and its contributions are laid between the built-ins and
// your own edits (lib/packLayer.ts), so turning it off or uninstalling it
// takes them away cleanly. docs/EXTENSIONS.md is the authoring guide.

export const PACK_FORMAT = 1;
/** The largest pack accepted, as JSON. */
export const MAX_PACK_BYTES = 1_000_000;
const MAX_TEXT = 50_000;
const MAX_ITEMS = 100;
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export interface PackContributions {
  /** Writing-assistant prompts to use instead of the built-in ones, by key
   *  (the keys in lib/assist.ts ASSIST_TEMPLATES, e.g. "field.system",
   *  "loreWizard.planner"). */
  templates?: Record<string, string>;
  /** Adventure mode's actor prompts, by key ("director", "narrator", "cast",
   *  "opening", "scout"). */
  adventurePrompts?: Record<string, string>;
  /** More choices in the lorebook wizard's brief. */
  loreWizard?: {
    focus?: string[];
    sizes?: LoreSizeOption[];
    lengths?: LoreLengthOption[];
  };
  /** Adventure actors offered under ⚙ Actors → Start from. */
  adventureActors?: Omit<PackActor, 'from'>[];
  /** World rules offered under 🌍 World → Rules. */
  ruleExamples?: { label: string; text: string }[];
}

export interface ExtensionPack {
  /** The pack format (1). */
  uccb: number;
  /** Letters, digits, - and _. Installing a pack with an id that's already
   *  installed updates it. */
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  /** Where to find out more (a link). */
  homepage?: string;
  contributes: PackContributions;
}

/** A pack as installed. */
export interface InstalledPack {
  pack: ExtensionPack;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}

export class PackError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = MAX_TEXT): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);

/**
 * Reads a pack (parsed JSON) and checks it: a clean copy with only what the
 * app understands, and warnings for what was left out (an unknown prompt
 * key, say). Throws PackError when it can't be a pack at all.
 */
export function validatePack(raw: unknown): { pack: ExtensionPack; warnings: string[] } {
  if (!isObj(raw)) throw new PackError("That isn't an extension pack (expected a JSON object).");
  if (raw.uccb === undefined) throw new PackError('That isn\'t an extension pack: it has no "uccb" format number.');
  if (raw.uccb !== PACK_FORMAT) throw new PackError(`This pack is for a newer version of UCCB (format ${String(raw.uccb)}; this one reads format ${PACK_FORMAT}).`);
  const id = str(raw.id, 100);
  if (!id || !ID_RE.test(id)) throw new PackError('A pack needs an "id" of up to 64 letters, digits, - and _.');
  const name = str(raw.name, 100)?.trim();
  if (!name) throw new PackError('A pack needs a "name".');
  const warnings: string[] = [];
  const c = isObj(raw.contributes) ? raw.contributes : {};
  if (!isObj(raw.contributes)) warnings.push('It has no "contributes" section.');

  const prompts = (v: unknown, known: Record<string, string>, label: string): Record<string, string> | undefined => {
    if (v === undefined) return undefined;
    if (!isObj(v)) {
      warnings.push(`"${label}" should be an object of prompt keys; left out.`);
      return undefined;
    }
    const out: Record<string, string> = {};
    for (const [k, text] of Object.entries(v)) {
      if (!Object.hasOwn(known, k)) warnings.push(`Unknown ${label} key "${k}"; left out.`);
      else if (typeof text !== 'string') warnings.push(`${label} "${k}" isn't text; left out.`);
      else out[k] = text.slice(0, MAX_TEXT);
    }
    return Object.keys(out).length ? out : undefined;
  };

  const list = <T>(v: unknown, label: string, read: (x: Record<string, unknown>) => T | undefined): T[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) {
      warnings.push(`"${label}" should be a list; left out.`);
      return undefined;
    }
    const out: T[] = [];
    v.slice(0, MAX_ITEMS).forEach((x, i) => {
      const item = isObj(x) ? read(x) : undefined;
      if (item === undefined) warnings.push(`${label} #${i + 1} is missing something it needs; left out.`);
      else out.push(item);
    });
    if (v.length > MAX_ITEMS) warnings.push(`Only the first ${MAX_ITEMS} ${label} were kept.`);
    return out.length ? out : undefined;
  };

  const contributes: PackContributions = {};
  const templates = prompts(c.templates, DEFAULT_TEMPLATES, 'templates');
  if (templates) contributes.templates = templates;
  const adventurePrompts = prompts(c.adventurePrompts, ADVENTURE_DEFAULT_PROMPTS, 'adventurePrompts');
  if (adventurePrompts) contributes.adventurePrompts = adventurePrompts;

  if (c.loreWizard !== undefined) {
    const lw = isObj(c.loreWizard) ? c.loreWizard : {};
    const focus = Array.isArray(lw.focus) ? lw.focus.map((f) => str(f, 60)?.trim()).filter((f): f is string => !!f).slice(0, MAX_ITEMS) : undefined;
    const sizes = list(lw.sizes, 'loreWizard sizes', (x) => {
      const sid = str(x.id, 64)?.trim();
      const label = str(x.label, 80)?.trim();
      const count = typeof x.count === 'number' && Number.isFinite(x.count) ? Math.round(x.count) : NaN;
      return sid && label && count >= 1 && count <= 200 ? { id: sid, label, count } : undefined;
    });
    const lengths = list(lw.lengths, 'loreWizard lengths', (x) => {
      const lid = str(x.id, 64)?.trim();
      const label = str(x.label, 80)?.trim();
      const text = str(x.text, 200)?.trim();
      return lid && label && text ? { id: lid, label, text } : undefined;
    });
    const out: NonNullable<PackContributions['loreWizard']> = {};
    if (focus?.length) out.focus = focus;
    if (sizes) out.sizes = sizes;
    if (lengths) out.lengths = lengths;
    if (Object.keys(out).length) contributes.loreWizard = out;
  }

  const actors = list(c.adventureActors, 'adventureActors', (x) => {
    const n = str(x.name, 80)?.trim();
    const prompt = str(x.prompt);
    if (!n || !prompt?.trim()) return undefined;
    return {
      name: n,
      icon: str(x.icon, 16) || '✦',
      about: str(x.about, 500) ?? '',
      prompt,
      brief: str(x.brief, 500) ?? '',
      when: x.when === 'before' ? ('before' as const) : ('after' as const),
      ...(x.private === true ? { private: true } : {}),
    };
  });
  if (actors) contributes.adventureActors = actors;

  const rules = list(c.ruleExamples, 'ruleExamples', (x) => {
    const label = str(x.label, 80)?.trim();
    const text = str(x.text);
    return label && text?.trim() ? { label, text } : undefined;
  });
  if (rules) contributes.ruleExamples = rules;

  if (!Object.keys(contributes).length) warnings.push("It doesn't add anything this version of UCCB understands.");

  const pack: ExtensionPack = {
    uccb: PACK_FORMAT,
    id,
    name,
    version: str(raw.version, 40)?.trim() || '1.0.0',
    ...(str(raw.author, 100)?.trim() ? { author: str(raw.author, 100)!.trim() } : {}),
    ...(str(raw.description, 2000)?.trim() ? { description: str(raw.description, 2000)!.trim() } : {}),
    ...(/^https?:\/\//.test(str(raw.homepage, 500) ?? '') ? { homepage: str(raw.homepage, 500) } : {}),
    contributes,
  };
  return { pack, warnings };
}

/** Reads a pack file's text (JSON). */
export function parsePack(text: string): { pack: ExtensionPack; warnings: string[] } {
  if (new TextEncoder().encode(text).length > MAX_PACK_BYTES) throw new PackError(`That pack is too big (over ${MAX_PACK_BYTES / 1_000_000} MB).`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PackError("That isn't valid JSON.");
  }
  return validatePack(raw);
}

/** What a pack adds, in a few words each ("3 prompts", "2 focus chips"). */
export function describeContributions(c: PackContributions): string[] {
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const out: string[] = [];
  const t = Object.keys(c.templates ?? {}).length;
  if (t) out.push(n(t, 'assistant prompt'));
  const a = Object.keys(c.adventurePrompts ?? {}).length;
  if (a) out.push(n(a, 'Adventure prompt'));
  if (c.loreWizard?.focus?.length) out.push(n(c.loreWizard.focus.length, 'lorebook wizard focus chip'));
  if (c.loreWizard?.sizes?.length) out.push(n(c.loreWizard.sizes.length, 'lorebook wizard size'));
  if (c.loreWizard?.lengths?.length) out.push(n(c.loreWizard.lengths.length, 'lorebook wizard entry length'));
  if (c.adventureActors?.length) out.push(n(c.adventureActors.length, 'Adventure actor'));
  if (c.ruleExamples?.length) out.push(n(c.ruleExamples.length, 'Adventure rule example'));
  return out;
}

/**
 * The enabled packs merged into one layer (lib/packLayer.ts). Packs are
 * laid on in the order they were installed, so where two change the same
 * prompt, the one installed later wins; lists are added up.
 */
export function buildLayer(installed: InstalledPack[]): PackLayer {
  const layer = emptyLayer();
  const on = installed.filter((p) => p.enabled).sort((a, b) => a.installedAt - b.installedAt);
  for (const { pack } of on) {
    const from = pack.name;
    const c = pack.contributes;
    for (const [k, text] of Object.entries(c.templates ?? {})) layer.templates[k] = { text, from };
    for (const [k, text] of Object.entries(c.adventurePrompts ?? {})) layer.adventurePrompts[k] = { text, from };
    for (const f of c.loreWizard?.focus ?? []) if (!layer.loreFocus.includes(f)) layer.loreFocus.push(f);
    // Ids are made the pack's own so two packs' "huge" don't collide.
    for (const s of c.loreWizard?.sizes ?? []) layer.loreSizes.push({ ...s, id: `${pack.id}:${s.id}` });
    for (const l of c.loreWizard?.lengths ?? []) layer.loreLengths.push({ ...l, id: `${pack.id}:${l.id}` });
    for (const a of c.adventureActors ?? []) layer.actors.push({ ...a, from });
    for (const r of c.ruleExamples ?? []) layer.ruleExamples.push({ ...r, from });
  }
  return layer;
}

/** Which installed packs change a prompt another enabled pack also changes,
 *  for a note in Settings → Extensions. */
export function packConflicts(installed: InstalledPack[]): Record<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const { pack, enabled } of installed) {
    if (!enabled) continue;
    for (const k of Object.keys(pack.contributes.templates ?? {})) byKey.set(`t:${k}`, [...(byKey.get(`t:${k}`) ?? []), pack.id]);
    for (const k of Object.keys(pack.contributes.adventurePrompts ?? {})) byKey.set(`a:${k}`, [...(byKey.get(`a:${k}`) ?? []), pack.id]);
  }
  const out: Record<string, string[]> = {};
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) out[id] = [...new Set([...(out[id] ?? []), ...ids.filter((x) => x !== id)])];
  }
  return out;
}

/** A pack id from a name ("Gritty noir" → "gritty-noir"). */
export const packIdFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'my-pack';

/**
 * Your own prompt edits (Settings → Assistant, and ⚙ Actors in Adventure
 * mode) and your Adventure actors as a pack, to share.
 */
export function packFromEdits(
  meta: { name: string; id?: string; version?: string; author?: string; description?: string },
  edits: { templates?: Record<string, string>; adventurePrompts?: Record<string, string>; actors?: Omit<PackActor, 'from'>[] },
): ExtensionPack {
  const pick = (from: Record<string, string> | undefined, known: Record<string, string>) => {
    const out = Object.fromEntries(Object.entries(from ?? {}).filter(([k, v]) => Object.hasOwn(known, k) && v !== known[k]));
    return Object.keys(out).length ? out : undefined;
  };
  const templates = pick(edits.templates, DEFAULT_TEMPLATES);
  const adventurePrompts = pick(edits.adventurePrompts, ADVENTURE_DEFAULT_PROMPTS);
  const actors = (edits.actors ?? []).filter((a) => a.name.trim() && a.prompt.trim()).map(({ name, icon, about, prompt, brief, when, private: p }) => ({ name, icon, about, prompt, brief, when, ...(p ? { private: true } : {}) }));
  return {
    uccb: PACK_FORMAT,
    id: meta.id?.trim() || packIdFrom(meta.name),
    name: meta.name.trim() || 'My pack',
    version: meta.version?.trim() || '1.0.0',
    ...(meta.author?.trim() ? { author: meta.author.trim() } : {}),
    ...(meta.description?.trim() ? { description: meta.description.trim() } : {}),
    contributes: {
      ...(templates ? { templates } : {}),
      ...(adventurePrompts ? { adventurePrompts } : {}),
      ...(actors.length ? { adventureActors: actors } : {}),
    },
  };
}

/** A pack as a file to share. */
export const packFileName = (pack: ExtensionPack) => `${pack.id}.uccb.json`;
export const packJson = (pack: ExtensionPack) => JSON.stringify(pack, null, 2);
