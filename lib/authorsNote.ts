import type { AuthorsNote } from '@/types/project';
import type { ChatMessage } from '@/types/project';

// A chat's author's note, as SillyTavern's Author's Note does it: a prompt
// kept per chat, sent in the chat at a depth (or just after or before the
// main prompt) every so many of the user's messages.

/** SillyTavern's defaults: in the chat, 4 messages up, every time, as system. */
export const DEFAULT_AUTHORS_NOTE: AuthorsNote = { prompt: '', position: 'chat', depth: 4, frequency: 1, role: 'system' };

/** A stored note with SillyTavern's defaults filling any gaps. */
export const authorsNoteOf = (note: Partial<AuthorsNote> | undefined): AuthorsNote => ({ ...DEFAULT_AUTHORS_NOTE, ...note });

/**
 * How many more of the user's messages until the note goes in (0: it goes
 * in this time), or null if its frequency is 0 (never). SillyTavern counts
 * the user's messages in the chat: with frequency n it's sent once there
 * are n of them, and again at each multiple of n.
 */
export function messagesUntilNote(frequency: number, history: Pick<ChatMessage, 'role'>[]): number | null {
  if (!(frequency > 0)) return null;
  const sent = history.filter((m) => m.role === 'user').length;
  return sent >= frequency ? sent % frequency : frequency - sent;
}

/** The note, if it has text and goes in this time. */
export function activeAuthorsNote(note: Partial<AuthorsNote> | undefined, history: Pick<ChatMessage, 'role'>[]): AuthorsNote | null {
  if (!note?.prompt?.trim()) return null;
  const n = authorsNoteOf(note);
  return messagesUntilNote(n.frequency, history) === 0 ? n : null;
}

export const AUTHORS_NOTE_LABEL = "Author's note";
