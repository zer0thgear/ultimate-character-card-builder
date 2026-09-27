import { describe, expect, it } from 'vitest';
import { toAnthropic, toOpenAiMessage } from '@/lib/llmShape';
import { visionMessages } from '@/lib/assist';
import { newCard } from '@/lib/cardSpec';
import type { LlmImage, LlmMessage } from '@/types/llm';

const pic: LlmImage = { mediaType: 'image/jpeg', data: 'AAAA' };

describe('pictures for OpenAI-compatible servers', () => {
  it('sends text and image parts, and plain text when there is no picture', () => {
    expect(toOpenAiMessage({ role: 'user', content: 'Describe her.', images: [pic] })).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Describe her.' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      ],
    });
    expect(toOpenAiMessage({ role: 'user', content: 'Hi' })).toEqual({ role: 'user', content: 'Hi' });
  });
});

describe('pictures for Claude', () => {
  it('puts image blocks before the text, in the user turn', () => {
    const msgs: LlmMessage[] = [
      { role: 'system', content: 'You write cards.' },
      { role: 'user', content: 'Describe her.', images: [pic] },
    ];
    const { system, messages } = toAnthropic(msgs);
    expect(system).toBe('You write cards.');
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
          { type: 'text', text: 'Describe her.' },
        ],
      },
    ]);
  });

  it('keeps pictures when user turns are merged, and leaves text-only turns as strings', () => {
    const { messages } = toAnthropic([
      { role: 'user', content: 'One.', images: [pic] },
      { role: 'user', content: 'Two.' },
      { role: 'assistant', content: 'Reply.' },
    ]);
    expect(messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'text', text: 'One.\n\nTwo.' },
    ]);
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Reply.' });
  });
});

describe('writing from a picture', () => {
  const card = { ...newCard().data, name: 'Edith', first_mes: '*waves*' };

  it('attaches the picture to the request, with the guidance', () => {
    const msgs = visionMessages(card, 'appearance', 'focus on the outfit', [pic]);
    const user = msgs[msgs.length - 1];
    expect(user.role).toBe('user');
    expect(user.images).toEqual([pic]);
    expect(user.content).toContain('physical description');
    expect(user.content).toContain("The creator's instruction: focus on the outfit");
  });

  it('shows a greeting job the greetings so far, and drops empty guidance', () => {
    const user = visionMessages(card, 'greeting', '', [pic]).at(-1)!.content;
    expect(user).toContain('<greeting 1>\n*waves*\n</greeting>');
    expect(user).not.toContain("creator's instruction");
  });
});
