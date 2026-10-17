// Sign-in for UCCB on a server (docs/HOSTING.md): a password of its own,
// and Cloudflare Access's sign-in checked as it comes through. Either or
// both; server.mjs puts them in front of everything. Plain JS so
// server.mjs can use it without a build step.

import { createHmac, createPublicKey, randomBytes, scrypt, timingSafeEqual, verify } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// ─── The password ──────────────────────────────────────────────────────────

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

const scryptAsync = (password, salt, { N, r, p, keylen }) =>
  new Promise((resolve, reject) => scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));

/** "scrypt:N:r:p:salt:hash", for UCCB_PASSWORD_HASH (npm run hash-password). */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt, SCRYPT);
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${b64url(salt)}:${b64url(key)}`;
}

/** Whether `password` is the one `stored` (a hash from hashPassword) stands for. */
export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 20) return false;
  const want = Buffer.from(parts[5], 'base64url');
  if (!want.length) return false;
  const got = await scryptAsync(String(password ?? ''), Buffer.from(parts[4], 'base64url'), { N, r, p, keylen: want.length });
  return timingSafeEqual(got, want);
}

/** A password hash looks right (so a typo in the setting is caught at start). */
export const isPasswordHash = (s) => /^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/.test(String(s ?? ''));

// ─── The session cookie ────────────────────────────────────────────────────

export const SESSION_COOKIE = 'uccb_session';
export const SESSION_DAYS = 30;

/** The key sessions are signed with: from the server's secret and the
 *  password, so changing the password signs everyone out. */
export const sessionKey = (secret, passwordHash) => createHmac('sha256', secret).update(`uccb-session|${passwordHash}`).digest();

/** A signed session that lasts until `exp` (ms). */
export function signSession(key, exp) {
  const body = b64url(JSON.stringify({ exp }));
  return `${body}.${b64url(createHmac('sha256', key).update(body).digest())}`;
}

/** Whether a session cookie is one we signed and hasn't run out. */
export function readSession(key, value, now = Date.now()) {
  const [body, sig] = String(value ?? '').split('.');
  if (!body || !sig) return false;
  const want = createHmac('sha256', key).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}

/** "a=1; b=2" → { a: '1', b: '2' }. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    try {
      out[name] = decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      out[name] = part.slice(at + 1).trim();
    }
  }
  return out;
}

/** Where to go after signing in: a path on this site, never another site. */
export function safeNext(next) {
  const n = String(next ?? '');
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') && !n.startsWith('/_uccb/') ? n : '/';
}

/** Failed sign-ins, by address: past `max` in `windowMs`, that address waits. */
export class Attempts {
  constructor(max = 10, windowMs = 15 * 60_000) {
    this.max = max;
    this.windowMs = windowMs;
    this.fails = new Map();
  }
  /** Ms until `who` may try again (0: now). */
  wait(who, now = Date.now()) {
    const list = (this.fails.get(who) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.fails.set(who, list);
    else this.fails.delete(who);
    return list.length >= this.max ? list[0] + this.windowMs - now : 0;
  }
  fail(who, now = Date.now()) {
    this.fails.set(who, [...(this.fails.get(who) ?? []).filter((t) => now - t < this.windowMs), now]);
    // Old addresses don't pile up.
    if (this.fails.size > 10_000) for (const k of [...this.fails.keys()].slice(0, 5_000)) this.fails.delete(k);
  }
  clear(who) {
    this.fails.delete(who);
  }
}

// ─── Cloudflare Access ─────────────────────────────────────────────────────

/** "myteam", "myteam.cloudflareaccess.com" or its URL → "https://myteam.cloudflareaccess.com". */
export function accessTeamUrl(team) {
  const t = String(team ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!t) return '';
  return `https://${t.includes('.') ? t : `${t}.cloudflareaccess.com`}`;
}

const decodePart = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/**
 * Checks a Cloudflare Access token (the Cf-Access-Jwt-Assertion header):
 * signed by one of the team's keys, for one of `audiences` (the Access
 * application's AUD tag), from the team, and current. Returns null if it
 * holds, or why not.
 * @param {string} token
 * @param {{ team: string, audiences: string[], keyFor: (kid: string) => Promise<import('node:crypto').KeyObject | null>, now?: number }} opts
 */
export async function checkAccessToken(token, { team, audiences, keyFor, now = Date.now() }) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return 'no token';
  let header, payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    return 'unreadable token';
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return 'unexpected signature';
  const key = await keyFor(header.kid);
  if (!key) return 'unknown key';
  const signed = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  if (!signed) return 'bad signature';
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.some((a) => audiences.includes(a))) return 'wrong application';
  if (String(payload.iss ?? '').replace(/\/$/, '') !== accessTeamUrl(team)) return 'wrong team';
  const secs = now / 1000;
  // A minute's leeway for clocks a little apart.
  if (typeof payload.exp !== 'number' || payload.exp < secs - 60) return 'expired';
  if (typeof payload.nbf === 'number' && payload.nbf > secs + 60) return 'not yet valid';
  return null;
}

/** The team's signing keys, fetched when a token names one we haven't got (at most every 30 s). */
export function accessKeys(team, fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))) {
  const url = `${accessTeamUrl(team)}/cdn-cgi/access/certs`;
  let keys = new Map();
  let fetchedAt = 0;
  let pending = null;
  const refresh = async () => {
    const body = await fetchJson(url);
    keys = new Map((body?.keys ?? []).filter((k) => k.kid && k.kty === 'RSA').map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
    fetchedAt = Date.now();
  };
  return async (kid) => {
    if (!keys.has(kid) && Date.now() - fetchedAt > 30_000) {
      pending ??= refresh()
        .catch((err) => {
          fetchedAt = Date.now();
          console.error(`Couldn't fetch Cloudflare Access's keys from ${url}: ${err.message}`);
        })
        .finally(() => (pending = null));
      await pending;
    }
    return keys.get(kid) ?? null;
  };
}
