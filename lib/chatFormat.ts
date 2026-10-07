// Roleplay text as frontends show it: *actions* in italics, **bold**, and
// "speech" highlighted, nested either way ("We *really* owe you" and
// *she said "hi"* both work), plus embedded pictures: ![alt](url) and
// <img src="url">, as cards on Chub and SillyTavern use in greetings,
// Markdown headings (# to ######, at the start of a line), and `code`:
// inline, or a fenced block (``` or ~~~ lines), shown as written. Spans
// don't cross lines, as in SillyTavern; a code block does.

export type FormatNode =
  | string
  | { kind: 'em' | 'strong' | 'quote'; children: FormatNode[] }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: FormatNode[] }
  | { kind: 'code'; text: string }
  | { kind: 'codeBlock'; text: string; lang?: string };

/** How big each heading level is shown (Tailwind classes). */
export const HEADING_CLASSES: Record<number, string> = { 1: 'text-xl', 2: 'text-lg', 3: 'text-base', 4: 'text-sm', 5: 'text-sm', 6: 'text-sm text-slate-400' };

/** How code shows (Tailwind classes): inline, and as a block. */
export const CODE_CLASS = 'rounded bg-slate-800 px-1 py-px font-mono text-[0.9em] text-slate-200';
export const CODE_BLOCK_CLASS = 'my-1 overflow-x-auto rounded-md border border-slate-800 bg-slate-950/70 p-2 font-mono text-xs leading-normal whitespace-pre text-slate-200';

/** A heading line: "# Title" (up to three spaces in, closing #s dropped),
 *  with the line break after it, which the heading's own line stands for. */
const HEADING = /[ ]{0,3}(#{1,6})[ \t]+([^\n]*?)[ \t]*(?:#+[ \t]*)?(?:\n|$)/y;

/** A fenced code block: ``` or ~~~ (three or more) at the start of a line,
 *  an optional language, the code, and the same fence again, with the line
 *  break after it. Unclosed (a reply still being written), it runs to the
 *  end. */
const FENCE = /[ ]{0,3}(`{3,}|~{3,})[ \t]*([^\n`]*?)[ \t]*(?:\n([\s\S]*?))??(?:\n[ ]{0,3}\1[ \t]*(?:\n|$)|$)/y;
/** Inline code: a run of backticks, the code (on one line), and as many
 *  backticks again. */
const INLINE_CODE = /(`+)([^`\n](?:[^\n]*?[^`\n])?)\1(?!`)/y;

/** Code at `i`, if a code block or span starts there. */
function codeAt(text: string, i: number, lineStart: boolean): { node: FormatNode; length: number } | null {
  if (lineStart) {
    FENCE.lastIndex = i;
    const m = FENCE.exec(text);
    if (m) return { node: { kind: 'codeBlock', text: m[3] ?? '', ...(m[2] ? { lang: m[2] } : {}) }, length: m[0].length };
  }
  if (text[i] !== '`') return null;
  INLINE_CODE.lastIndex = i;
  const m = INLINE_CODE.exec(text);
  if (!m) return null;
  // As in Markdown, one space each side is padding (for code next to a `).
  const code = /^ .* $/.test(m[2]) && m[2].trim() ? m[2].slice(1, -1) : m[2];
  return { node: { kind: 'code', text: code }, length: m[0].length };
}

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
    const lineStart = !inside.size && (i === 0 || text[i - 1] === '\n');
    const code = ch === '`' || ((ch === '~' || ch === ' ') && lineStart) ? codeAt(text, i, lineStart) : null;
    if (code) {
      if (plain) out.push(plain);
      plain = '';
      out.push(code.node);
      i += code.length;
      continue;
    }
    if (lineStart && (ch === '#' || ch === ' ')) {
      HEADING.lastIndex = i;
      const m = HEADING.exec(text);
      if (m && m[2]) {
        if (plain) out.push(plain);
        plain = '';
        out.push({ kind: 'heading', level: m[1].length as 1, children: formatChat(m[2], inside) });
        i += m[0].length;
        continue;
      }
    }
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
