import { formatChat, type FormatNode } from '@/lib/chatFormat';
import { BRIDGE_SCRIPT } from '@/lib/pageBridge';

// HTML in chat messages, as SillyTavern shows it: presets and cards style
// replies with regex scripts that put out <div>s, <details> and <style>
// blocks. SillyTavern renders a message's HTML (with scripts and event
// handlers taken out) alongside its Markdown; Tavern Helper (JS-Slash-Runner)
// also runs a code block holding a whole page (<html>, <body>) as a page of
// its own. This file turns a message into those pieces; the chat sanitizes
// the HTML and shows it in a shadow root, and runs pages in a sandboxed
// frame (components/ChatHtml.tsx).

export type HtmlSegment = { kind: 'text'; text: string } | { kind: 'page'; html: string };

/** A fenced code block (``` or ~~~, closed) at the start of a line. */
const FENCED = /^[ ]{0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n[ ]{0,3}\1[ \t]*$/gm;

/** A whole page, as Tavern Helper tells one from code to show. */
export const isHtmlPage = (code: string) => /<!doctype html|<html[\s>]|<body[\s>]/i.test(code);

/** `text` split at the code blocks that hold a whole page. */
export function splitHtmlPages(text: string): HtmlSegment[] {
  const out: HtmlSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(FENCED)) {
    if (!isHtmlPage(m[2])) continue;
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push({ kind: 'page', html: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.filter((s) => s.kind === 'page' || s.text.trim());
}

/** Tags the plain formatter shows itself (pictures, players, rules). */
const PLAIN_TAGS = new Set(['img', 'audio', 'video', 'source', 'hr']);
const TAG = /<\/?([a-zA-Z][\w:-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/g;

/** Whether `text` has HTML the plain formatter would show as text. */
export function hasHtml(text: string): boolean {
  for (const m of text.matchAll(TAG)) if (!PLAIN_TAGS.has(m[1].toLowerCase())) return true;
  return false;
}

const OPEN = '';
const CLOSE = '';
const TOKEN = /(\d+)/g;

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const esc = (s: string) => escText(s).replace(/"/g, '&quot;');

/** Tags that start a line of their own, so a line break next to one is
 *  the template's layout rather than the message's. */
const BLOCK = new Set('address article aside blockquote center details dialog dd div dl dt fieldset figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section style summary table tbody td tfoot th thead tr ul br'.split(' '));
const isBlock = (tag: string) => BLOCK.has(tag.match(/^<\/?([a-zA-Z][\w:-]*)/)?.[1].toLowerCase() ?? '');

/** A message with HTML in it as one HTML string (not yet sanitized): its
 *  tags and <style> blocks as written, scripts left out, and the text
 *  between them formatted as the chat formats text (*italics*, "speech",
 *  code, links…), so the formatter never reads into a tag. */
export function messageHtml(text: string): string {
  const kept: string[] = [];
  const keep = (s: string) => `${OPEN}${kept.push(s) - 1}${CLOSE}`;
  const t = text
    // SillyTavern never runs a message's scripts.
    .replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, '')
    .replace(/<style\b[\s\S]*?(?:<\/style\s*>|$)/gi, keep)
    .replace(TAG, keep)
    // Line breaks and indents between tags, and one line break beside a
    // block, are the template's layout, not the message's.
    .replace(/[ \t]*\r?\n\s*(?=)/g, CLOSE)
    .replace(/[ \t]*\r?\n[ \t]*((\d+))/g, (m, tok: string, i: string) => (isBlock(kept[Number(i)]) ? tok : m))
    .replace(/((\d+))[ \t]*\r?\n[ \t]*/g, (m, tok: string, i: string) => (isBlock(kept[Number(i)]) ? tok : m))
    .replace(/(^|\n)[ \t]+(?=)/g, '$1');
  const restore = (s: string) => s.replace(TOKEN, (_, i: string) => kept[Number(i)]);
  /** Code shows the tags in it as text. */
  const code = (s: string) => esc(restore(s));
  const render = (nodes: FormatNode[]): string =>
    nodes
      .map((n) => {
        if (typeof n === 'string') return restore(escText(n));
        switch (n.kind) {
          case 'em':
          case 'strong':
            return `<${n.kind}>${render(n.children)}</${n.kind}>`;
          case 'quote':
            return `<q>${render(n.children)}</q>`;
          case 'heading':
            return `<h${n.level}>${render(n.children)}</h${n.level}>`;
          case 'link':
            return `<a href="${esc(n.href)}">${render(n.children)}</a>`;
          case 'image':
            return `<img src="${esc(n.src)}" alt="${esc(n.alt)}">`;
          case 'media':
            return `<${n.media} controls src="${esc(n.src)}"></${n.media}>`;
          case 'code':
            return `<code>${code(n.text)}</code>`;
          case 'codeBlock':
            return `<pre><code>${code(n.text)}</code></pre>`;
          case 'rule':
            return '<hr>';
        }
      })
      .join('');
  return render(formatChat(t));
}

/** A page's document with the chat bridge (lib/pageBridge.ts) before its
 *  own scripts, and a script at the end that reports its height to the
 *  chat, so its frame can fit it. */
export function pageSrcdoc(html: string): string {
  const report =
    '<script>(()=>{const h=()=>parent.postMessage({uccbHtml:1,height:Math.ceil(document.documentElement.getBoundingClientRect().height)},"*");' +
    'new ResizeObserver(h).observe(document.documentElement);addEventListener("load",h);h();})()</script>';
  const withReport = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i, `${report}</body>`) : html + report;
  // As early as can be without leaving standards mode (nothing before the
  // doctype).
  const start = withReport.match(/<head\b[^>]*>|<html\b[^>]*>|<!doctype[^>]*>/i);
  const at = start ? start.index! + start[0].length : 0;
  return withReport.slice(0, at) + BRIDGE_SCRIPT + withReport.slice(at);
}
