'use client';

import { useEffect } from 'react';
import type { ChatSession } from '@/types/project';
import type { GroupHost } from '@/components/dock/chatHost';
import { castScene, memberName } from '@/lib/groupChat';
import { useChatStore } from '@/store/chatStore';
import { cx, inputClass } from '@/components/ui';

// A group chat's bar above the message box: who replies next (the group's
// order, or someone you pick), ▶ to let them speak without writing
// anything, Auto (members carry on by themselves), and, for the Cast
// strategy, who's in the scene for that reply (click someone to mark them
// in or out of this chat's scene).

const ORDER_NAMES = { natural: 'natural order', list: 'list order', manual: 'you pick', pooled: 'pooled order', model: 'the model' } as const;

export function GroupTurnBar({
  g,
  chat,
  replyAs,
  setReplyAs,
  nextSpeaker,
  busy,
  onNext,
  auto,
  setAuto,
  holdAuto,
}: {
  g: GroupHost;
  chat: ChatSession;
  replyAs: string | null;
  setReplyAs: (id: string | null) => void;
  /** Who the scene is shown for (who'd reply now, if anyone can say). */
  nextSpeaker: string | undefined;
  busy: boolean;
  onNext: () => void;
  auto: boolean;
  setAuto: (on: boolean) => void;
  /** Auto waits while you're typing. */
  holdAuto: boolean;
}) {
  const setPresence = useChatStore((s) => s.setPresence);
  const s = g.group.settings;
  const delay = s.autoDelay ?? 5;
  // Auto: the next member replies a few seconds after the last reply.
  useEffect(() => {
    if (!auto || busy || holdAuto) return;
    const t = setTimeout(onNext, delay * 1000);
    return () => clearTimeout(t);
  }, [auto, busy, holdAuto, chat.messages.length, delay, onNext]);

  const cast = s.strategy === 'cast' && nextSpeaker && g.memberOf(nextSpeaker) ? castScene(g.members, nextSpeaker, chat.messages, s, chat.presence) : null;
  return (
    <div className="flex flex-col gap-1 text-xs text-slate-400">
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1">
          Next:
          <select value={replyAs ?? ''} onChange={(e) => setReplyAs(e.target.value || null)} className={cx(inputClass, 'py-0.5 text-xs')}>
            <option value="">{s.order === 'manual' ? 'Pick who…' : `By ${ORDER_NAMES[s.order]}`}</option>
            {g.members.map((m) => (
              <option key={m.id} value={m.id}>
                {memberName(m.card)}
                {m.muted ? ' (muted)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={onNext} title="Let the next member speak, without writing anything yourself" className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-violet-500 disabled:opacity-40">
          ▶ Next reply
        </button>
        <button
          type="button"
          aria-pressed={auto}
          onClick={() => setAuto(!auto)}
          title={`Auto: members keep the conversation going by themselves, ${delay} s after each reply (it waits while you type)`}
          className={cx('rounded border px-2 py-0.5', auto ? 'border-violet-500 bg-violet-600/30 text-violet-100' : 'border-slate-700 text-slate-300 hover:border-violet-500')}
        >
          {auto ? '⏸ Auto' : '⏵ Auto'}
        </button>
      </div>
      {cast && (
        <div className="flex flex-wrap items-center gap-1" title="Who the next reply's prompt has in full (the speaker and the scene) and who as a summary (off-stage). Click someone to mark them in or out of this chat's scene; click again to go back to what they do.">
          <span>Scene for {g.memberOf(nextSpeaker)?.card && memberName(g.memberOf(nextSpeaker)!.card)}:</span>
          {cast.map((p) => {
            const marked = chat.presence?.[p.id];
            const cycle = () => setPresence(p.id, p.tier === 'speaker' ? marked : marked === undefined ? (p.tier === 'scene' ? 'out' : 'in') : undefined);
            return (
              <button
                key={p.id}
                type="button"
                disabled={p.tier === 'speaker'}
                onClick={cycle}
                title={p.tier === 'speaker' ? `${p.name}: speaking` : `${p.name}: ${p.tier === 'scene' ? 'in the scene' : 'off-stage'} (${p.why})`}
                className={cx(
                  'rounded-full border px-2 py-px',
                  p.tier === 'speaker' ? 'border-violet-500 text-violet-200' : p.tier === 'scene' ? 'border-emerald-600/70 text-emerald-200' : 'border-slate-700 text-slate-500',
                  marked && 'border-dashed',
                )}
              >
                {p.tier === 'speaker' ? '🗣 ' : p.tier === 'scene' ? '● ' : '○ '}
                {p.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
