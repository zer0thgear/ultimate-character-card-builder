// The macros frontends replace in card and preset text before it reaches
// the model, the SillyTavern set most cards and presets are written against:
//   {{char}} {{user}} <BOT> <USER>   names
//   {{original}}                     (system prompt/PHI only) the default it replaces
//   {{description}} {{personality}} {{scenario}} {{persona}} {{mesExamples}}
//   {{lastMessage}} {{lastChatMessage}} {{lastUserMessage}} {{lastCharMessage}}
//   {{model}}
//   {{random:a,b,c}} {{random::a::b}} one option, rolled each time
//   {{pick:a,b}} {{pick::a::b}}      one option, stable for the same text
//   {{roll:d20}} {{roll:2d6}}        dice
//   {{setvar::name::value}} {{getvar::name}} {{addvar::name::n}}
//   {{incvar::name}} {{decvar::name}} {{setglobalvar…}} (same, one store)
//   {{time}} {{date}} {{weekday}} {{isotime}} {{isodate}} {{idle_duration}}
//   {{newline}} {{// comment}} {{trim}} {{noop}}
//   {{wiBefore}} {{wiAfter}}         the lorebook entries placed before/after the character
//   {{#if x}}…{{else}}…{{/if}}       conditional text (also {{#unless x}}, and
//                                    {{if x}} without the #); see ifBlocks below

export interface MacroContext {
  char: string;
  user: string;
  /** What {{original}} stands for in the field being expanded. */
  original?: string;
  /** Card and persona fields for {{description}} and friends. */
  fields?: Partial<Record<'description' | 'personality' | 'scenario' | 'persona' | 'mesExamples' | 'wiBefore' | 'wiAfter', string>>;
  /** The chat so far, for {{lastUserMessage}} and friends. */
  chat?: { last?: string; lastUser?: string; lastChar?: string };
  model?: string;
  /** Variables for {{setvar}}/{{getvar}}. Share one map across a whole
   *  prompt build so a preset's earlier prompts can set what later ones read. */
  vars?: Map<string, string>;
  now?: Date;
  /** Seeded roll for {{random}} (tests pass a fixed one). */
  random?: () => number;
}

/** A macro's arguments: `::`-separated when it starts with `:` (so they can
 *  hold commas), else `,`-separated. */
