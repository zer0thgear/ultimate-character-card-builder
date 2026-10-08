'use client';

import { useEffect, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useChatStore } from '@/store/chatStore';
import { api } from '@/lib/api';
import { formatTokens } from '@/lib/textTokens';
import type { CardStats, WordCount } from '@/lib/cardStats';
import { Empty, Section, cx } from '@/components/ui';

// 📊 The open card's numbers, across all its chats: for fun, not billing.
// Fetched when the tab opens, and again as its chats change.

const n = (x: number) => x.toLocaleString();
const date = (t: number) => new Date(t).toLocaleDateString([], { dateStyle: 'medium' });
const dayName = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { dateStyle: 'medium' });
};

function Tile({ label, value, hint, small }: { label: string; value: React.ReactNode; hint?: string; /** A date, say: smaller, to fit. */ small?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2" title={hint}>
      <div className={cx('font-semibold text-slate-100 tabular-nums', small ? 'text-base leading-7' : 'text-xl')}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

function Words({ title, words }: { title: string; words: WordCount[] }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-xs text-slate-400">{title}</div>
      {words.length ? (
        <div className="flex flex-wrap gap-1">
          {words.map((w) => (
            <span key={w.word} className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
              {w.word} <span className="text-slate-500 tabular-nums">{w.count}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Not enough said yet.</p>
      )}
    </div>
  );
}

export function StatsPanel() {
  const project = useProjectStore((s) => s.project);
  const id = project?.id;
  const name = project?.card.data.name || 'The character';
  // The open card's chats changing (a message, a reroll) refreshes them.
  const chatList = useChatStore((s) => (s.projectId === id ? s.list : null));
  const [stats, setStats] = useState<CardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    const timer = setTimeout(() => {
      api.cardStats(id).then(
        (s) => live && (setStats(s), setError(null)),
        (err: Error) => live && setError(err.message),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, chatList]);

  if (!project) return null;
  if (error) return <p className="text-sm text-red-300">Couldn&apos;t count: {error}</p>;
  if (!stats) return <p className="animate-pulse text-sm text-slate-500">Counting…</p>;
  const t = stats.totals;
  if (!t.messages) return <Empty>No messages yet. Chat with {name} and the numbers show up here.</Empty>;

  return (
    <div className="flex flex-col gap-5">
      <Section title="📊 All chats">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
          <Tile label={t.chats === 1 ? 'chat' : 'chats'} value={n(t.chats)} />
          <Tile label="messages" value={n(t.messages)} hint="Yours and the character's (system notes aside)" />
          <Tile label="sent by you" value={n(t.sent)} />
          <Tile label={`from ${name}`} value={n(t.received)} />
          <Tile label="tokens written" value={formatTokens(t.tokens)} hint={`${n(t.tokens)} tokens, in every version of every message (an estimate; the prompts sent with each reply aren't counted)`} />
          <Tile label="words (as they read now)" value={n(t.words)} />
          <Tile label="other versions" value={n(t.versions)} hint="Swipes and rerolls beyond each reply's first" />
          <Tile label="continues" value={n(t.continues)} />
        </div>
      </Section>

      <Section title="🗓 When">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
          <Tile small label="first message" value={stats.first ? date(stats.first) : '—'} />
          <Tile small label="last used" value={stats.last ? date(stats.last) : '—'} />
          <Tile label={stats.daysActive === 1 ? 'day chatted' : 'days chatted'} value={n(stats.daysActive)} />
          <Tile small label={stats.busiestDay ? `busiest day (${n(stats.busiestDay.messages)} messages)` : 'busiest day'} value={stats.busiestDay ? dayName(stats.busiestDay.day) : '—'} />
        </div>
      </Section>

      <Section title="✍ Lengths, in words">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
          <Tile label={`${name}'s average reply`} value={n(stats.replies.average)} />
          <Tile label={`${name}'s longest reply`} value={n(stats.replies.longest)} />
          <Tile label="your average message" value={n(stats.yours.average)} />
          <Tile label="your longest message" value={n(stats.yours.longest)} />
        </div>
        {t.pictures > 0 && <p className="mt-2 text-xs text-slate-500">🎨 {n(t.pictures)} {t.pictures === 1 ? 'picture' : 'pictures'} drawn in the chats.</p>}
      </Section>

      <Section title="💬 Favourite words">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Words title={name} words={stats.favouriteWords.char} />
          <Words title="You" words={stats.favouriteWords.you} />
        </div>
      </Section>

      <Section title="Each chat">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-normal">Chat</th>
                <th className="py-1 pr-3 text-right font-normal">Messages</th>
                <th className="py-1 pr-3 text-right font-normal">Sent</th>
                <th className="py-1 pr-3 text-right font-normal">Received</th>
                <th className="py-1 pr-3 text-right font-normal">Tokens</th>
                <th className="py-1 pr-3 text-right font-normal">Words</th>
                <th className="py-1 font-normal">Last used</th>
              </tr>
            </thead>
            <tbody className="text-slate-300 tabular-nums">
              {stats.chats.map((c) => (
                <tr key={c.id} className="border-t border-slate-800">
                  <td className="max-w-56 truncate py-1 pr-3" title={c.name}>
                    {c.name}
                  </td>
                  <td className="py-1 pr-3 text-right">{n(c.messages)}</td>
                  <td className="py-1 pr-3 text-right">{n(c.sent)}</td>
                  <td className="py-1 pr-3 text-right">{n(c.received)}</td>
                  <td className="py-1 pr-3 text-right">{formatTokens(c.tokens)}</td>
                  <td className="py-1 pr-3 text-right">{n(c.words)}</td>
                  <td className="py-1 whitespace-nowrap">{c.last ? date(c.last) : 'Not used yet'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
