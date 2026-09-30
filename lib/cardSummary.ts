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
    .replace(/&#39;/g, "'")
    .replace(/[*_~`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}
