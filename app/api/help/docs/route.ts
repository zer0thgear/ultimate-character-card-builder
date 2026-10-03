import { getHelpDocs } from '@/lib/server/helpDocs';
import { handle } from '@/lib/server/http';

export async function GET() {
  return handle(async () => Response.json(await getHelpDocs()));
}
