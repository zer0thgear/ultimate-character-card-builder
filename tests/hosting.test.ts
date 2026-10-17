import { createServer, type Server } from 'node:http';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Attempts, accessTeamUrl, checkAccessToken, hashPassword, isPasswordHash, parseCookies, readSession, safeNext, sessionKey, signSession, verifyPassword } from '../scripts/auth.mjs';
import { createGate } from '../scripts/gate.mjs';
import { confineFolder } from '@/lib/server/hostedPaths';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const TEAM = 'myteam';
const AUD = 'aud-tag-123';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** A Cloudflare Access token signed with our test key. */
function accessToken(payload: Record<string, unknown> = {}, key: KeyObject = privateKey, kid = 'k1') {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid });
  const body = b64({ aud: [AUD], iss: 'https://myteam.cloudflareaccess.com', exp: now + 3600, iat: now, email: 'me@example.com', ...payload });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}
const keyFor = async (kid: string) => (kid === 'k1' ? publicKey : null);

describe('signing in (scripts/auth.mjs)', () => {
  it('hashes passwords and checks them', async () => {
    const hash = await hashPassword('correct horse');
    expect(isPasswordHash(hash)).toBe(true);
    expect(hash).not.toContain('$');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
    expect(await verifyPassword('correct horse', 'not a hash')).toBe(false);
  });

  it('signs sessions that run out and can’t be forged', () => {
    const key = sessionKey('secret', 'pw-a');
    const s = signSession(key, Date.now() + 60_000);
    expect(readSession(key, s)).toBe(true);
    expect(readSession(key, s, Date.now() + 120_000)).toBe(false);
    // Another password (or secret) signs everyone out.
    expect(readSession(sessionKey('secret', 'pw-b'), s)).toBe(false);
    const [, sig] = s.split('.');
    expect(readSession(key, `${b64({ exp: Date.now() + 1e12 })}.${sig}`)).toBe(false);
    expect(readSession(key, 'junk')).toBe(false);
  });

  it('reads cookies, and only goes back to this site after signing in', () => {
    expect(parseCookies('a=1; uccb_session=x.y; b=%20')).toEqual({ a: '1', uccb_session: 'x.y', b: ' ' });
    expect(safeNext('/chat?x=1')).toBe('/chat?x=1');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/_uccb/logout', '', undefined]) expect(safeNext(bad)).toBe('/');
  });

  it('makes an address wait after too many wrong passwords', () => {
    const a = new Attempts(3, 60_000);
    for (let i = 0; i < 3; i++) a.fail('1.2.3.4', 1000 + i);
    expect(a.wait('1.2.3.4', 2000)).toBeGreaterThan(0);
    expect(a.wait('5.6.7.8', 2000)).toBe(0);
    expect(a.wait('1.2.3.4', 1000 + 60_001)).toBe(0);
  });

  it('checks Cloudflare Access tokens', async () => {
    const opts = { team: TEAM, audiences: [AUD], keyFor };
    expect(accessTeamUrl('myteam')).toBe('https://myteam.cloudflareaccess.com');
    expect(accessTeamUrl('https://myteam.cloudflareaccess.com/')).toBe('https://myteam.cloudflareaccess.com');
    expect(await checkAccessToken(accessToken(), opts)).toBeNull();
    expect(await checkAccessToken(accessToken({ aud: ['other-app'] }), opts)).toBe('wrong application');
    expect(await checkAccessToken(accessToken({ iss: 'https://evil.cloudflareaccess.com' }), opts)).toBe('wrong team');
    expect(await checkAccessToken(accessToken({ exp: Math.floor(Date.now() / 1000) - 3600 }), opts)).toBe('expired');
    expect(await checkAccessToken(accessToken({}, privateKey, 'k2'), opts)).toBe('unknown key');
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(await checkAccessToken(accessToken({}, other), opts)).toBe('bad signature');
    expect(await checkAccessToken('', opts)).toBe('no token');
  });
});

describe('hosted folders (lib/server/hostedPaths.ts)', () => {
  const root = path.resolve('/srv/uccb/data/files');
  it('keeps folders inside the files folder', () => {
    expect(confineFolder('gens', root)).toBe(path.join(root, 'gens'));
    expect(confineFolder(path.join(root, 'a', 'b'), root)).toBe(path.join(root, 'a', 'b'));
    expect(confineFolder('.', root)).toBe(root);
    expect(confineFolder('../secrets', root)).toBeNull();
    expect(confineFolder(path.resolve('/etc'), root)).toBeNull();
    expect(confineFolder('gens/../../..', root)).toBeNull();
    expect(confineFolder('  ', root)).toBeNull();
  });
});

