import { listModels } from '@/lib/server/llm';
import { handle, jsonBody } from '@/lib/server/http';
import type { LlmRequest } from '@/types/llm';

/** POST /api/llm/models — the model ids a connection offers. */
export async function POST(req: Request) {
  return handle(async () => Response.json(await listModels((await jsonBody<LlmRequest>(req)).connection)));
}
