'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { cx } from '@/components/ui';
import { pageSrcdoc } from '@/lib/chatHtml';

// HTML in chat messages (lib/chatHtml.ts). A message's HTML is sanitized as
// SillyTavern does it (no scripts, no event handlers, no forms) and shown in
// a shadow root, so its <style> blocks style only that message and the
// app's styles leave it alone; it's also contained, so nothing in it can
// cover the rest of the app. A whole page runs in a sandboxed frame, as
// Tavern Helper shows one: its scripts work, but it can't reach UCCB.

/** The chat's own text styling, inside the shadow root (the colours come
 *  from .chat-text in globals.css). */
const BASE_CSS = `
.m{white-space:pre-wrap;overflow-wrap:anywhere}
em{color:var(--chat-em)}
q{color:var(--chat-quote);quotes:none}
q em{color:inherit}
strong{font-weight:600}
img,video{max-width:100%;height:auto;border-radius:6px}
a{color:var(--chat-link);text-decoration:underline}
code{font-family:ui-monospace,monospace;font-size:.9em;background:rgba(100,116,139,.25);border-radius:4px;padding:0 4px}
pre{white-space:pre;overflow-x:auto;padding:8px;border-radius:6px;background:rgba(2,6,23,.7);font-size:12px;line-height:1.5}
pre code{background:none;padding:0}
h1,h2,h3,h4,h5,h6{margin:.25em 0;font-weight:600;line-height:1.3}
h1{font-size:1.25rem}h2{font-size:1.125rem}h3{font-size:1rem}h4,h5,h6{font-size:.875rem}
hr{border:0;border-top:1px solid rgba(100,116,139,.5);margin:8px 0}
`;

let hooked = false;
function sanitize(html: string): string {
  if (!hooked) {
    hooked = true;
    // Links open in a new tab, never in place of UCCB.
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  // FORCE_BODY keeps a <style> at the very start (it would go to <head>).
  return DOMPurify.sanitize(html, { FORCE_BODY: true, ADD_TAGS: ['style'], FORBID_TAGS: ['form'], ADD_ATTR: ['target'] });
}

/** A message's HTML (messageHtml), sanitized, in a shadow root. */
export function HtmlText({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const clean = useMemo(() => (typeof window === 'undefined' ? '' : sanitize(html)), [html]);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${BASE_CSS}</style><div class="m">${clean}</div>`;
  }, [clean]);
  return <div ref={ref} className={cx('chat-text text-sm leading-relaxed text-slate-200', className)} style={{ contain: 'content' }} />;
}

/** A whole page from a message, running in a sandboxed frame that grows to
 *  fit it. */
export function HtmlPage({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const srcdoc = useMemo(() => pageSrcdoc(html), [html]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const m = e.data as { uccbHtml?: number; height?: unknown };
      if (m?.uccbHtml === 1 && typeof m.height === 'number' && m.height > 0) setHeight(Math.min(Math.ceil(m.height), 4000));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return (
    <iframe
      ref={ref}
      title="A page in the message"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow=""
      srcDoc={srcdoc}
      className="my-1 block w-full rounded-md border-0 bg-transparent"
      style={{ height }}
    />
  );
}
