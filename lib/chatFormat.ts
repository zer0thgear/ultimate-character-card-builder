// Roleplay text as frontends show it: *actions* in italics, **bold**, and
// "speech" highlighted, nested either way ("We *really* owe you" and
// *she said "hi"* both work). Spans don't cross lines, as in SillyTavern.

export type FormatNode = string | { kind: 'em' | 'strong' | 'quote'; children: FormatNode[] };

const RULES: { kind: 'em' | 'strong' | 'quote'; re: RegExp; open: number; close: number }[] = [
  { kind: 'strong', re: /\*\*[^*\n]+?\*\*/y, open: 2, close: 2 },
  { kind: 'em', re: /\*[^*\n]+\*/y, open: 1, close: 1 },
  { kind: 'em', re: /_[^_\n]+_(?![A-Za-z0-9])/y, open: 1, close: 1 },
  { kind: 'quote', re: /"[^"\n]*"/y, open: 0, close: 0 },
  { kind: 'quote', re: /“[^”\n]*”/y, open: 0, close: 0 },
];

/** Splits `text` into plain runs and styled spans. A quote keeps its quote
 *  marks (they're part of the speech); italics and bold drop their markers. */
export function formatChat(text: string, inside: ReadonlySet<string> = new Set()): FormatNode[] {
  const out: FormatNode[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    let matched = false;
    if (ch === '*' || ch === '"' || ch === '“' || (ch === '_' && !/[A-Za-z0-9]/.test(text[i - 1] ?? ''))) {
      for (const rule of RULES) {
        if (inside.has(rule.kind)) continue;
        rule.re.lastIndex = i;
        const m = rule.re.exec(text);
        if (!m) continue;
        if (plain) out.push(plain);
        plain = '';
        const inner = m[0].slice(rule.open, m[0].length - rule.close);
        const nested = new Set(inside).add(rule.kind);
        out.push({ kind: rule.kind, children: formatChat(inner, nested) });
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      plain += ch;
      i++;
    }
  }
  if (plain) out.push(plain);
  return out;
}
