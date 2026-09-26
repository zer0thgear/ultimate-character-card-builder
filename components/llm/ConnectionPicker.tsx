'use client';

import { useLlmStore } from '@/store/llmStore';
import { cx, inputClass } from '@/components/ui';
import { openSettings } from '@/components/SettingsDialog';

/** Which LLM connection a feature uses, with a shortcut to add one. */
export function ConnectionPicker({ value, onChange, label, className }: { value: string | null; onChange: (id: string) => void; label?: string; className?: string }) {
  const connections = useLlmStore((s) => s.connections);
  if (connections.length === 0) {
    return (
      <div className={cx('flex items-center gap-2 text-xs text-slate-400', className)}>
        No LLM connection yet.
        <button type="button" className="text-violet-300 underline" onClick={() => openSettings('llm')}>
          Add one in Settings
        </button>
      </div>
    );
  }
  return (
    <label className={cx('flex items-center gap-2 text-xs text-slate-400', className)}>
      {label && <span className="whitespace-nowrap">{label}</span>}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, 'py-1 text-xs')}>
        {!connections.some((c) => c.id === value) && <option value="">Choose…</option>}
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} — {c.model || 'no model'}
          </option>
        ))}
      </select>
    </label>
  );
}
