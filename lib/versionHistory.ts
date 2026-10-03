import type { CardVersionInfo, VersionReason } from '@/types/project';

// When the editor keeps a version of the card (the server keeps it; see
// lib/server/versions.ts): at the first edit after a break, so each
// editing session can be gone back to, and before changes to many fields
// at once (an overwrite, a whole-card macro or find and replace, the
// writing assistant's Replace or Append).

/** How long without an edit makes the next one the start of a session. */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Whether an edit now starts a new session, after one at `lastEditAt`. */
export const startsSession = (lastEditAt: number, now: number) => now - lastEditAt >= SESSION_GAP_MS;

export const REASON_LABELS: Record<VersionReason, string> = {
  session: 'Before an editing session',
  overwrite: 'Before an overwrite',
  macro: 'Before a macro',
  assistant: 'Before the assistant changed a field',
  restore: 'Before a restore',
  manual: 'Saved by hand',
};

export const versionTitle = (v: Pick<CardVersionInfo, 'label' | 'reason'>) => v.label || REASON_LABELS[v.reason] || v.reason;
