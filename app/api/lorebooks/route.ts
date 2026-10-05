import { listLorebooks, saveLorebook } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import type { BankLorebook } from '@/types/project';

// The Lorebooks bank (lib/lorebookBank.ts): every book, in full (they're
// read whole to build chat prompts), and adding one.

export async function GET() {
  return handle(async () => Response.json(await listLorebooks()));
}

export async function POST(req: Request) {
  return handle(async () => Response.json(await saveLorebook(await jsonBody<BankLorebook>(req))));
}
