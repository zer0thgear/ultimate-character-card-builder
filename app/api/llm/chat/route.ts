import { streamChat } from '@/lib/server/llm';
import { jsonBody } from '@/lib/server/http';
import type { LlmEvent, LlmRequest } from '@/types/llm';

/**
 * POST /api/llm/chat — streams a completion from the connection in the body
 * as newline-delimited JSON LlmEvents. Closing the request aborts it.
 */
export async function POST(req: Request) {
  const body = await jsonBody<LlmRequest>(req).catch((e: Error) => e);
  if (body instanceof Error) return Response.json({ error: body.message }, { status: 400 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: LlmEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
      try {
        for await (const event of streamChat(body, req.signal)) send(event);
      } catch (err) {
        if (!req.signal.aborted) send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed by the client going away */
        }
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } });
}