describe('the gate (scripts/gate.mjs)', () => {
  let server: Server | null = null;
  let dir = '';
  afterEach(() => {
    server?.close();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  /** A server with the gate in front of an app that says "app". */
  async function serve(env: Record<string, string>) {
    dir = mkdtempSync(path.join(tmpdir(), 'uccb-gate-'));
    const gate = await createGate({ env, dataDir: dir, keyFor, failDelayMs: 0 });
    server = createServer(async (req, res) => {
      if (await gate.handle(req, res)) return;
      res.end('app');
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    const go = (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual', ...init });
    return { gate, go };
  }

  it('lets everything through with no sign-in set, and won’t host without one', async () => {
    const { go } = await serve({});
    expect(await (await go('/')).text()).toBe('app');
    await expect(createGate({ env: { UCCB_HOSTED: '1' }, dataDir: dir })).rejects.toThrow(/no sign-in/);
    await expect(createGate({ env: { UCCB_ACCESS_TEAM: TEAM }, dataDir: dir })).rejects.toThrow(/both/);
    await expect(createGate({ env: { UCCB_PASSWORD_HASH: 'oops' }, dataDir: dir })).rejects.toThrow(/hash-password/);
  });

  it('asks for the password, then lets you in for good', async () => {
    const { go } = await serve({ UCCB_HOSTED: '1', UCCB_PASSWORD_HASH: await hashPassword('hunter22') });
    // A page goes to the sign-in page; the app's own requests are told to sign in.
    const page = await go('/chat?x=1', { headers: { accept: 'text/html' } });
    expect(page.status).toBe(303);
    expect(page.headers.get('location')).toBe('/_uccb/login?next=%2Fchat%3Fx%3D1');
    const api = await go('/api/projects');
    expect(api.status).toBe(401);
    expect(api.headers.get('x-uccb-sign-in')).toBe('1');
    expect(await (await go('/_uccb/login?next=/chat')).text()).toContain('Sign in to UCCB');

    const form = (password: string) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password, next: '/chat' }).toString() });
    const wrong = await go('/_uccb/login', form('nope'));
    expect(wrong.headers.get('location')).toContain('failed=1');
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const right = await go('/_uccb/login', form('hunter22'));
    expect(right.status).toBe(303);
    expect(right.headers.get('location')).toBe('/chat');
    const cookie = right.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^uccb_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    const session = cookie.split(';')[0];
    expect(await (await go('/api/projects', { headers: { cookie: session } })).text()).toBe('app');
    expect(await (await go('/_uccb/status', { headers: { cookie: session } })).json()).toEqual({ hosted: true, password: true, access: false, signedIn: true });

    const out = await go('/_uccb/logout', { method: 'POST', headers: { cookie: session } });
    expect(out.headers.get('set-cookie')).toMatch(/^uccb_session=; .*Max-Age=0/);
  });

  it('turns away whoever guesses too often', async () => {
    const { go } = await serve({ UCCB_PASSWORD_HASH: await hashPassword('hunter22') });
    const form = (password: string) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '9.9.9.9' }, body: `password=${password}` });
    for (let i = 0; i < 10; i++) await go('/_uccb/login', form('nope'));
    // Even the right one, for now.
    expect((await go('/_uccb/login', form('hunter22'))).headers.get('set-cookie')).toBeNull();
    // Someone else is fine.
    expect((await go('/_uccb/login', { ...form('hunter22'), headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '8.8.8.8' } })).headers.get('set-cookie')).toContain('uccb_session=');
  });

  it('only answers what came through Cloudflare Access', async () => {
    const { go } = await serve({ UCCB_HOSTED: '1', UCCB_ACCESS_TEAM: TEAM, UCCB_ACCESS_AUD: AUD });
    expect((await go('/')).status).toBe(403);
    expect((await go('/', { headers: { 'cf-access-jwt-assertion': accessToken({ aud: ['other'] }) } })).status).toBe(403);
    expect(await (await go('/', { headers: { 'cf-access-jwt-assertion': accessToken() } })).text()).toBe('app');
    // Its cookie does too.
    expect(await (await go('/', { headers: { cookie: `CF_Authorization=${accessToken()}` } })).text()).toBe('app');
  });

  it('can ask for both', async () => {
    const { go } = await serve({ UCCB_HOSTED: '1', UCCB_ACCESS_TEAM: TEAM, UCCB_ACCESS_AUD: AUD, UCCB_PASSWORD: 'hunter22' });
    // Through Access but not signed in: the password page.
    const r = await go('/', { headers: { accept: 'text/html', 'cf-access-jwt-assertion': accessToken() } });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toContain('/_uccb/login');
    // The password page itself is behind Access.
    expect((await go('/_uccb/login')).status).toBe(403);
  });
});
