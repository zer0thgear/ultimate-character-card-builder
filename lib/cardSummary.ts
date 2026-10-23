// What a card list shows under a card's name, beside its picture: its
// author and the start of its creator's notes, as SillyTavern's list does.

const SNIPPET_LENGTH = 160;

/** The start of the creator's notes as plain text: HTML tags, Markdown
 *  images, links and emphasis taken out, whitespace run together. */
export function notesSnippet(notes: string | undefined, length = SNIPPET_LENGTH): string {
  if (!notes) return '';
  const text = notes
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&(mdash|ndash|hellip|rsquo|lsquo|rdquo|ldquo);/g, (_, n: string) => ({ mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' })[n] ?? '')
    // Numeric ones (&#8634; &#x1F600;), before the # goes with the Markdown below.
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (m, n: string) => {
      const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/[*_~`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}
