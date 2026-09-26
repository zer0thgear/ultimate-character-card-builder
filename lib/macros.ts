// The macros frontends replace in card text before it reaches the model,
// the SillyTavern set most cards are written against:
//   {{char}} {{user}} <BOT> <USER>   names
//   {{original}}                     (system prompt/PHI only) the default it replaces
//   {{random:a,b,c}} {{random::a::b}} one option, rolled each time
//   {{pick:a,b}} {{pick::a::b}}      one option, stable for the same text
//   {{roll:d20}} {{roll:2d6}}        dice
//   {{time}} {{date}} {{weekday}} {{idle_duration}}
//   {{newline}} {{// comment}} {{trim}}

export interface MacroContext {
  char: string;
  user: string;
  /** What {{original}} stands for in the field being expanded. */
  original?: string;
  now?: Date;
  /** Seeded roll for {{random}} (tests pass a fixed one). */
  random?: () => number;
}

function options(body: string): string[] {
  // `::` separates when present (so options can hold commas), else `,`.
  const parts = body.startsWith(':') ? body.slice(1).split('::') : body.split(',');
  return parts.map((s) => s.trim());
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function roll(spec: string, random: () => number): string {
  const m = spec.trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return spec;
  const count = Math.min(100, Number(m[1] || 1));
  const sides = Math.max(1, Number(m[2]));
  let total = Number(m[3] || 0);
  for (let i = 0; i < count; i++) total += 1 + Math.floor(random() * sides);
  return String(total);
}

export function expandMacros(text: string, ctx: MacroContext): string {
  if (!text) return text;
  const random = ctx.random ?? Math.random;
  const now = ctx.now ?? new Date();
  let pickIndex = 0;
  let out = text
    .replace(/\{\{\/\/[\s\S]*?\}\}/g, '')
    .replace(/<BOT>/gi, ctx.char)
    .replace(/<USER>/gi, ctx.user)
    .replace(/\{\{(\w+)(?::([\s\S]*?))?\}\}/g, (whole, name: string, arg?: string) => {
      switch (name.toLowerCase()) {
        case 'char':
          return ctx.char;
        case 'user':
          return ctx.user;
        case 'original':
          return ctx.original ?? '';
        case 'newline':
          return '\n';
        case 'time':
          return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        case 'date':
          return now.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
        case 'weekday':
          return now.toLocaleDateString([], { weekday: 'long' });
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
        case 'trim':
          return '\u0000TRIM\u0000';
        default:
          return whole;
      }
    });
  if (out.includes('\u0000TRIM\u0000')) out = out.replace(/\s*\u0000TRIM\u0000\s*/g, '');
  return out;
}
