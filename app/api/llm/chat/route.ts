import { streamChat } from '@/lib/server/llm';
import { jsonBody } from '@/lib/server/http';
import type { LlmEvent, LlmRequest } from '@/types/llm';

const KEEP_ALIVE_MS = 15_000;

/**
 * POST /api/llm/chat — streams a completion from the connection in the body
 * as newline-delimited JSON LlmEvents. Closing the request aborts it.
 * While the model's quiet (thinking, or a slow first token), an empty line
 * goes out every so often: proxies in front of UCCB (Cloudflare's, when
 * it's hosted) close a response that sends nothing for too long. The
 * browser skips empty lines.
 */
export async function POST(req: Request) {
  const body = await jsonBody<LlmRequest>(req).catch((e: Error) => e);
  if (body instanceof Error) return Response.json({ error: body.message }, { status: 400 });
  const encoder = new TextEncoder();
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentAt = Date.now();
      const write = (text: string) => {
        sentAt = Date.now();
        controller.enqueue(encoder.encode(text));
      };
      const send = (e: LlmEvent) => write(JSON.stringify(e) + '\n');
      keepAlive = setInterval(() => {
        if (Date.now() - sentAt < KEEP_ALIVE_MS) return;
        try {
          write('\n');
        } catch {
          /* closed */
        }
      }, KEEP_ALIVE_MS / 3);
      try {
        for await (const event of streamChat(body, req.signal)) send(event);
      } catch (err) {
        if (!req.signal.aborted) send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          /* already closed by the client going away */
        }
      }
    },
    cancel() {
      clearInterval(keepAlive);
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } });
}
