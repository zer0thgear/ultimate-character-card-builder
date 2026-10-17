// Extra headers a connection sends with each request to its server (LLM
// and image connections): for a server behind something that wants its own,
// such as Cloudflare Access's service token in front of a backend on your
// home PC (docs/HOSTING.md). Sent by UCCB's server only, never by the
// browser, and only to that connection's server.

export type ExtraHeaders = Record<string, string>;

/** Cloudflare Access's service token, as a request carries it. */
export const CF_ACCESS_HEADERS = ['CF-Access-Client-Id', 'CF-Access-Client-Secret'] as const;

// The request's own: the body, the connection and where it's going are UCCB's to set.
const RESERVED = new Set(['host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'expect']);
const NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Whether a header may be sent: a valid name that isn't one UCCB sets itself. */
export const headerAllowed = (name: string) => NAME.test(name) && !RESERVED.has(name.toLowerCase());

/** The headers that can be sent, from whatever was saved (blank names, line breaks and reserved ones dropped). */
export function cleanHeaders(h: unknown): ExtraHeaders {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return {};
  const out: ExtraHeaders = {};
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    const name = k.trim();
    if (typeof v !== 'string' || !headerAllowed(name) || /[\r\n\0]/.test(v)) continue;
    out[name] = v.trim();
  }
  return out;
}
