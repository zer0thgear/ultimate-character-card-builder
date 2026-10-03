import { describe, expect, it } from 'vitest';
import { hostName, isAllowed, isAllowedHost, isLocalNetwork, isLoopback, isTailscale, plainAddress, refuseRequest } from '../scripts/access.mjs';

describe('who may connect', () => {
  it('reads IPv4 seen through an IPv6 socket', () => {
    expect(plainAddress('::ffff:192.168.1.11')).toBe('192.168.1.11');
    expect(plainAddress('::1')).toBe('::1');
  });

  it('lets this computer in', () => {
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1'].every((a) => isLoopback(a) && isAllowed(a))).toBe(true);
  });

  it('lets Tailscale devices in, and only those', () => {
    expect(['100.64.0.1', '100.101.2.3', '100.127.255.254', '::ffff:100.80.1.1', 'fd7a:115c:a1e0::1234'].every((a) => isTailscale(a) && isAllowed(a))).toBe(true);
    // Just outside Tailscale's 100.64.0.0/10.
    expect(['100.63.255.255', '100.128.0.1'].some(isTailscale)).toBe(false);
  });

  it('keeps the home network out unless it is allowed', () => {
    for (const a of ['192.168.1.20', '::ffff:192.168.1.20', '10.0.0.7', '172.20.1.1', 'fe80::1']) {
      expect(isLocalNetwork(a)).toBe(true);
      expect(isAllowed(a)).toBe(false);
      expect(isAllowed(a, { allowLan: true })).toBe(true);
    }
  });

  it('never lets the internet in', () => {
    for (const a of ['8.8.8.8', '2001:4860::8888', '', 'garbage']) expect(isAllowed(a, { allowLan: true })).toBe(false);
  });
});

describe('which names UCCB answers to', () => {
  it('reads the name out of a Host header', () => {
    expect(hostName('PC.tail1234.ts.net:3210')).toBe('pc.tail1234.ts.net');
    expect(hostName('[::1]:3210')).toBe('::1');
    expect(hostName('127.0.0.1:3210')).toBe('127.0.0.1');
    expect(hostName('fd7a:115c:a1e0::1')).toBe('fd7a:115c:a1e0::1');
  });

  it('answers to this machine, its tailnet and bare machine names', () => {
    for (const h of ['localhost:3210', '127.0.0.1:3210', '[::1]:3210', 'gaming-pc:3210', 'gaming-pc.tail1234.ts.net', 'gaming-pc.local:3210', '100.101.2.3:3210', 'uccb.localhost']) {
      expect(isAllowedHost(h), h).toBe(true);
    }
  });

  it('answers to home-network addresses only when the home network is allowed', () => {
    expect(isAllowedHost('192.168.1.20:3210')).toBe(false);
    expect(isAllowedHost('192.168.1.20:3210', { allowLan: true })).toBe(true);
  });

  it("refuses other websites' names, unless listed", () => {
    for (const h of ['attacker.example:3210', 'localhost.attacker.example', '8.8.8.8:3210', '', 'bad name']) expect(isAllowedHost(h), h).toBe(false);
    expect(isAllowedHost('uccb.home.arpa:3210', { extra: ['uccb.home.arpa'] })).toBe(true);
  });

  it('lets pages read, and only its own pages change things', () => {
    const own = { host: 'localhost:3210', origin: 'http://localhost:3210' };
    expect(refuseRequest({ method: 'POST', ...own })).toBe(null);
    expect(refuseRequest({ method: 'PUT', host: 'pc.tail1234.ts.net', origin: 'https://pc.tail1234.ts.net' })).toBe(null);
    expect(refuseRequest({ method: 'GET', host: 'localhost:3210', origin: 'https://evil.example' })).toBe(null);
    expect(refuseRequest({ method: 'POST', host: 'localhost:3210', origin: 'https://evil.example' })).toBe('origin');
    expect(refuseRequest({ method: 'POST', host: 'localhost:3210', origin: 'http://203.0.113.9' })).toBe('origin');
    expect(refuseRequest({ method: 'DELETE', host: 'localhost:3210', origin: 'null' })).toBe('origin');
    expect(refuseRequest({ method: 'POST', host: 'localhost:3210', fetchSite: 'cross-site' })).toBe('origin');
    // Tools without a browser send no Origin.
    expect(refuseRequest({ method: 'POST', host: 'localhost:3210' })).toBe(null);
  });

  it('refuses a rebound domain even for reads', () => {
    expect(refuseRequest({ method: 'GET', host: 'attacker.example:3210' })).toBe('host');
  });
});
