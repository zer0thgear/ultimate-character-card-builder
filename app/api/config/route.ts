import { getConfig, setConfig } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { AppConfig } from '@/types/project';

// The dynamic-DNS settings (and their token) are /api/network's; they're
// left out here so the token never reaches a browser.
const withoutDdns = ({ ddns: _ddns, ...rest }: AppConfig) => (void _ddns, rest);

export async function GET() {
  return handle(async () => Response.json(withoutDdns(await getConfig())));
}

export async function PUT(req: Request) {
  return handle(async () => {
    const { ddns: _ignored, ...patch } = await jsonBody<Partial<AppConfig>>(req);
    void _ignored;
    return Response.json(withoutDdns(await setConfig(patch)));
  });
}
