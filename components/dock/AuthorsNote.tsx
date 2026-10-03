'use client';

import { useChatStore } from '@/store/chatStore';
import { authorsNoteOf, messagesUntilNote, DEFAULT_AUTHORS_NOTE } from '@/lib/authorsNote';
import type { AuthorsNote } from '@/types/project';
import { AutoTextarea, Button, Modal, NumberInput, Select, TokenBadge } from '@/components/ui';

// The open chat's author's note, edited in place (it saves with the chat).
// SillyTavern's Author's Note: the same placements, depth, frequency and
// role, kept per chat.

const POSITIONS: { value: AuthorsNote['position']; label: string }[] = [
  { value: 'chat', label: 'In the chat, at a depth' },
  { value: 'after', label: 'After the main prompt' },
  { value: 'before', label: 'Before the main prompt' },
];

const ROLES: { value: AuthorsNote['role']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'user', label: 'User' },
  { value: 'assistant', label: 'Assistant' },
];

/** When the note next goes in, counting the message you send next. */
function nextTime(note: AuthorsNote, messages: { role: string }[]): string {
  if (!note.prompt.trim()) return 'Empty: nothing is sent.';
  const until = messagesUntilNote(note.frequency, [...messages, { role: 'user' }] as { role: 'user' }[]);
  if (until === null) return 'Frequency 0: never sent.';
  if (until === 0) return 'Goes in with the reply to your next message.';
  return `Goes in once you've sent ${until + 1} more messages.`;
}

export function AuthorsNoteDialog({ onClose }: { onClose: () => void }) {
  const chat = useChatStore((s) => s.chat);
  const setAuthorsNote = useChatStore((s) => s.setAuthorsNote);
  if (!chat) return null;
  const note = authorsNoteOf(chat.authorsNote);
  const change = (patch: Partial<AuthorsNote>) => {
    const next = { ...note, ...patch };
    // Back to empty with the defaults: nothing to keep.
    const blank = !next.prompt && (Object.keys(DEFAULT_AUTHORS_NOTE) as (keyof AuthorsNote)[]).every((k) => k === 'prompt' || next[k] === DEFAULT_AUTHORS_NOTE[k]);
    setAuthorsNote(blank ? undefined : next);
  };

  return (
    <Modal open onClose={onClose} title="📝 Author's note" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-500">For this chat only. Sent to the model as SillyTavern sends its Author&apos;s Note; macros like {'{{char}}'} work.</p>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          <span className="flex justify-between">
            Note <TokenBadge text={note.prompt} />
          </span>
          <AutoTextarea autoFocus value={note.prompt} onChange={(e) => change({ prompt: e.target.value })} minRows={3} maxRows={12} placeholder="e.g. [Style: slow burn; keep replies under three paragraphs.]" />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-0.5 text-xs text-slate-400">
            Placement
            <Select value={note.position} onChange={(position) => change({ position })} options={POSITIONS} />
          </label>
          {note.position === 'chat' && (
            <label className="flex w-24 flex-col gap-0.5 text-xs text-slate-400" title="How many messages up from the end of the chat it goes: 0 is after the last one">
              Depth
              <NumberInput value={note.depth} onChange={(v) => change({ depth: v ?? DEFAULT_AUTHORS_NOTE.depth })} min={0} step={1} />
            </label>
          )}
          <label className="flex w-24 flex-col gap-0.5 text-xs text-slate-400" title="Sent every this many of your messages: 1 is every time, 0 never">
            Frequency
            <NumberInput value={note.frequency} onChange={(v) => change({ frequency: v ?? DEFAULT_AUTHORS_NOTE.frequency })} min={0} step={1} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-slate-400">
            Role
            <Select value={note.role} onChange={(role) => change({ role })} options={ROLES} />
          </label>
        </div>
        <p className="text-xs text-slate-500">{nextTime(note, chat.messages)}</p>
      </div>
    </Modal>
  );
}
