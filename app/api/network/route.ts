import { getConfig, setConfig } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import { ddnsHostname, lanAddresses, primaryLanIp, resolveHost, updateDdns } from '@/lib/server/network';
import type { DdnsSettings } from '@/types/project';

/** What other devices need: the LAN addresses, and the dynamic-DNS name's
 *  state (never its token). */
async function status(req: Request, d?: DdnsSettings) {
  const ddns = d ?? (await getConfig()).ddns;
  const hostname = ddnsHostname(ddns);
  const { token, ...safe } = ddns;
  return {
    port: Number(new URL(req.url).port) || 3210,
    primary: await primaryLanIp(),
    addresses: lanAddresses(),
    ddns: { ...safe, hasToken: !!token, hostname: hostname ?? safe.hostname, resolvesTo: hostname ? await resolveHost(hostname) : null },
  };
}

export async function GET(req: Request) {
  return handle(async () => Response.json(await status(req)));
}

/** Saves the dynamic-DNS settings (a blank token keeps the saved one) and
 *  updates the name straight away. */
export async function PUT(req: Request) {
  return handle(async () => {
    const body = await jsonBody<Partial<DdnsSettings>>(req);
    const cur = (await getConfig()).ddns;
    const next: DdnsSettings = {
      ...cur,
      provider: body.provider ?? cur.provider,
      domain: body.domain ?? cur.domain,
      customUrl: body.customUrl ?? cur.customUrl,
      hostname: body.hostname ?? cur.hostname,
      token: body.token?.trim() ? body.token.trim() : cur.token,
      // New settings: the next update isn't skipped as "unchanged".
      lastResult: undefined,
    };
    await setConfig({ ddns: next });
    return Response.json(await status(req, await updateDdns(true)));
  });
}

/** Updates the name now. */
export async function POST(req: Request) {
  return handle(async () => Response.json(await status(req, await updateDdns(true))));
}
