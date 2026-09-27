import 'server-only';
import dgram from 'node:dgram';
import os from 'node:os';
import { promises as dns } from 'node:dns';
import { getConfig, setConfig } from '@/lib/server/storage';
import type { DdnsSettings } from '@/types/project';

// Reaching UCCB from other devices on the local network without chasing
// its IP: this machine's LAN address, and a dynamic-DNS name (DuckDNS, or
// any provider with an update URL) kept pointing at it. The name resolves
// to a private address, which only devices on the same network can reach.

import { isPrivateIp, looksVirtual, duckName, ddnsHostname } from '@/lib/network';
export { isPrivateIp, duckName, ddnsHostname };

export interface LanAddress {
  name: string;
  address: string;
  virtual: boolean;
}

export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ name, address: a.address, virtual: looksVirtual(name, a.address) || !isPrivateIp(a.address) });
    }
  }
  return out;
}

/** The address this machine reaches the internet from, which is the one
 *  other devices on the network see. A UDP "connect" picks the route
 *  without sending anything. */
function routedAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    const done = (ip: string | null) => {
      try {
        s.close();
      } catch {
        /* already closed */
      }
      resolve(ip);
    };
    s.on('error', () => done(null));
    try {
      s.connect(53, '8.8.8.8', () => {
        try {
          done(s.address().address);
        } catch {
          done(null);
        }
      });
    } catch {
      done(null);
    }
  });
}

export async function primaryLanIp(): Promise<string | null> {
  const routed = await routedAddress();
  const all = lanAddresses();
  if (routed && isPrivateIp(routed) && all.some((a) => a.address === routed)) return routed;
  return all.find((a) => !a.virtual)?.address ?? null;
}

// ─── Dynamic DNS ─────────────────────────────────────────────────────────────

let running: Promise<DdnsSettings> | null = null;

/**
 * Points the name at this machine's current LAN address. Skipped when the
 * address hasn't changed since the last good update (unless `force`), with
 * a daily refresh anyway.
 */
export function updateDdns(force = false): Promise<DdnsSettings> {
  running ??= (async () => {
    const cfg = await getConfig();
    const d = cfg.ddns;
    if (d.provider === 'off') return d;
    const ip = await primaryLanIp();
    if (!ip) return saveStatus(d, { lastResult: 'No local network address found.' });
    const fresh = d.lastResult === 'ok' && d.lastIp === ip && Date.now() - (d.lastUpdated ?? 0) < 24 * 3600_000;
    if (fresh && !force) return d;

    let url: string;
    if (d.provider === 'duckdns') {
      if (!d.domain || !d.token) return saveStatus(d, { lastResult: 'Needs your DuckDNS name and token.' });
      url = `https://www.duckdns.org/update?domains=${encodeURIComponent(duckName(d.domain))}&token=${encodeURIComponent(d.token)}&ip=${ip}`;
    } else {
      if (!d.customUrl.includes('{ip}')) return saveStatus(d, { lastResult: 'The update URL needs {ip} where the address goes.' });
      url = d.customUrl.replaceAll('{ip}', ip);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const body = (await res.text()).trim();
      // DuckDNS answers 200 either way, with "OK" or "KO" in the body.
      const ok = res.ok && (d.provider !== 'duckdns' || body.startsWith('OK'));
      return saveStatus(d, ok ? { lastIp: ip, lastUpdated: Date.now(), lastResult: 'ok' } : { lastResult: d.provider === 'duckdns' ? 'DuckDNS refused the update: check the name and token.' : `The provider answered ${res.status}: ${body.slice(0, 120)}` });
    } catch (err) {
      return saveStatus(d, { lastResult: `Couldn't reach the provider: ${(err as Error).message}` });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

async function saveStatus(d: DdnsSettings, patch: Partial<DdnsSettings>): Promise<DdnsSettings> {
  const next = { ...d, ...patch };
  await setConfig({ ddns: next });
  return next;
}

/** What the name resolves to from here (through this machine's DNS, which
 *  is usually the router's), to spot a router that blocks it. */
export async function resolveHost(hostname: string): Promise<string | null> {
  try {
    return (await dns.lookup(hostname, { family: 4 })).address;
  } catch {
    return null;
  }
}

/** Checks every few minutes for a new address, from server start. */
export function startDdnsLoop() {
  const g = globalThis as { __uccbDdns?: ReturnType<typeof setInterval> };
  if (g.__uccbDdns) return;
  const tick = () => void updateDdns().catch((err) => console.warn('Dynamic DNS update failed', err));
  setTimeout(tick, 5_000);
  g.__uccbDdns = setInterval(tick, 5 * 60_000);
}
