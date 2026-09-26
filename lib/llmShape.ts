import type { LlmMessage } from '@/types/llm';

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
export function toAnthropic(messages: LlmMessage[], opts: { prefill?: boolean } = {}): { system: string; messages: { role: 'user' | 'assistant'; content: string }[] } {
  const system: string[] = [];
  let i = 0;
  for (; i < messages.length && messages[i].role === 'system'; i++) system.push(messages[i].content);

  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  const push = (role: 'user' | 'assistant', content: string) => {
    if (!content.trim()) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else out.push({ role, content });
  };
  for (; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'system') push('user', `[System note: ${m.content}]`);
    else push(m.role, m.content);
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '[Start a new chat]' });
  // A prefill stays last; older Claude models continue it, and newer ones
  // (which refuse prefills) report so rather than silently dropping it.
  if (out[out.length - 1].role !== 'user' && !opts.prefill) out.push({ role: 'user', content: '[Continue]' });
  return { system: system.join('\n\n'), messages: out };
}

/** Parses one line of an SSE stream into its data payload, if any. */
export function sseData(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  return line.slice(5).trimStart();
}
