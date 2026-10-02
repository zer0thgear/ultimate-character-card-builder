'use client';

import { cx } from '@/components/ui';

// A card's source (V3's `source`): where it came from, which the spec leaves
// to the app to record (Import from URL adds the link), so it's shown, not
// edited. Its web links open in a new tab; only http(s) ones, so a card
// can't hand the browser a javascript: or file: link.

/** The source's entries that are web links (trimmed). */
export function webLinks(source: string[] | undefined): string[] {
  return (source ?? []).map((s) => s.trim()).filter((s) => {
    try {
      const url = new URL(s);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  });
}

const linkProps = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** The source, read-only: links open where the card came from. */
export function SourceList({ source }: { source: string[] | undefined }) {
  const entries = (source ?? []).filter((s) => s.trim());
  const links = new Set(webLinks(entries));
  if (!entries.length) return <p className="text-xs text-slate-500">None recorded. Importing a card from a link (🔗) records where it came from.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {entries.map((s, i) => (
        <li key={`${s}-${i}`} className="min-w-0 truncate text-sm">
          {links.has(s.trim()) ? (
            <a href={s.trim()} {...linkProps} className="text-violet-300 hover:underline" title="Open in a new tab">
              {s} ↗
            </a>
          ) : (
            <span className="text-slate-400">{s}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Opens the card's source (its first web link), as SillyTavern's button
 *  does; nothing when it has none. */
export function SourceButton({ source, compact = false, className }: { source: string[] | undefined; compact?: boolean; className?: string }) {
  const [first, ...more] = webLinks(source);
  if (!first) return null;
  return (
    <a
      href={first}
      {...linkProps}
      title={`Open the card's source: ${first}${more.length ? ` (and ${more.length} more in Creator)` : ''}`}
      className={cx('inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700', className)}
    >
      🌐{!compact && ' Source'}
    </a>
  );
}
