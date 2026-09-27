import type { DdnsSettings } from '@/types/project';

// The address rules behind Settings → Other devices, apart from the
// server code so they can be tested.

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];
export const isPrivateIp = (ip: string) => PRIVATE.some((r) => r.test(ip));

/** Adapters that are never the LAN: VPNs, VMs, containers. By name where
 *  Windows names them helpfully; VirtualBox's host-only network by its
 *  default range (Windows just calls it "Ethernet 3"), and Tailscale's
 *  100.64/10. */
const VIRTUAL_NAME = /virtualbox|vmware|vethernet|hyper-v|wsl|docker|tailscale|zerotier|npcap|loopback|bluetooth/i;
export const looksVirtual = (name: string, ip: string) =>
  VIRTUAL_NAME.test(name) || /^192\.168\.56\./.test(ip) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

/** "name", "name.duckdns.org" or a pasted URL, as the bare DuckDNS name. */
export function duckName(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[:/].*$/, '')
    .replace(/\.duckdns\.org$/, '');
}

export function ddnsHostname(d: Pick<DdnsSettings, 'provider' | 'domain' | 'hostname'>): string | null {
  if (d.provider === 'duckdns' && d.domain) return `${duckName(d.domain)}.duckdns.org`;
  if (d.provider === 'custom' && d.hostname) return d.hostname.trim().toLowerCase();
  return null;
}
