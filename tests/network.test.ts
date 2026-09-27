import { describe, expect, it } from 'vitest';
import { ddnsHostname, duckName, isPrivateIp, looksVirtual } from '@/lib/network';

describe('network helpers', () => {
  it('knows private addresses', () => {
    expect(['192.168.1.11', '10.0.0.5', '172.16.0.1', '172.31.255.1'].every(isPrivateIp)).toBe(true);
    expect(['8.8.8.8', '172.32.0.1', '100.100.1.1'].some(isPrivateIp)).toBe(false);
  });

  it("spots adapters that aren't the LAN", () => {
    expect(looksVirtual('Ethernet 3', '192.168.56.1')).toBe(true); // VirtualBox host-only
    expect(looksVirtual('vEthernet (WSL)', '172.20.0.1')).toBe(true);
    expect(looksVirtual('Tailscale', '100.101.1.2')).toBe(true);
    expect(looksVirtual('Wi-Fi', '192.168.1.12')).toBe(false);
  });

  it('takes a DuckDNS name however it is pasted', () => {
    expect(duckName('My-UCCB')).toBe('my-uccb');
    expect(duckName('my-uccb.duckdns.org')).toBe('my-uccb');
    expect(duckName('https://my-uccb.duckdns.org:3210/')).toBe('my-uccb');
    expect(ddnsHostname({ provider: 'duckdns', domain: 'my-uccb.duckdns.org', hostname: '' })).toBe('my-uccb.duckdns.org');
    expect(ddnsHostname({ provider: 'custom', domain: '', hostname: 'Me.Example.net ' })).toBe('me.example.net');
    expect(ddnsHostname({ provider: 'off', domain: 'x', hostname: 'y' })).toBeNull();
  });
});
