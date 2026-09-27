'use client';

import { useState } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import type { NovelAISubscription } from '@/types/novelai';
import { cx } from '@/components/ui';

// The NovelAI account at a glance: Anlas, and for Opus, how much of the free
// V5 allowance is left. Ported from NovelFrontEnd's AccountStatusBar.

// NovelAI's own estimates, from its client: each 1% of the Opus allowance is
// about 17.3 images (so ~1,730 when full), and `timeUntilNextPercent` is how
// many seconds each 1% takes to refill.
const IMAGES_PER_PERCENT = 17.3;
const images = (percent: number) => Math.round(IMAGES_PER_PERCENT * percent);

// Collapsed down to the Anlas line, remembered per device.
const COLLAPSED_KEY = 'uccb-account-collapsed';

function wasCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* private mode */
  }
}

/** The Opus allowance as NovelAI's "More Info" dialog reports it. */
function opusUsage(usage: NovelAISubscription['usage']) {
  // Shown as 0 while negative, and not capped at 100 (it can sit above).
  const percent = usage.isNegative ? 0 : Math.max(0, usage.percent);
  const secondsPerPercent = usage.timeUntilNextPercent;
  const perDay = secondsPerPercent > 0 ? Math.round((86400 / secondsPerPercent) * 10) / 10 : 0;
  // At that rate, how long until it's back to 100%.
  const secondsToFull = secondsPerPercent > 0 && percent < 100 ? (100 - percent) * secondsPerPercent : 0;
  return { percent, perDay, secondsToFull };
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// tier: 0=Paper, 1=Tablet, 2=Scroll, 3=Opus. The free V5 allowance is an
// Opus perk, so that part only shows for tier 3.
export function AccountStatus({ className }: { className?: string }) {
  const { subscription, anlas, error, refresh } = useSubscription();
  const [collapsed, setCollapsed] = useState(wasCollapsed);

  if (error) {
    return (
      <div className={cx('flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300', className)}>
        <span>Couldn&apos;t read your NovelAI balance: {error}</span>
        <button type="button" className="flex-shrink-0 underline hover:text-red-200" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  }
  if (!subscription || anlas === null) return null;

  const opus = subscription.tier === 3;
  const { isNegative } = subscription.usage;
  const { percent, perDay, secondsToFull } = opusUsage(subscription.usage);
  const toggle = () =>
    setCollapsed((was) => {
      rememberCollapsed(!was);
      return !was;
    });
  const anlasLine = (
    <>
      <span>Anlas</span>
      <span className="flex items-center gap-1.5">
        {collapsed && opus && (
          <span className={isNegative ? 'text-red-400' : 'text-violet-300'} title="Opus generations remaining">
            Opus {Math.round(percent)}% ·
          </span>
        )}
        <span className="font-semibold text-slate-200">{anlas.toLocaleString()}</span>
        {opus && <span className="text-slate-500">{collapsed ? '▸' : '▾'}</span>}
      </span>
    </>
  );

  return (
    <div className={cx('flex flex-col gap-2 rounded-md border border-slate-700/50 bg-slate-800/60 px-3 py-2 text-xs', className)}>
      {/* The Anlas line doubles as the toggle; collapsed, it's all that's
          left. Tiers without the Opus allowance have nothing to collapse. */}
      {opus ? (
        <button type="button" onClick={toggle} title={collapsed ? 'Show the Opus allowance' : 'Hide the Opus allowance'} className="flex items-center justify-between text-left text-slate-400 hover:text-slate-200">
          {anlasLine}
        </button>
      ) : (
        <div className="flex items-center justify-between text-slate-400">{anlasLine}</div>
      )}

      {opus && !collapsed && (
        <div className="flex flex-col gap-1" title={`Free V5 generations at normal sizes and up to 28 steps. Image counts are NovelAI's own estimate (about ${IMAGES_PER_PERCENT} per 1%).`}>
          <div className="flex items-center justify-between text-slate-400">
            <span>Opus generations remaining</span>
            <span className={isNegative ? 'text-red-400' : 'text-violet-300'}>
              {Math.round(percent)}%<span className="ml-1 text-slate-500">(~{images(percent).toLocaleString()})</span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/60">
            <div className={cx('h-full rounded-full transition-all', isNegative ? 'bg-red-500' : 'bg-violet-500')} style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
          <p className="text-[11px] text-slate-500">
            {isNegative && 'Used up; V5 generations cost Anlas until it refills. '}
            {percent >= 100
              ? 'Full. It stops refilling at 100%.'
              : perDay > 0
                ? `Refills ${perDay}% a day (~${images(perDay)} images)${secondsToFull > 0 ? `, full in ~${formatDuration(secondsToFull)}` : ''}.`
                : null}
          </p>
        </div>
      )}
    </div>
  );
}
