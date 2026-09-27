import type { LlmImage, LlmMessage } from '@/types/llm';

// Reshaping a chat for providers stricter than the OpenAI format.

/**
 * Anthropic's Messages API takes the system prompt separately and wants
 * turns to alternate, starting and ending with the user. A roleplay prompt
 * breaks all three: the greeting opens as the assistant, post-history
 * instructions arrive as a late system message, and "continue" ends on the
 * assistant. So: leading system messages become the system prompt; later
 * ones are folded into the user turn they sit beside; runs of one role are
 * merged; and an opening or closing user turn is added when missing.
 */
export type AnthropicContent = string | ({ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: LlmImage['mediaType']; data: string } })[];

export function toAnthropic(messages: LlmMessage[], opts: { prefill?: boolean } = {}): { system: string; messages: { role: 'user' | 'assistant'; content: AnthropicContent }[] } {
  const system: string[] = [];
  let i = 0;
  for (; i < messages.length && messages[i].role === 'system'; i++) system.push(messages[i].content);

  const out: { role: 'user' | 'assistant'; content: string; images: LlmImage[] }[] = [];
  const push = (role: 'user' | 'assistant', content: string, images: LlmImage[] = []) => {
    if (!content.trim() && !images.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = [last.content, content].filter((c) => c.trim()).join('\n\n');
      last.images.push(...images);
    } else out.push({ role, content, images: [...images] });
  };
  for (; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'system') push('user', `[System note: ${m.content}]`);
    // Pictures can only go in a user turn.
    else push(m.role, m.content, m.role === 'user' ? m.images : []);
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '[Start a new chat]', images: [] });
  // A prefill stays last; older Claude models continue it, and newer ones
  // (which refuse prefills) report so rather than silently dropping it.
  if (out[out.length - 1].role !== 'user' && !opts.prefill) out.push({ role: 'user', content: '[Continue]', images: [] });
  return {
    system: system.join('\n\n'),
    // Pictures first, then the words about them, as Anthropic recommends.
    messages: out.map(({ role, content, images }) =>
      images.length
        ? {
            role,
            content: [
              ...images.map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.mediaType, data: im.data } })),
              ...(content.trim() ? [{ type: 'text' as const, text: content }] : []),
            ],
          }
        : { role, content },
    ),
  };
}

/** A message in the OpenAI chat format, its pictures as image parts. */
export function toOpenAiMessage(m: LlmMessage): { role: string; content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] } {
  if (!m.images?.length) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [
      ...(m.content.trim() ? [{ type: 'text' as const, text: m.content }] : []),
      ...m.images.map((im) => ({ type: 'image_url' as const, image_url: { url: `data:${im.mediaType};base64,${im.data}` } })),
    ],
  };
}

/** Added to a provider's error when the request carried pictures, since
 *  the usual cause is a model that can't take them. */
export const VISION_HINT =
  "This request had a picture in it, and the model may not be able to see images. Pick a vision model for it (Claude, GPT-4o or later, Gemini, Qwen-VL, Llama 3.2 Vision…); NovelAI's text models can't.";

/** Parses one line of an SSE stream into its data payload, if any. */
export function sseData(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  return line.slice(5).trimStart();
}
