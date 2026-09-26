import 'server-only';
import { BadRequestError, NotFoundError } from '@/lib/server/storage';

/** Runs a route handler, turning thrown errors into JSON error responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const status =
      err instanceof NotFoundError || (err as NodeJS.ErrnoException)?.code === 'ENOENT'
        ? 404
        : err instanceof BadRequestError
          ? 400
          : 500;
    if (status === 500) console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

export async function jsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new BadRequestError('Expected a JSON body.');
  }
}

export const bytesResponse = (bytes: Uint8Array | Buffer, type: string, cache = 'no-cache') =>
  new Response(new Uint8Array(bytes), { headers: { 'Content-Type': type, 'Cache-Control': cache } });
