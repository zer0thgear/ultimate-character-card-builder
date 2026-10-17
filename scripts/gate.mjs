// The sign-in in front of UCCB (docs/HOSTING.md), set up from the
// environment:
//
//   UCCB_PASSWORD_HASH (or UCCB_PASSWORD)   UCCB's own password page
//   UCCB_ACCESS_TEAM + UCCB_ACCESS_AUD      Cloudflare Access's sign-in, checked
//   UCCB_HOSTED=1                           on a server: one of those is required
//
// With neither set (the usual, at home behind Tailscale), everything goes
// through as before. Plain JS so server.mjs can use it without a build step.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isLoopback, plainAddress } from './access.mjs';
import {
  Attempts,
  SESSION_COOKIE,
  SESSION_DAYS,
  accessKeys,
  accessTeamUrl,
  checkAccessToken,
  hashPassword,
  isPasswordHash,
  parseCookies,
  readSession,
  safeNext,
  sessionKey,
  signSession,
  verifyPassword,
} from './auth.mjs';

export const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

/** The secret sessions are signed with: UCCB_SESSION_SECRET, or one made once and kept in the data folder. */
function sessionSecret(env, dataDir) {
  if (env.UCCB_SESSION_SECRET?.trim()) return env.UCCB_SESSION_SECRET.trim();
  const file = path.join(dataDir, '.session-secret');
  try {
    const s = readFileSync(file, 'utf8').trim();
    if (s) return s;
  } catch {
    /* not made yet */
  }
  const s = randomBytes(32).toString('base64url');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, s, { mode: 0o600 });
  return s;
}