function options(body: string): string[] {
  const parts = body.startsWith(':') ? body.slice(1).split('::') : body.split(',');
  return parts.map((s) => s.trim());
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function roll(spec: string, random: () => number): string {
  const m = spec.trim().replace(/^:+/, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return spec;
  const count = Math.min(100, Number(m[1] || 1));
  const sides = Math.max(1, Number(m[2]));
  let total = Number(m[3] || 0);
  for (let i = 0; i < count; i++) total += 1 + Math.floor(random() * sides);
  return String(total);
}

const TRIM = '\u0000TRIM\u0000';

export function expandMacros(text: string, ctx: MacroContext): string {
  if (!text) return text;
  const random = ctx.random ?? Math.random;
  const now = ctx.now ?? new Date();
  const vars = ctx.vars ?? new Map<string, string>();
  let pickIndex = 0;
  const num = (v: string | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const one = (whole: string, name: string, arg?: string): string => {
    const n = name.toLowerCase();
    switch (n) {
      case 'char':
        return ctx.char;
      case 'user':
        return ctx.user;
      case 'original':
        return ctx.original ?? '';
      case 'description':
      case 'personality':
      case 'scenario':
      case 'persona':
        return ctx.fields?.[n] ?? '';
      case 'mesexamples':
      case 'mesexamplesraw':
        return ctx.fields?.mesExamples ?? '';
      case 'wibefore':
      case 'lorebefore':
      case 'worldinfobefore':
        return ctx.fields?.wiBefore ?? '';
      case 'wiafter':
      case 'loreafter':
      case 'worldinfoafter':
        return ctx.fields?.wiAfter ?? '';
      case 'lastmessage':
      case 'lastchatmessage':
        return ctx.chat?.last ?? '';
      case 'lastusermessage':
        return ctx.chat?.lastUser ?? '';
      case 'lastcharmessage':
        return ctx.chat?.lastChar ?? '';
      case 'model':
        return ctx.model ?? '';
      case 'newline':
        return '\n';
      case 'noop':
        return '';
      case 'time':
        return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      case 'date':
        return now.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
      case 'weekday':
        return now.toLocaleDateString([], { weekday: 'long' });
      case 'isotime':
        return now.toTimeString().slice(0, 5);
      case 'isodate':
        return now.toISOString().slice(0, 10);
      case 'idle_duration':
        return 'just now';
      case 'random': {
        if (arg === undefined) return whole;
        const opts = options(arg);
        return opts[Math.floor(random() * opts.length)] ?? '';
      }
      case 'pick': {
        if (arg === undefined) return whole;
        const opts = options(arg);
        return opts[(hash(text) + pickIndex++) % opts.length] ?? '';
      }
      case 'roll':
        return arg === undefined ? whole : roll(arg, random);
      case 'setvar':
      case 'setglobalvar': {
        const [key, ...rest] = options(arg ?? '');
        if (key) vars.set(key, rest.join('::'));
        return '';
      }
      case 'getvar':
      case 'getglobalvar':
        return vars.get(options(arg ?? '')[0]) ?? '';
      case 'addvar':
      case 'addglobalvar': {
        const [key, value = ''] = options(arg ?? '');
        const cur = vars.get(key) ?? '';
        // Numbers add; anything else appends, as SillyTavern does.
        vars.set(key, cur !== '' && Number.isFinite(Number(cur)) && Number.isFinite(Number(value)) ? String(num(cur) + num(value)) : cur + value);
        return '';
      }
      case 'incvar':
      case 'incglobalvar': {
        const key = options(arg ?? '')[0];
        const next = String(num(vars.get(key)) + 1);
        vars.set(key, next);
        return next;
      }
      case 'decvar':
      case 'decglobalvar': {
        const key = options(arg ?? '')[0];
        const next = String(num(vars.get(key)) - 1);
        vars.set(key, next);
        return next;
      }
      case 'trim':
        return TRIM;
      default:
        return whole;
    }
  };

  /** Every other macro, innermost first, so {{getvar::{{random::a::b}}}} and
   *  the like resolve; a few passes cover nesting without looping forever
   *  on unknown macros. */
  const plain = (t: string) => {
    let out = t;
    for (let pass = 0; pass < 5; pass++) {
      const next = out.replace(/\{\{([\w]+)(?::((?:(?!\{\{|\}\})[\s\S])*?))?\}\}/g, (whole, name: string, arg?: string) => one(whole, name, arg));
      if (next === out) break;
      out = next;
    }
    return out;
  };

  /** A condition's value: a macro ({{description}}, {{getvar::x}}…), or
   *  failing that a variable of that name. */
  const truthy = (cond: string) => {
    const negate = cond.startsWith('!');
    const name = cond.slice(negate ? 1 : 0).trim();
    let value = plain(`{{${name}}}`);
    if (value === `{{${name}}}`) value = vars.get(name) ?? '';
    const v = value.trim();
    const yes = v !== '' && !/^(false|0)$/i.test(v);
    return negate ? !yes : yes;
  };

  // In reading order, so a {{setvar}} before an {{#if}} counts for it, and
  // one inside a block that isn't taken never runs.
  const render = (nodes: IfNode[]): string =>
    nodes.map((n) => (typeof n === 'string' ? plain(n) : render(n.kind === 'unless' ? (truthy(n.cond) ? n.otherwise : n.then) : truthy(n.cond) ? n.then : n.otherwise))).join('');

  const stripped = text.replace(/\{\{\/\/[\s\S]*?\}\}/g, '').replace(/<BOT>/gi, ctx.char).replace(/<USER>/gi, ctx.user);
  let out = render(ifBlocks(stripped));
  if (out.includes(TRIM)) out = out.replace(/\s*\u0000TRIM\u0000\s*/g, '');
  return out;
}

// ─── {{#if}} blocks ──────────────────────────────────────────────────────────
// SillyTavern's conditionals (Handlebars-style, as in its story strings and
// presets): {{#if x}}…{{/if}}, with {{else}}, {{#unless x}}, nesting, and
// {{if x}} / {{/if}} without the #. The condition is a macro name
// (description, personality, scenario, persona, mesExamples, wiBefore,
// wiAfter, char, user…), a macro with arguments (getvar::mood), or a
// variable's name, optionally with ! in front. It's true when that isn't
// empty, "false" or "0". As in Handlebars, a tag on a line of its own takes
// the line with it, so a block that's left out leaves no blank lines.

type IfNode = string | { kind: 'if' | 'unless'; cond: string; then: IfNode[]; otherwise: IfNode[] };

const IF_TAG = /\{\{\s*(?:(#?(?:if|unless))\s+([^{}]+?)|(else)|\/(if|unless))\s*\}\}/gi;

/** Splits text into plain runs and if/unless blocks. Tags that don't pair
 *  up are left as they are. */
export function ifBlocks(text: string): IfNode[] {
  type Frame = { kind: 'if' | 'unless'; cond: string; then: IfNode[]; otherwise: IfNode[]; inElse: boolean; raw: string[] };
  const root: IfNode[] = [];
  const stack: Frame[] = [];
  const target = () => {
    const f = stack[stack.length - 1];
    return f ? (f.inElse ? f.otherwise : f.then) : root;
  };
  const addText = (t: string) => {
    if (!t) return;
    const list = target();
    if (typeof list[list.length - 1] === 'string') list[list.length - 1] += t;
    else list.push(t);
    for (const f of stack) f.raw.push(t);
  };
  let at = 0;
  for (const m of text.matchAll(IF_TAG)) {
    let start = m.index;
    let end = start + m[0].length;
    // Standalone: only spaces around it on its line.
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const nl = text.indexOf('\n', end);
    const lineEnd = nl < 0 ? text.length : nl;
    if (!text.slice(lineStart, start).trim() && !text.slice(end, lineEnd).trim()) {
      start = lineStart;
      end = nl < 0 ? text.length : nl + 1;
    }
    if (start < at) start = at;
    addText(text.slice(at, start));
    const raw = text.slice(start, end);
    at = end;
    const [, open, cond, isElse, close] = m;
    if (open) {
      for (const f of stack) f.raw.push(raw);
      stack.push({ kind: open.replace('#', '').toLowerCase() as 'if' | 'unless', cond: cond.trim(), then: [], otherwise: [], inElse: false, raw: [raw] });
    } else if (isElse) {
      const f = stack[stack.length - 1];
      if (f && !f.inElse) {
        f.inElse = true;
        for (const g of stack) g.raw.push(raw);
      } else addText(raw);
    } else if (close) {
      const f = stack[stack.length - 1];
      if (f && f.kind === close.toLowerCase()) {
        stack.pop();
        for (const g of stack) g.raw.push(raw);
        target().push({ kind: f.kind, cond: f.cond, then: f.then, otherwise: f.otherwise });
      } else addText(raw);
    }
  }
  addText(text.slice(at));
  // Never closed: put the text back as written.
  while (stack.length) {
    const f = stack.pop()!;
    const list = target();
    const back = f.raw.join('');
    if (typeof list[list.length - 1] === 'string') list[list.length - 1] += back;
    else list.push(back);
  }
  return root;
}
