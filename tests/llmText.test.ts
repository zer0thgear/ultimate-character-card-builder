import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "@/lib/server/llm";
import type { LlmEvent } from "@/types/llm";

const sse = (chunks: unknown[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const x of chunks)
          c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(x)}\n\n`));
        c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        c.close();
      },
    }),
    { status: 200 },
  );

const collect = async (g: AsyncGenerator<LlmEvent>) => {
  const out: LlmEvent[] = [];
  for await (const e of g) out.push(e);
  return out;
};

afterEach(() => vi.unstubAllGlobals());

describe("text completion requests", () => {
  it("posts the prompt to /completions and streams choices[].text", async () => {
    const fetch = vi.fn(async () =>
      sse([
        { choices: [{ text: "Hel" }] },
        { choices: [{ text: "lo", finish_reason: "stop" }] },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const events = await collect(
      streamChat(
        {
          connection: {
            kind: "openai",
            baseUrl: "http://localhost:5001/v1",
            apiKey: "",
            model: "m",
            params: { max_tokens: 10, stop: ["<|im_end|>"] },
          },
          messages: [],
          prompt: "<|im_start|>user\nHi",
        },
        new AbortController().signal,
      ),
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:5001/v1/completions");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      prompt: "<|im_start|>user\nHi",
      stop: ["<|im_end|>"],
      stream: true,
    });
    expect(body).not.toHaveProperty("messages");
    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => (e as { text: string }).text)
        .join(""),
    ).toBe("Hello");
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "stop" });
  });

  it("refuses for Claude, which has no text completion", async () => {
    const events = await collect(
      streamChat(
        {
          connection: {
            kind: "anthropic",
            baseUrl: "",
            apiKey: "k",
            model: "m",
            params: { max_tokens: 10 },
          },
          messages: [],
          prompt: "x",
        },
        new AbortController().signal,
      ),
    );
    expect(events[0]).toMatchObject({ type: "error" });
  });
});
