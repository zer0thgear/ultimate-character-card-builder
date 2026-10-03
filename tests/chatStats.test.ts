import { describe, expect, it } from 'vitest';
import { sumTallies, tallyChat } from '@/lib/chatStats';
import type { ChatMessage } from '@/types/project';

// How much a chat's been used, for the card lists.

const msg = (role: ChatMessage['role'], ...swipes: string[]): ChatMessage => ({ id: swipes[0], role, swipes, swipe: 0, createdAt: 0 });
const words = (text: string) => text.split(' ').filter(Boolean).length;

describe('tallyChat', () => {
  it('counts messages sent and received, and the tokens in every version', () => {
    const messages = [msg('user', 'hello there'), msg('assistant', 'hi', 'why hello'), msg('system', 'a note to skip'), msg('user', 'bye')];
    expect(tallyChat(messages, words)).toEqual({ sent: 2, received: 1, tokens: 6 });
  });

  it('takes a damaged chat as empty', () => {
    expect(tallyChat(undefined as unknown as ChatMessage[], words)).toEqual({ sent: 0, received: 0, tokens: 0 });
    expect(tallyChat([{ ...msg('user', 'x'), swipes: undefined as unknown as string[] }], words)).toEqual({ sent: 1, received: 0, tokens: 0 });
  });

  it('adds tallies up', () => {
    expect(sumTallies([])).toEqual({ sent: 0, received: 0, tokens: 0 });
    expect(sumTallies([{ sent: 1, received: 2, tokens: 3 }, { sent: 4, received: 5, tokens: 6 }])).toEqual({ sent: 5, received: 7, tokens: 9 });
  });
});
