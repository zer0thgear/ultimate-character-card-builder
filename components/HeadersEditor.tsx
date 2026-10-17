'use client';

import { useState } from 'react';
import { CF_ACCESS_HEADERS, headerAllowed, type ExtraHeaders } from '@/lib/connectionHeaders';
import { Button, IconButton, cx, inputClass } from '@/components/ui';

// A connection's extra headers (lib/connectionHeaders.ts), folded away
// under its other settings: rows of name and value, values hidden like keys.

type Row = { name: string; value: string };

const rowsOf = (h: ExtraHeaders | undefined): Row[] => Object.entries(h ?? {}).map(([name, value]) => ({ name, value }));

/** Give it key={connection id}: its rows are its own while you type. */
export function HeadersEditor({ value, onChange }: { value: ExtraHeaders | undefined; onChange: (h: ExtraHeaders | undefined) => void }) {
  const [rows, setRows] = useState<Row[]>(() => rowsOf(value));
  const [open, setOpen] = useState(() => rows.length > 0);
  const [shown, setShown] = useState(false);
  const save = (next: Row[]) => {
    setRows(next);
    const h: ExtraHeaders = {};
    for (const r of next) if (headerAllowed(r.name.trim())) h[r.name.trim()] = r.value.trim();
    onChange(Object.keys(h).length ? h : undefined);
  };
  const setRow = (i: number, patch: Partial<Row>) => save(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const count = rows.filter((r) => r.name.trim()).length;
  const hasAccess = CF_ACCESS_HEADERS.every((n) => rows.some((r) => r.name.trim().toLowerCase() === n.toLowerCase()));

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-xs text-violet-300 hover:underline">
        + Extra headers{count ? ` (${count})` : ''}
      </button>
    );
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-slate-800 p-2.5 text-xs text-slate-400">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-300">Extra headers</span>
        <span className="text-slate-500">sent to this server with every request, from UCCB&apos;s server</span>
        {rows.length > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShown(!shown)}>
            {shown ? 'Hide values' : 'Show values'}
          </Button>
        )}
      </div>
      {rows.map((r, i) => {
        const bad = r.name.trim() !== '' && !headerAllowed(r.name.trim());
        return (
          <div key={i} className="flex items-center gap-1">
            <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Header-Name" aria-label="Header name" className={cx(inputClass, 'w-2/5 py-1 text-xs', bad && 'border-red-500')} title={bad ? "UCCB sets this one itself (or it isn't a valid name), so it isn't sent" : undefined} />
            <input type={shown ? 'text' : 'password'} value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} placeholder="value" aria-label="Header value" className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs')} autoComplete="off" />
            <IconButton title="Remove this header" tone="danger" onClick={() => save(rows.filter((_, j) => j !== i))}>
              ✕
            </IconButton>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setRows([...rows, { name: '', value: '' }])}>
          + Add a header
        </Button>
        {!hasAccess && (
          <Button
            size="sm"
            onClick={() => save([...rows.filter((r) => r.name.trim() || r.value.trim()), ...CF_ACCESS_HEADERS.filter((n) => !rows.some((r) => r.name.trim().toLowerCase() === n.toLowerCase())).map((name) => ({ name, value: '' }))])}
            title="For a server behind Cloudflare Access: its service token's Client ID and Client Secret (Zero Trust → Access → Service Auth)"
          >
            + Cloudflare Access service token
          </Button>
        )}
      </div>
      {hasAccess && <p className="text-slate-500">Paste the service token&apos;s Client ID and Client Secret, and give the Access application a Service Auth policy that includes the token (docs/HOSTING.md).</p>}
    </div>
  );
}
