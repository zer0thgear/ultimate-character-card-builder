import type { UsageTally } from '@/lib/adventure';
import { formatDollars } from '@/lib/modelPricing';
import { formatTokens } from '@/lib/textTokens';

/** "4 calls · 5.1k in / 900 out · $0.004", with "~" where tokens were
 *  estimated and "+ unpriced" where some calls' prices aren't known. */
export function usageLine(t: UsageTally): string {
  if (!t.calls) return 'no calls yet';
  const est = t.estimated ? '~' : '';
  const priced = t.calls - t.unpriced;
  const cost = priced ? ` · ${formatDollars(t.dollars)}${t.unpriced ? ` + ${t.unpriced} unpriced` : ''}` : '';
  return `${t.calls} call${t.calls === 1 ? '' : 's'} · ${est}${formatTokens(t.input)} in / ${est}${formatTokens(t.output)} out${cost}`;
}
