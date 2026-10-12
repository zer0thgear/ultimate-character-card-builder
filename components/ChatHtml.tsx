'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { cx } from '@/components/ui';
import { pageSrcdoc } from '@/lib/chatHtml';
import { parseSlash, type SlashStep } from '@/lib/pageBridge';
import { toast } from '@/store/uiStore';

// HTML in chat messages (lib/chatHtml.ts). A message's HTML is sanitized as
// SillyTavern does it (no scripts, no event handlers, no forms) and shown in
// a shadow root, so its <style> blocks style only that message and the
// app's styles leave it alone; it's also contained, so nothing in it can
// cover the rest of the app. A whole page runs in a sandboxed frame, as
// Tavern Helper shows one: its scripts work, but it can't reach UCCB; it
// can only fill in and send the chat's message box, through the bridge
// (lib/pageBridge.ts), and only right after you click in it.

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

/** What pages in messages can do in the chat they're in (lib/pageBridge.ts). */
export interface PageBridge {
  /** The message box. */
  input: string;
  setInput: (text: string) => void;
  /** Sends `text` as your message and asks for a reply, as the send button does. */
  submit: (text: string) => void;
  /** Adds your message without asking for a reply (/send). */
  addMessage: (text: string) => void;
  /** Asks for a reply (/trigger). */
  trigger: () => Promise<void>;
  busy: boolean;
}

export const PageBridgeContext = createContext<PageBridge | null>(null);

/** Runs slash-command steps (parseSlash) in the chat. */
export async function runSlash(steps: SlashStep[], b: PageBridge): Promise<void> {
  for (const s of steps) {
    if (s.op === 'setinput') b.setInput(s.text);
    else if (s.op === 'send') b.addMessage(s.text);
    else if (s.op === 'echo') toast(s.text.slice(0, 300));
    else await b.trigger();
  }
}

/** A message to a page's frame. */
const postTo = (frame: HTMLIFrameElement | null, msg: Record<string, unknown>) => frame?.contentWindow?.postMessage({ uccbHtml: 1, ...msg }, '*');

/** How soon after one send a page can send again. */
const SEND_GAP_MS = 1500;

/** A whole page from a message, running in a sandboxed frame that grows to
 *  fit it. */
export function HtmlPage({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const srcdoc = useMemo(() => pageSrcdoc(html, typeof window === 'undefined' ? undefined : window.innerHeight), [html]);
  const bridge = useContext(PageBridgeContext);
  const bridgeRef = useRef(bridge);
  useEffect(() => {
    bridgeRef.current = bridge;
  });
  const lastSend = useRef(0);

  // The page's copy of the message box follows UCCB's.
  const input = bridge?.input;
  useEffect(() => {
    if (input !== undefined) postTo(ref.current, { input });
  }, [input]);

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const m = e.data as { uccbHtml?: number; height?: unknown; call?: string; text?: unknown; id?: unknown; command?: unknown; tone?: unknown };
      if (m?.uccbHtml !== 1) return;
      if (typeof m.height === 'number' && m.height > 0) {
        setHeight(Math.min(Math.ceil(m.height), 4000));
        return;
      }
      const b = bridgeRef.current;
      const text = typeof m.text === 'string' ? m.text : '';
      // Only a page you've just clicked into can type or send.
      const yours = document.activeElement === ref.current;
      const canSend = () => {
        if (!b || !yours || b.busy || Date.now() - lastSend.current < SEND_GAP_MS) return false;
        lastSend.current = Date.now();
        return true;
      };
      if (m.call === 'input') {
        if (b && yours) b.setInput(text);
      } else if (m.call === 'submit') {
        if (text.trim() && canSend()) b!.submit(text);
      } else if (m.call === 'toast') {
        if (yours && text.trim()) toast(text.slice(0, 300), m.tone === 'error' || m.tone === 'success' ? m.tone : 'info');
      } else if (m.call === 'slash' && typeof m.id === 'number') {
        const reply = (error?: string) => postTo(ref.current, { reply: m.id, ...(error ? { error } : { result: '' }) });
        const parsed = parseSlash(typeof m.command === 'string' ? m.command : '');
        if ('error' in parsed) return reply(parsed.error);
        if (!b) return reply('Not in a chat.');
        if (!yours) return reply('Only works after a click in the page.');
        const sends = parsed.steps.some((s) => s.op === 'send' || s.op === 'trigger');
        if (sends && !canSend()) return reply(b.busy ? 'A reply is being written.' : 'Too soon after the last one.');
        try {
          await runSlash(parsed.steps, b);
          reply();
        } catch (err) {
          reply((err as Error).message);
        }
      }
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
      onLoad={() => input !== undefined && postTo(ref.current, { input })}
      className="my-1 block w-full rounded-md border-0 bg-transparent"
      style={{ height }}
    />
  );
}
