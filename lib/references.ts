import type { CardData } from '@/types/card';
import type { LlmImage, LlmMessage } from '@/types/llm';
import { cardContext, referencesText } from '@/lib/assist';

// References: other cards and pictures attached to an assistant request
// ("write her sister, in the style of this card", "a greeting set here").
// Cards go in as text, like the card being worked on; pictures go with the
// message, for a vision model.

export type Reference =
  | { id: string; kind: 'card'; name: string; card: CardData; thumb?: string }
  | { id: string; kind: 'image'; name: string; image: LlmImage; thumb: string };

/** How much of each card goes in: 8000 characters, shared out when there
 *  are several. */
const cardBudget = (n: number) => Math.max(3000, Math.min(8000, Math.floor(20000 / Math.max(1, n))));

/** The references as the text that goes before the request. */
export function referenceBlock(refs: Reference[]): string {
  const cards = refs.filter((r) => r.kind === 'card');
  const pictures = refs.filter((r) => r.kind === 'image');
  if (!cards.length && !pictures.length) return '';
  const budget = cardBudget(cards.length);
  return referencesText({
    cards: cards.map((r) => `<reference_card name="${r.name.replace(/"/g, "'")}">\n${cardContext(r.card, undefined, budget)}\n</reference_card>`).join('\n\n'),
    pictures: pictures.length
      ? `${pictures.length === 1 ? 'One picture is' : `${pictures.length} pictures are`} attached: ${pictures.map((p) => p.name).join(', ')}.`
      : '',
  });
}

/** A user message with its references: their text first, pictures along. */
export function attachReferences(message: LlmMessage, refs: Reference[] | undefined): LlmMessage {
  if (!refs?.length) return message;
  const block = referenceBlock(refs);
  const images = refs.flatMap((r) => (r.kind === 'image' ? [r.image] : []));
  return {
    ...message,
    content: block ? `${block}\n\n${message.content}` : message.content,
    ...(images.length ? { images: [...(message.images ?? []), ...images] } : {}),
  };
}

/** A job's messages with references on its request (the last user message). */
export function withReferences(messages: LlmMessage[], refs: Reference[]): LlmMessage[] {
  if (!refs.length) return messages;
  const last = messages.map((m) => m.role).lastIndexOf('user');
  if (last < 0) return messages;
  return messages.map((m, i) => (i === last ? attachReferences(m, refs) : m));
}

export const hasPictures = (refs: Reference[] | undefined) => !!refs?.some((r) => r.kind === 'image');
