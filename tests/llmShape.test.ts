import { describe, expect, it } from 'vitest';
import { toAnthropic } from '@/lib/llmShape';

describe('toAnthropic', () => {
  it('lifts leading system messages, opens and closes on the user, merges runs', () => {
    const r = toAnthropic([
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
      { role: 'assistant', content: 'Greeting' },
      { role: 'user', content: 'Hi' },
      { role: 'user', content: 'There' },
      { role: 'system', content: 'PHI' },
      { role: 'assistant', content: 'Reply' },
    ]);
    expect(r.system).toBe('A\n\nB');
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(r.messages[2].content).toBe('Hi\n\nThere\n\n[System note: PHI]');
  });
});
