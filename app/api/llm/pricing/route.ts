import { openRouterPrices } from '@/lib/server/openrouter';
import { handle } from '@/lib/server/http';

/** GET /api/llm/pricing: OpenRouter's model prices, by model id. */
export async function GET() {
  return handle(async () => Response.json(await openRouterPrices()));
}