const page = (title, body) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:dark}body{font-family:system-ui,sans-serif;background:#020617;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
main{width:min(22rem,calc(100vw - 2rem));line-height:1.5}h1{font-size:1.25rem;margin:0 0 1rem}
input{box-sizing:border-box;width:100%;padding:.6rem .75rem;border-radius:.4rem;border:1px solid #334155;background:#0f172a;color:inherit;font-size:1rem}
input:focus{outline:none;border-color:#8b5cf6}button{margin-top:.75rem;width:100%;padding:.6rem;border:0;border-radius:.4rem;background:#7c3aed;color:#fff;font-size:1rem;cursor:pointer}
button:hover{background:#6d28d9}.note{color:#94a3b8;font-size:.9rem}.bad{color:#fca5a5;font-size:.9rem}
</style><body><main>${body}</main></html>`;

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

const loginPage = ({ next, failed, waitMs }) =>
  page(
    'Sign in · UCCB',
    `<h1>Sign in to UCCB</h1>
${waitMs > 0 ? `<p class="bad">Too many wrong passwords. Try again in ${Math.ceil(waitMs / 60_000)} minute${Math.ceil(waitMs / 60_000) === 1 ? '' : 's'}.</p>` : failed ? '<p class="bad">That isn\'t the password.</p>' : ''}
<form method="post" action="/_uccb/login">
<input type="hidden" name="next" value="${esc(next)}">
<input type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" autofocus required>
<button type="submit">Sign in</button>
</form>
<p class="note">You'll stay signed in on this device for ${SESSION_DAYS} days.</p>`,
  );

const ACCESS_ONLY = page(
  'UCCB',
  `<h1>Open UCCB through Cloudflare Access</h1><p>This server only answers requests that come through its Cloudflare Access sign-in. Open it by its Access address and sign in there.</p>`,
);

/** Reads a small form body (the sign-in form). */
function readForm(req, limit = 4096) {
  return new Promise((resolve) => {
    let body = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooBig) return;
      body += chunk;
      if (body.length > limit) {
        tooBig = true;
        body = '';
      }
    });
    req.on('end', () => resolve(new URLSearchParams(tooBig ? '' : body)));
    req.on('error', () => resolve(new URLSearchParams()));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ env?: Record<string, string | undefined>, dataDir: string, keyFor?: (kid: string) => Promise<import('node:crypto').KeyObject | null>, failDelayMs?: number }} opts
 */
export async function createGate({ env = process.env, dataDir, keyFor: keyForOverride, failDelayMs = 500 }) {
  const hosted = truthy(env.UCCB_HOSTED);

  // UCCB's own password: a hash (npm run hash-password), or the password itself.
  let passwordHash = null;
  let passwordId = null;
  if (env.UCCB_PASSWORD_HASH?.trim()) {
    passwordHash = env.UCCB_PASSWORD_HASH.trim();
    if (!isPasswordHash(passwordHash)) throw new Error('UCCB_PASSWORD_HASH isn\'t a hash from "npm run hash-password".');
    passwordId = passwordHash;
  } else if (env.UCCB_PASSWORD) {
    passwordHash = await hashPassword(env.UCCB_PASSWORD);
    passwordId = `plain:${createHash('sha256').update(env.UCCB_PASSWORD).digest('hex')}`;
  }

  // Cloudflare Access.
  const team = env.UCCB_ACCESS_TEAM?.trim() ?? '';
  const audiences = (env.UCCB_ACCESS_AUD ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  if (!!team !== !!audiences.length) throw new Error('Cloudflare Access needs both UCCB_ACCESS_TEAM (your team name) and UCCB_ACCESS_AUD (the application\'s AUD tag).');
  const keyFor = team ? (keyForOverride ?? accessKeys(team)) : null;

  if (hosted && !passwordHash && !keyFor) throw new Error('UCCB_HOSTED is on but no sign-in is set: set UCCB_PASSWORD_HASH (npm run hash-password), Cloudflare Access (UCCB_ACCESS_TEAM and UCCB_ACCESS_AUD), or both. See docs/HOSTING.md.');

  const key = passwordHash ? sessionKey(sessionSecret(env, dataDir), passwordId) : null;
  const attempts = new Attempts();

  /** Who's signing in: Cloudflare's word for it when the request came through the tunnel (on this machine). */
  const clientOf = (req) => {
    const a = plainAddress(req.socket.remoteAddress);
    const cf = req.headers['cf-connecting-ip'];
    return isLoopback(a) && typeof cf === 'string' && cf ? cf : a;
  };
  const secure = (req) => hosted || req.headers['x-forwarded-proto'] === 'https' || /"https"/.test(String(req.headers['cf-visitor'] ?? ''));
  const cookie = (req, value, maxAge) => `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;

  const throughAccess = async (req) => {
    if (!keyFor) return true;
    const token = req.headers['cf-access-jwt-assertion'] || parseCookies(req.headers.cookie).CF_Authorization;
    return (await checkAccessToken(String(token ?? ''), { team, audiences, keyFor })) === null;
  };
  const signedIn = (req) => !key || readSession(key, parseCookies(req.headers.cookie)[SESSION_COOKIE]);

  const send = (res, status, type, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };
  const redirect = (res, to, headers = {}) => {
    res.writeHead(303, { Location: to, 'Cache-Control': 'no-store', ...headers });
    res.end();
  };

  /** Answers the request if it's the gate's to answer (sign-in, or turned away); false lets it through. */
  async function handle(req, res) {
    if (!(await throughAccess(req))) {
      send(res, 403, 'text/html; charset=utf-8', ACCESS_ONLY);
      return true;
    }
    const url = new URL(req.url ?? '/', 'http://uccb');
    const method = String(req.method).toUpperCase();
    if (url.pathname === '/_uccb/status') {
      send(res, 200, 'application/json', JSON.stringify({ hosted, password: !!key, access: !!keyFor, signedIn: signedIn(req) }));
      return true;
    }
    if (!key) return false;
    if (url.pathname === '/_uccb/login') {
      const who = clientOf(req);
      if (method === 'POST') {
        const form = await readForm(req);
        const next = safeNext(form.get('next'));
        const back = `/_uccb/login?next=${encodeURIComponent(next)}`;
        if (attempts.wait(who) > 0) return redirect(res, back), true;
        if (await verifyPassword(form.get('password') ?? '', passwordHash)) {
          attempts.clear(who);
          redirect(res, next, { 'Set-Cookie': cookie(req, signSession(key, Date.now() + SESSION_DAYS * 86_400_000), SESSION_DAYS * 86_400) });
          return true;
        }
        attempts.fail(who);
        console.log(`A wrong UCCB password from ${who}.`);
        await sleep(failDelayMs);
        redirect(res, `${back}&failed=1`);
        return true;
      }
      if (signedIn(req)) return redirect(res, safeNext(url.searchParams.get('next'))), true;
      send(res, 200, 'text/html; charset=utf-8', loginPage({ next: safeNext(url.searchParams.get('next')), failed: url.searchParams.has('failed'), waitMs: attempts.wait(who) }));
      return true;
    }
    if (url.pathname === '/_uccb/logout' && method === 'POST') {
      redirect(res, '/_uccb/login', { 'Set-Cookie': cookie(req, '', 0) });
      return true;
    }
    if (signedIn(req)) return false;
    // A page asks for the sign-in page; anything else (the app's own requests) is told to sign in.
    if (method === 'GET' && String(req.headers.accept ?? '').includes('text/html')) redirect(res, `/_uccb/login?next=${encodeURIComponent(safeNext(url.pathname + url.search))}`);
    else send(res, 401, 'application/json', JSON.stringify({ error: 'Sign in to UCCB first (reload the page).' }), { 'X-UCCB-Sign-In': '1' });
    return true;
  }

  /** Whether a websocket (hot reload, in dev) may connect. */
  const allowsUpgrade = async (req) => (await throughAccess(req)) && signedIn(req);

  return { hosted, password: !!key, access: !!keyFor, accessTeam: keyFor ? accessTeamUrl(team) : '', handle, allowsUpgrade };
}
