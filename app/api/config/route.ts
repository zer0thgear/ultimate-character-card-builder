import { getConfig, setConfig } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { AppConfig } from '@/types/project';

export async function GET() {
  return handle(async () => Response.json(await getConfig()));
}

export async function PUT(req: Request) {
  return handle(async () => Response.json(await setConfig(await jsonBody<Partial<AppConfig>>(req))));
}
