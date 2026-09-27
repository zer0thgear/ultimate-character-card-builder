import { getSettings } from '@/lib/server/storage';
import { handle } from '@/lib/server/http';

/** Every shared settings section, for a browser starting up. */
export async function GET() {
  return handle(async () => Response.json(await getSettings()));
}
