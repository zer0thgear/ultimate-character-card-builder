'use client';

import { useLlmStore } from '@/store/llmStore';
import { IconButton, cx, inputClass } from '@/components/ui';
import { openSettings } from '@/components/SettingsDialog';
import { useModelPrices } from '@/hooks/useModelPrices';
import { isOpenRouter, priceLabel } from '@/lib/modelPricing';

/** Which LLM connection a feature uses, with a shortcut to add one. An
 *  OpenRouter connection shows its model's price. */
export function ConnectionPicker({ value, onChange, label, className }: { value: string | null; onChange: (id: string) => void; label?: string; className?: string }) {
  const connections = useLlmStore((s) => s.connections);
  const unit = useLlmStore((s) => s.priceUnit);
  const prices = useModelPrices(connections.some(isOpenRouter));
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
  const price = (id: string) => {
    const c = connections.find((x) => x.id === id);
    const p = c && isOpenRouter(c) ? prices?.[c.model] : undefined;
    return p ? ` · ${priceLabel(p, unit)}` : '';
  };
  return (
    <div className={cx('flex items-center gap-2 text-xs text-slate-400', className)}>
      <label className="flex min-w-0 flex-1 items-center gap-2">
        {label && <span className="whitespace-nowrap">{label}</span>}
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, 'py-1 text-xs')}>
          {!connections.some((c) => c.id === value) && <option value="">Choose…</option>}
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.model || 'no model'}
              {price(c.id)}
            </option>
          ))}
        </select>
      </label>
      <IconButton title="Edit this connection: key, model, samplers (Settings → LLM connections)" onClick={() => openSettings('llm', value)}>
        ✎
      </IconButton>
    </div>
  );
}
