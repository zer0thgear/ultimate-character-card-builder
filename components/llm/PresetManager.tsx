'use client';

import { useState } from 'react';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { parseStPreset, PresetImportError, type ChatPreset } from '@/lib/stPreset';
import { SortableList, arrayMove } from '@/components/SortableList';
import { AutoTextarea, Button, IconButton, TokenBadge, Toggle, confirmDialog, cx, inputClass, pickFiles } from '@/components/ui';

// SillyTavern chat-completion presets for the test chat: import one, pick
// it, and work its prompt manager as in SillyTavern (turn prompts on and
// off, reorder them, edit them). Edits change UCCB's copy, not the file.

export function PresetPicker() {
  const { presets, chatSettings, setChatSettings, addPreset, removePreset } = useLlmStore();
  const [managing, setManaging] = useState(false);
  const preset = presets.find((p) => p.id === chatSettings.presetId) ?? null;

  const importPreset = async () => {
    const files = await pickFiles('.json', true);
    for (const file of files) {
      try {
        const p = parseStPreset(JSON.parse(await file.text()), file.name);
        addPreset(p);
        toast(`Imported "${p.name}": ${p.order.filter((o) => o.enabled).length} of ${p.order.length} prompts on.`, 'success');
      } catch (err) {
        toast(err instanceof PresetImportError ? err.message : `Couldn't read ${file.name}: ${(err as Error).message}`, 'error');
      }
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs whitespace-nowrap text-slate-400" title="Applies to every chat on every card">Prompt preset (all chats)</span>
        <select value={chatSettings.presetId ?? ''} onChange={(e) => setChatSettings({ presetId: e.target.value || null })} className={cx(inputClass, 'py-1 text-xs')}>
          <option value="">Built-in prompt (set in the chat&apos;s ⚙)</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => void importPreset()} title="Import a SillyTavern chat-completion preset (.json)">
          Import…
        </Button>
        {preset && (
          <>
            <Button size="sm" variant={managing ? 'primary' : 'secondary'} onClick={() => setManaging(!managing)}>
              Prompts
            </Button>
            <IconButton
              title="Remove this preset"
              tone="danger"
              onClick={async () => {
                if (await confirmDialog({ title: `Remove "${preset.name}"?`, body: 'Only UCCB’s copy goes; the file you imported is untouched.', confirmLabel: 'Remove', danger: true })) removePreset(preset.id);
              }}
            >
              🗑
            </IconButton>
          </>
        )}
      </div>
      {preset && (
        <>
          <Toggle checked={chatSettings.presetSamplers} onChange={(presetSamplers) => setChatSettings({ presetSamplers })} label={<span className="text-xs">Use the preset&apos;s samplers ({samplerSummary(preset)})</span>} />
          {managing && <PromptManager preset={preset} />}
        </>
      )}
    </div>
  );
}

function samplerSummary(p: ChatPreset) {
  const s = p.samplers;
  const bits = [
    s.temperature !== undefined && `temp ${s.temperature}`,
    s.top_p !== undefined && s.top_p !== 1 && `top P ${s.top_p}`,
    s.top_k && `top K ${s.top_k}`,
    s.min_p && `min P ${s.min_p}`,
    s.max_tokens && `${s.max_tokens} tokens`,
    p.maxContext && `${Math.round(p.maxContext / 1000)}k context`,
  ].filter(Boolean);
  return bits.join(', ') || 'none set';
}

function PromptManager({ preset }: { preset: ChatPreset }) {
  const updatePreset = useLlmStore((s) => s.updatePreset);
  const [open, setOpen] = useState<string | null>(null);
  const byId = new Map(preset.prompts.map((p) => [p.identifier, p]));
  const setOrder = (order: ChatPreset['order']) => updatePreset(preset.id, { order });
  const setPrompt = (id: string, patch: Partial<ChatPreset['prompts'][number]>) => updatePreset(preset.id, { prompts: preset.prompts.map((p) => (p.identifier === id ? { ...p, ...patch } : p)) });

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] text-slate-500">
        As in SillyTavern&apos;s prompt manager: on/off, drag to reorder, click to edit. Grey entries are placeholders filled from the card or chat. Changes apply to UCCB&apos;s copy only.
      </p>
      <SortableList count={preset.order.length} onMove={(from, to) => setOrder(arrayMove(preset.order, from, to))}>
        {(i, handle) => {
          const item = preset.order[i];
          const p = byId.get(item.identifier);
          if (!p) return null;
          return (
            <div className={cx('rounded border border-slate-800', !item.enabled && 'opacity-50')}>
              <div className="flex items-center gap-1 px-1 py-0.5">
                {handle}
                <Toggle checked={item.enabled} onChange={(enabled) => setOrder(preset.order.map((o, j) => (j === i ? { ...o, enabled } : o)))} />
                <button type="button" disabled={p.marker} onClick={() => setOpen(open === p.identifier ? null : p.identifier)} className={cx('ml-1 min-w-0 flex-1 truncate text-left text-xs', p.marker ? 'text-slate-500 italic' : 'text-slate-200')}>
                  {p.name}
                </button>
                {!p.marker && (
                  <span className={cx('rounded px-1 text-[9px] uppercase', p.role === 'system' ? 'bg-violet-500/15 text-violet-300' : p.role === 'user' ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300')}>{p.role}</span>
                )}
                {p.injectionPosition === 1 && <span className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-300">@depth {p.injectionDepth}</span>}
                {!p.marker && <TokenBadge text={p.content} className="ml-1" />}
              </div>
              {open === p.identifier && !p.marker && (
                <div className="flex flex-col gap-1.5 border-t border-slate-800 p-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <select value={p.role} onChange={(e) => setPrompt(p.identifier, { role: e.target.value as typeof p.role })} className={cx(inputClass, 'w-24 py-0.5 text-[11px]')}>
                      <option value="system">system</option>
                      <option value="user">user</option>
                      <option value="assistant">assistant</option>
                    </select>
                    <select value={p.injectionPosition} onChange={(e) => setPrompt(p.identifier, { injectionPosition: Number(e.target.value) as 0 | 1 })} className={cx(inputClass, 'w-28 py-0.5 text-[11px]')}>
                      <option value={0}>In the order</option>
                      <option value={1}>In the chat</option>
                    </select>
                    {p.injectionPosition === 1 && (
                      <label className="flex items-center gap-1">
                        depth
                        <input type="number" min={0} value={p.injectionDepth} onChange={(e) => setPrompt(p.identifier, { injectionDepth: Math.max(0, Number(e.target.value) || 0) })} className={cx(inputClass, 'w-14 py-0.5 text-[11px]')} />
                      </label>
                    )}
                    {(p.identifier === 'main' || p.identifier === 'jailbreak') && (
                      <Toggle checked={!p.forbidOverrides} onChange={(v) => setPrompt(p.identifier, { forbidOverrides: !v })} label={<span className="text-[11px]">Card may replace it</span>} />
                    )}
                  </div>
                  <AutoTextarea value={p.content} onChange={(e) => setPrompt(p.identifier, { content: e.target.value })} minRows={3} maxRows={16} className="font-mono text-[11px]" />
                </div>
              )}
            </div>
          );
        }}
      </SortableList>
    </div>
  );
}
