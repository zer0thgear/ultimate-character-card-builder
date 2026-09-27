import { describe, expect, it } from 'vitest';
import { isAllowed, isLocalNetwork, isLoopback, isTailscale, plainAddress } from '../scripts/access.mjs';

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
