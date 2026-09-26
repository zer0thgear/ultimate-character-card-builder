'use client';

import { create } from 'zustand';
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatTokens, useTextTokens } from '@/lib/textTokens';

// Small shared building blocks, in the slate/violet look NovelFrontEnd uses.

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ─── Buttons ─────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-violet-600 text-white hover:bg-violet-500 disabled:bg-violet-600/40',
  secondary: 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 disabled:opacity-40',
  ghost: 'text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40',
  danger: 'bg-red-600/90 text-white hover:bg-red-500 disabled:opacity-40',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function IconButton({
  title,
  className,
  tone = 'default',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string; tone?: 'default' | 'danger' | 'accent' }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      {...props}
      className={cx(
        'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-30',
        tone === 'danger' ? 'text-slate-400 hover:bg-red-500/15 hover:text-red-400' : tone === 'accent' ? 'text-violet-300 hover:bg-violet-500/15' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
        className,
      )}
    />
  );
}

// ─── Form controls ───────────────────────────────────────────────────────────

export const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none';

export function Toggle({ checked, onChange, label, title, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm text-slate-300 select-none', disabled && 'opacity-40 cursor-not-allowed')} title={title}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative h-4 w-7 flex-shrink-0 rounded-full transition-colors', checked ? 'bg-violet-500' : 'bg-slate-700')}
      >
        <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', checked ? 'left-3.5' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, className, title }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; title?: string }) {
  return (
    <select value={value} title={title} onChange={(e) => onChange(e.target.value as T)} className={cx(inputClass, 'py-1', className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A number input that lets the field be empty while typing and commits
 *  on blur or Enter. `undefined` means "unset". */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  className,
  allowEmpty = false,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value === undefined ? '' : String(value));
  }
  const commit = () => {
    if (draft.trim() === '') {
      if (allowEmpty) onChange(undefined);
      else setDraft(value === undefined ? '' : String(value));
      return;
    }
    let n = Number(draft);
    if (!Number.isFinite(n)) return setDraft(value === undefined ? '' : String(value));
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    onChange(n);
    setDraft(String(n));
  };
  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className={cx(inputClass, 'py-1 tabular-nums', className)}
    />
  );
}

/** A textarea that grows with its content, up to `maxRows`. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxRows?: number }>(
  function AutoTextarea({ minRows = 2, maxRows = 30, className, value, ...props }, outer) {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    const lastWidth = useRef(0);
    const fit = useCallback(() => {
      const el = inner.current;
      // Hidden (a dock panel that isn't open): nothing to measure yet; the
      // observer below fits it once it's shown.
      if (!el || el.offsetParent === null) return;
      const style = getComputedStyle(el);
      const line = parseFloat(style.lineHeight) || 20;
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      el.style.height = '0px';
      const content = el.scrollHeight; // content + padding
      el.style.height = `${Math.min(Math.max(content, minRows * line + padding), maxRows * line + padding) + border}px`;
    }, [minRows, maxRows]);
    useLayoutEffect(fit, [value, fit]);
    useEffect(() => {
      const el = inner.current;
      if (!el) return;
      // Refit when it's shown or its width changes (wrapping changes).
      const ro = new ResizeObserver(([entry]) => {
        const w = Math.round(entry.contentRect.width);
        if (w !== lastWidth.current) {
          lastWidth.current = w;
          fit();
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [fit]);
    return (
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof outer === 'function') outer(el);
          else if (outer) outer.current = el;
        }}
        value={value}
        {...props}
        className={cx(inputClass, 'resize-y leading-relaxed', className)}
      />
    );
  },
);

export function TokenBadge({ text, className }: { text: string; className?: string }) {
  const n = useTextTokens(text);
  return (
    <span className={cx('text-[10px] tabular-nums text-slate-500', className)} title="Estimated tokens (o200k tokenizer; your model may count a little differently)">
      {formatTokens(n)} tok
    </span>
  );
}

/** A labelled card-text field: growing textarea, token count, and a slot
 *  for field actions (assistant, focus mode). */
export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  minRows = 3,
  maxRows = 24,
  actions,
  mono = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  actions?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">{label}</span>
          {hint && <span className="ml-2 text-[11px] text-slate-500">{hint}</span>}
        </div>
        <div className="flex items-center gap-1">
          <TokenBadge text={value} />
          {actions}
        </div>
      </div>
      <AutoTextarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} minRows={minRows} maxRows={maxRows} className={mono ? 'font-mono text-xs' : ''} />
    </div>
  );
}

/** Comma-separated values as chips; type and press Enter or comma to add. */
export function ChipInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = (text: string) => {
    const items = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length) onChange([...values, ...items.filter((i) => !values.includes(i))]);
    setDraft('');
  };
  return (
    <div className={cx(inputClass, 'flex min-h-8 flex-wrap items-center gap-1 py-1')}>
      {values.map((v, i) => (
        <span key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200">
          {v}
          <button type="button" className="text-slate-500 hover:text-red-400" onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label={`Remove ${v}`}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={values.length ? '' : placeholder}
        onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500"
      />
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; badge?: ReactNode }[]; className?: string }) {
  return (
    <div className={cx('flex gap-0.5 overflow-x-auto border-b border-slate-800', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
            value === t.value ? 'border-violet-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200',
          )}
        >
          {t.label}
          {t.badge !== undefined && t.badge !== null && <span className="rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-400">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-[96vw] h-[92vh]' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('flex max-h-[92vh] w-full flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl', width)} role="dialog" aria-modal>
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <IconButton title="Close" onClick={onClose}>
            ✕
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-800 px-4 py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ─── Confirm dialog (promise-based, one at a time) ───────────────────────────

interface ConfirmRequest {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ req: ConfirmRequest | null; set: (r: ConfirmRequest | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.getState().set({ ...opts, resolve }));
}

export function ConfirmHost() {
  const { req, set } = useConfirmStore();
  const close = (ok: boolean) => {
    req?.resolve(ok);
    set(null);
  };
  return (
    <Modal
      open={!!req}
      onClose={() => close(false)}
      title={req?.title}
      size="sm"
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant={req?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {req?.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-300">{req?.body}</div>
    </Modal>
  );
}

// ─── Misc ────────────────────────────────────────────────────────────────────

export function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</h3>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">{children}</div>;
}

/** Reads a picked or dropped file as bytes. */
export async function fileBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Opens the browser's file picker; resolves with the chosen files. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

/** Saves bytes as a download. */
export function downloadBlob(data: Blob | Uint8Array | string, name: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
