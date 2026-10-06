// Extension packs with UI and code (lib/extensionPack.ts `ui`). Every piece
// of an extension's UI runs in a sandboxed frame (`sandbox="allow-scripts"`,
// no `allow-same-origin`), so it has an opaque origin: it can't read the
// app's storage or DOM, and can't call /api/* (the browser won't let it read
// the reply, and scripts/access.mjs refuses `Origin: null`). That matters
// because the app's own pages can read your API keys. A CSP in the frame
// stops it reaching the network, except hosts the pack declares.
//
// The frame talks to the app with postMessage, through the `uccb` object
// the bootstrap below defines; the app (components/extensions/) answers
// only the calls the permissions you granted at install allow.

export const PERMISSIONS = {
  'card:read': 'Read the open card',
  'card:write': "Change the open card's fields (undoable, like your own edits)",
  'lorebooks:read': 'Read your lorebooks in 📖 Lorebooks',
  'lorebooks:write': 'Add lorebooks to 📖 Lorebooks',
  llm: 'Send requests to your writing-assistant LLM connection (your API keys stay hidden; each request shows in Settings → Assistant → Recent requests)',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const isPermission = (p: unknown): p is Permission => typeof p === 'string' && Object.hasOwn(PERMISSIONS, p);

/** Where a piece of an extension's UI goes. */
export const UI_SLOTS = {
  dockTab: 'a tab in the dock (right side)',
  editorTab: 'a tab in the card editor',
  fieldAction: "a button on the card's text fields, opening a dialog",
  command: 'a button in the header, opening a dialog',
  brainstormWizard: 'a wizard in the Brainstorm tab',
  dialog: 'a dialog the extension opens itself',
  settings: 'a section in Settings → Extensions',
} as const;

export type UiSlot = keyof typeof UI_SLOTS;

/** Which API call needs which permission (none: anyone may). */
export const METHOD_PERMISSION: Record<string, Permission | null> = {
  context: null,
  'card.get': 'card:read',
  'card.setFields': 'card:write',
  'lorebooks.list': 'lorebooks:read',
  'lorebooks.add': 'lorebooks:write',
  'llm.complete': 'llm',
  'references.pick': 'llm',
  'references.list': 'llm',
  'references.remove': 'llm',
  'storage.get': null,
  'storage.set': null,
  'ui.toast': null,
  'ui.openDialog': null,
  'ui.close': null,
};

/** Whether a call is allowed with these permissions; an unknown method never is. */
export function callAllowed(method: string, granted: readonly string[]): boolean {
  if (!Object.hasOwn(METHOD_PERMISSION, method)) return false;
  const need = METHOD_PERMISSION[method];
  return need === null || granted.includes(need);
}

/** A host a pack may connect to: a plain https host name (no paths, no
 *  wildcards but a leading "*."). */
export const HOST_RE = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i;

/** The frame's Content-Security-Policy: scripts and styles only from the
 *  page itself, pictures from data:/blob: (and the pack's hosts), and no
 *  network unless the pack declared hosts. */
export function sandboxCsp(network: readonly string[] = []): string {
  const hosts = network.filter((h) => HOST_RE.test(h)).map((h) => `https://${h}`);
  const net = hosts.length ? hosts.join(' ') : "'none'";
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src data: blob:${hosts.length ? ` ${hosts.join(' ')}` : ''}`,
    'font-src data:',
    'media-src data: blob:',
    `connect-src ${net}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

const escapeScript = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1');
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The pack's own files, put inline: `<script src="x.js">` and
 *  `<link rel="stylesheet" href="x.css">` naming one of its files. Anything
 *  else is left as it is (and the CSP blocks it). */
export function inlineFiles(html: string, files: Record<string, string>): string {
  const file = (ref: string) => {
    const key = ref.replace(/^\.\//, '');
    return Object.hasOwn(files, key) ? files[key] : undefined;
  };
  return html
    .replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a: string, src: string, b: string) => {
      const text = file(src);
      const attrs = `${a} ${b}`.trim().replace(/\s+/g, ' ');
      return text === undefined ? m : `<script${attrs ? ` ${attrs}` : ''}>${escapeScript(text)}</script>`;
    })
    .replace(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi, (m, href: string) => {
      if (!/\brel\s*=\s*["']?stylesheet/i.test(m)) return m;
      const text = file(href);
      return text === undefined ? m : `<style>${text.replace(/<\/(style)/gi, '<\\/$1')}</style>`;
    });
}

/** What a frame is told about where it is. */
export interface SandboxContext {
  pack: { id: string; name: string; version: string };
  ui: { id: string; slot: UiSlot; label: string };
  granted: string[];
  theme: 'dark' | 'light';
  /** For a field action: the field it was opened on. */
  field?: { path: string; label: string; value: string };
  /** For a dialog: what the extension passed to ui.openDialog. */
  data?: unknown;
}

// Plain styles so an extension looks at home without any of its own.
const BASE_CSS = `
:root { color-scheme: dark; --uccb-bg: #0f172a; --uccb-panel: #1e293b; --uccb-text: #e2e8f0; --uccb-muted: #94a3b8; --uccb-border: #334155; --uccb-accent: #7c3aed; --uccb-accent-text: #fff; }
:root[data-theme="light"] { color-scheme: light; --uccb-bg: #ffffff; --uccb-panel: #f1f5f9; --uccb-text: #0f172a; --uccb-muted: #64748b; --uccb-border: #cbd5e1; --uccb-accent: #7c3aed; --uccb-accent-text: #fff; }
html, body { margin: 0; background: transparent; color: var(--uccb-text); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
body { padding: 12px; }
button { font: inherit; font-size: 13px; color: var(--uccb-text); background: var(--uccb-panel); border: 1px solid var(--uccb-border); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button:hover { filter: brightness(1.15); }
button.primary { background: var(--uccb-accent); color: var(--uccb-accent-text); border-color: transparent; }
button:disabled { opacity: .5; cursor: not-allowed; }
input, textarea, select { font: inherit; color: var(--uccb-text); background: var(--uccb-bg); border: 1px solid var(--uccb-border); border-radius: 6px; padding: 5px 8px; box-sizing: border-box; }
a { color: #38bdf8; }
.muted { color: var(--uccb-muted); font-size: 12px; }
`;

// The frame's side of the API: window.uccb. Calls go to the app as
// {uccb: 1, id, method, params} and come back as {uccb: 1, id, result} or
// {uccb: 1, id, error}; the app pushes events as {uccb: 1, event, data}.
const BOOTSTRAP = `(() => {
  const pending = new Map();
  const listeners = {};
  let next = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    parent.postMessage({ uccb: 1, id, method, params }, '*');
  });
  const on = (event, fn) => {
    (listeners[event] = listeners[event] || []).push(fn);
    return () => { listeners[event] = listeners[event].filter((f) => f !== fn); };
  };
  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || m.uccb !== 1) return;
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if ('error' in m) p.reject(new Error(m.error)); else p.resolve(m.result);
    } else if (m.event) {
      for (const fn of listeners[m.event] || []) { try { fn(m.data); } catch (err) { console.error(err); } }
    }
  });
  on('theme', (t) => { document.documentElement.dataset.theme = t; });
  const ctx = window.__uccbContext;
  delete window.__uccbContext;
  window.uccb = Object.freeze({
    context: ctx,
    on,
    card: Object.freeze({
      get: () => call('card.get'),
      setFields: (fields) => call('card.setFields', { fields }),
      onChange: (fn) => on('card', fn),
    }),
    lorebooks: Object.freeze({
      list: () => call('lorebooks.list'),
      add: (book) => call('lorebooks.add', { book }),
    }),
    llm: Object.freeze({
      complete: (messages, opts) => call('llm.complete', Object.assign({ messages }, opts || {})),
    }),
    references: Object.freeze({
      pick: () => call('references.pick'),
      list: () => call('references.list'),
      remove: (id) => call('references.remove', { id }),
    }),
    storage: Object.freeze({
      get: (key) => call('storage.get', { key }),
      set: (key, value) => call('storage.set', { key, value }),
    }),
    ui: Object.freeze({
      toast: (text, tone) => call('ui.toast', { text, tone }),
      openDialog: (id, data) => call('ui.openDialog', { id, data }),
      close: () => call('ui.close'),
    }),
  });
  const size = () => parent.postMessage({ uccb: 1, resize: Math.ceil(document.documentElement.scrollHeight) }, '*');
  addEventListener('load', size);
  new ResizeObserver(size).observe(document.documentElement);
})();`;

/** The whole page a frame shows: the CSP, the base styles, the context and
 *  API, then the extension's own HTML (with its files inline). */
export function buildSrcdoc(opts: { html: string; files?: Record<string, string>; network?: readonly string[]; context: SandboxContext }): string {
  const body = inlineFiles(opts.html, opts.files ?? {});
  return `<!doctype html>
<html data-theme="${escapeAttr(opts.context.theme)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(sandboxCsp(opts.network))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${BASE_CSS}</style>
<script>window.__uccbContext = ${jsonForScript(opts.context)};</script>
<script>${BOOTSTRAP}</script>
</head>
<body>
${body}
</body>
</html>`;
}
