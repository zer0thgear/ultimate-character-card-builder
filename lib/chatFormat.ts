// Roleplay text as frontends show it: *actions* in italics, **bold**, and
// "speech" highlighted, nested either way ("We *really* owe you" and
// *she said "hi"* both work), plus embedded pictures: ![alt](url) and
// <img src="url">, as cards on Chub and SillyTavern use in greetings. Spans
// don't cross lines, as in SillyTavern.

export type FormatNode = string | { kind: 'em' | 'strong' | 'quote'; children: FormatNode[] } | { kind: 'image'; src: string; alt: string };

const MD_IMAGE = /!\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)/y;
const HTML_IMAGE = /<img\b[^>\n]*?>/iy;

/** Only web and inline pictures are shown; anything else stays text. */
const safeSrc = (src: string) => (/^https?:\/\//i.test(src) || /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(src) ? src : null);

function imageAt(text: string, i: number): { node: FormatNode; length: number } | null {
  if (text[i] === '!') {
    MD_IMAGE.lastIndex = i;
    const m = MD_IMAGE.exec(text);
    const src = m && safeSrc(m[2]);
    return m && src ? { node: { kind: 'image', src, alt: m[1] }, length: m[0].length } : null;
  }
  if (text[i] === '<') {
    HTML_IMAGE.lastIndex = i;
    const m = HTML_IMAGE.exec(text);
    if (!m) return null;
    const attr = (name: string) => m[0].match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    const s = attr('src');
    const src = s && safeSrc(s[1] ?? s[2] ?? s[3] ?? '');
    const a = attr('alt');
    // A tag that isn't shown stays exactly as written (not read as speech).
    return { node: src ? { kind: 'image', src, alt: a ? (a[1] ?? a[2] ?? a[3] ?? '') : '' } : m[0], length: m[0].length };
  }
  return null;
}

const RULES: { kind: 'em' | 'strong' | 'quote'; re: RegExp; open: number; close: number }[] = [
  { kind: 'strong', re: /\*\*[^*\n]+?\*\*/y, open: 2, close: 2 },
  { kind: 'em', re: /\*[^*\n]+\*/y, open: 1, close: 1 },
  { kind: 'em', re: /_[^_\n]+_(?![A-Za-z0-9])/y, open: 1, close: 1 },
  { kind: 'quote', re: /"[^"\n]*"/y, open: 0, close: 0 },
  { kind: 'quote', re: /“[^”\n]*”/y, open: 0, close: 0 },
];

/** `text` without its HTML comments (<!-- … -->), which creators use for
 *  notes to the model: the model still gets them, the chat doesn't show
 *  them. One still being written (no --> yet) is hidden to the end. Lines
 *  left empty by one go with it. */
export function hideComments(text: string): string {
  if (!text.includes('<!--')) return text;
  return text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '\u0000')
    .replace(/^[ \t]*\u0000[ \t\u0000]*(?:\r?\n|$)/gm, '')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits `text` into plain runs and styled spans. A quote keeps its quote
 *  marks (they're part of the speech); italics and bold drop their markers. */
export function formatChat(text: string, inside: ReadonlySet<string> = new Set()): FormatNode[] {
  const out: FormatNode[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    let matched = false;
    const image = ch === '!' || ch === '<' ? imageAt(text, i) : null;
    if (image) {
      if (plain) out.push(plain);
      plain = '';
      out.push(image.node);
      i += image.length;
      continue;
    }
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
