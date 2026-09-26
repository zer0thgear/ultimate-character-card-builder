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

export interface MacroContext {
  char: string;
  user: string;
  /** What {{original}} stands for in the field being expanded. */
  original?: string;
  /** Card and persona fields for {{description}} and friends. */
  fields?: Partial<Record<'description' | 'personality' | 'scenario' | 'persona' | 'mesExamples', string>>;
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

  let out = text.replace(/\{\{\/\/[\s\S]*?\}\}/g, '').replace(/<BOT>/gi, ctx.char).replace(/<USER>/gi, ctx.user);
  // Innermost first, so {{getvar::{{random::a::b}}}} and the like resolve;
  // a few passes cover nesting without looping forever on unknown macros.
  for (let pass = 0; pass < 5; pass++) {
    const next = out.replace(/\{\{([\w]+)(?::((?:(?!\{\{|\}\})[\s\S])*?))?\}\}/g, (whole, name: string, arg?: string) => one(whole, name, arg));
    if (next === out) break;
    out = next;
  }
  if (out.includes(TRIM)) out = out.replace(/\s*\u0000TRIM\u0000\s*/g, '');
  return out;
}
