'use client';

import { TokenBudget } from '@/lib/tokenCount';

interface Props {
  /** This field's tokens. */
  own: number;
  /** Tokens the rest of the request uses from the same budget. */
  others: number;
  budget: TokenBudget;
  /** What `others` is, for the tooltip, e.g. "characters". */
  othersLabel: string;
}

/** A thin usage bar in NovelAI's style: this field bright, the rest of the
 *  shared budget dimmer, amber past 90% and red once text would be cut off. */
export function TokenMeter({ own, others, budget, othersLabel }: Props) {
  const total = own + others;
  const over = total > budget.limit;
  const near = !over && total > budget.limit * 0.9;
  const pct = (n: number) => `${Math.min(100, (n / budget.limit) * 100)}%`;
  const tone = over ? 'bg-red-500' : near ? 'bg-amber-400' : 'bg-violet-400';
  const tokens = (n: number) => `${n} token${n === 1 ? '' : 's'}`;
  const tooltip = [
    budget.perPart ? `This field: ${tokens(own)} (its largest | part)` : `This field: ${tokens(own)}`,
    others ? `${othersLabel}: ${tokens(others)}` : null,
    `Limit: ${budget.limit}${budget.perPart ? ' per | part' : ''}${over ? ` (over by ${total - budget.limit}; the rest gets cut off)` : ''}`,
    'Counts include quality tags and the UC preset; random wildcards count their longest option.',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div className="flex items-center gap-2" title={tooltip}>
      <div className="flex h-1 flex-1 overflow-hidden rounded-full bg-slate-700/60">
        <div className={`${tone} opacity-40`} style={{ width: pct(others) }} />
        <div className={tone} style={{ width: pct(own) }} />
      </div>
      <span
        className={`flex-shrink-0 text-[10px] tabular-nums ${
          over ? 'text-red-400' : near ? 'text-amber-400' : 'text-slate-500'
        }`}
      >
        {total} / {budget.limit}
      </span>
    </div>
  );
}
