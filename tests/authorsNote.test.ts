import { describe, expect, it } from 'vitest';
import { activeAuthorsNote, messagesUntilNote } from '@/lib/authorsNote';
import { buildChatPrompt, DEFAULT_CHAT_SETTINGS, newMessage } from '@/lib/chatPrompt';
import { buildPresetPrompt } from '@/lib/presetPrompt';
import { parseStPreset } from '@/lib/stPreset';
import { chatToStJsonl } from '@/lib/chatExport';
import { newCard } from '@/lib/cardSpec';
import type { AuthorsNote, ChatMessage, ChatSession } from '@/types/project';

const card = () => {
  const c = newCard().data;
  c.name = 'Ann';
  c.description = '{{char}} is a knight.';
  return c;
};

const note = (patch: Partial<AuthorsNote> = {}): AuthorsNote => ({ prompt: '[{{char}} is tired.]', position: 'chat', depth: 4, frequency: 1, role: 'system', ...patch });

/** A greeting, then `n` exchanges. */
const chatOf = (n: number): ChatMessage[] => [
  { ...newMessage('assistant', 'Hello.'), id: 'greeting' },
  ...Array.from({ length: n }, (_, i) => [newMessage('user', `u${i}`), newMessage('assistant', `a${i}`)]).flat(),
];
const settings = { ...DEFAULT_CHAT_SETTINGS, userName: 'Bob' };

describe("author's note frequency, as SillyTavern counts it", () => {
  const users = (n: number) => Array.from({ length: n }, () => ({ role: 'user' as const }));
  it('goes in at each multiple of the frequency, once there are that many user messages', () => {
    expect([0, 1, 2, 3].map((n) => messagesUntilNote(1, users(n)))).toEqual([1, 0, 0, 0]);
    expect([0, 1, 2, 3, 4, 5].map((n) => messagesUntilNote(3, users(n)))).toEqual([3, 2, 1, 0, 1, 2]);
  });
  it('never goes in at frequency 0, or with no text', () => {
    expect(messagesUntilNote(0, users(3))).toBeNull();
    expect(activeAuthorsNote(note({ frequency: 0 }), users(3))).toBeNull();
    expect(activeAuthorsNote(note({ prompt: '  ' }), users(3))).toBeNull();
    expect(activeAuthorsNote(note(), users(3))).not.toBeNull();
  });
});

describe("author's note in the built-in prompt", () => {
  it('goes in the chat at its depth, macros expanded', () => {
    const { parts } = buildChatPrompt(card(), [...chatOf(3), newMessage('user', 'last')], settings, { authorsNote: note({ depth: 2, role: 'user' }) });
    const at = parts.findIndex((p) => p.label.startsWith("Author's note"));
    expect(parts[at]).toEqual({ label: "Author's note (depth 2)", role: 'user', content: '[Ann is tired.]' });
    expect(parts.slice(at + 1).map((p) => p.content)).toEqual(['a2', 'last']);
  });

  it('goes just after or before the main prompt', () => {
    const labels = (position: AuthorsNote['position']) => buildChatPrompt(card(), chatOf(1), settings, { authorsNote: note({ position }) }).parts.map((p) => p.label).slice(0, 3);
    expect(labels('after')).toEqual(['Main prompt', "Author's note", 'Description']);
    expect(labels('before')).toEqual(["Author's note", 'Main prompt', 'Description']);
  });

  it('is left out when it is not its turn', () => {
    const { parts } = buildChatPrompt(card(), chatOf(1), settings, { authorsNote: note({ frequency: 2 }) });
    expect(parts.some((p) => p.label.startsWith("Author's note"))).toBe(false);
  });
});

describe("author's note with a preset", () => {
  const preset = parseStPreset(
    {
      prompts: [
        { identifier: 'main', name: 'Main Prompt', system_prompt: true, role: 'system', content: 'Main.' },
        { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
        { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
      ],
      prompt_order: [{ character_id: 100001, order: ['main', 'charDescription', 'chatHistory'].map((identifier) => ({ identifier, enabled: true })) }],
    },
    'p',
  );

  it('goes beside Main Prompt, or in the chat', () => {
    const labels = (position: AuthorsNote['position']) => buildPresetPrompt(card(), chatOf(1), settings, preset, { authorsNote: note({ position, depth: 0 }) }).parts.map((p) => p.label);
    expect(labels('after').slice(0, 3)).toEqual(['Main Prompt', "Author's note", 'Char Description']);
    expect(labels('before').slice(0, 2)).toEqual(["Author's note", 'Main Prompt']);
    expect(labels('chat').at(-1)).toBe("Author's note (depth 0)");
  });
});

describe("author's note in the SillyTavern export", () => {
  it("goes in the chat's metadata, in SillyTavern's keys", () => {
    const chat: ChatSession = { id: 'c', name: 'c', greeting: -1, messages: [], createdAt: 0, updatedAt: 0, authorsNote: note({ position: 'before', role: 'assistant', frequency: 2 }) };
    const meta = JSON.parse(chatToStJsonl(chat, card(), 'Bob').split('\n')[0]).chat_metadata;
    expect(meta).toEqual({ note_prompt: '[{{char}} is tired.]', note_interval: 2, note_position: 2, note_depth: 4, note_role: 2 });
  });
});

describe("author's note on a branch", () => {
  it('comes along, as a copy', async () => {
    const { branchOf } = await import('@/store/chatStore');
    const chat: ChatSession = { id: 'c', name: 'c', greeting: 0, messages: chatOf(1).slice(1), createdAt: 0, updatedAt: 0, authorsNote: note() };
    const branch = branchOf(chat, 0, 'b', 1);
    expect(branch.authorsNote).toEqual(chat.authorsNote);
    expect(branch.authorsNote).not.toBe(chat.authorsNote);
  });
});

describe("author's note beside a chat summary", () => {
  it('follows the summary on the same side of the main prompt, as SillyTavern orders them', () => {
    const summary = { content: 'So far: a duel.', position: 'after' as const, depth: 2, role: 'system' as const };
    const { parts } = buildChatPrompt(card(), chatOf(1), settings, { authorsNote: note({ position: 'after' }), summary });
    expect(parts.map((p) => p.label).slice(0, 3)).toEqual(['Main prompt', expect.stringMatching(/summary/i), "Author's note"]);
  });
});
