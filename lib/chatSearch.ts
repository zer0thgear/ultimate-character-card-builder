// Finding words in a chat: which messages hold the query, and where in a
// message's text, to mark them. Case doesn't matter.

/** The ids of the messages whose text holds `query`, in chat order. */
export function chatMatches(messages: { id: string; text: string }[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return messages.filter((m) => m.text.toLowerCase().includes(q)).map((m) => m.id);
}

/** `text` cut at each match of `query`, to mark the matches. */
export function splitMatches(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    if (i > at) out.push({ text: text.slice(at, i), hit: false });
    out.push({ text: text.slice(i, i + q.length), hit: true });
    at = i + q.length;
  }
  if (at < text.length || !out.length) out.push({ text: text.slice(at), hit: false });
  return out;
}
