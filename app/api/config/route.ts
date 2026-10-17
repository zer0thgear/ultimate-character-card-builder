import { FILES_DIR, getConfig, setConfig } from '@/lib/server/storage';
import { isHosted } from '@/lib/server/hostedPaths';
import { handle, jsonBody } from '@/lib/server/http';
import type { AppConfig } from '@/types/project';

export async function GET() {
  return handle(async () => Response.json(withServer(await getConfig())));
}

const withServer = (cfg: AppConfig): AppConfig => ({ ...cfg, server: isHosted() ? { hosted: true, filesDir: FILES_DIR } : { hosted: false } });

export async function PUT(req: Request) {
  return handle(async () => Response.json(withServer(await setConfig(await jsonBody<Partial<AppConfig>>(req)))));
}
