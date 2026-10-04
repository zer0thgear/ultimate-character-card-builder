'use client';

import { ACTORS } from '@/types/adventure';
import { useLlmStore } from '@/store/llmStore';
import { useModelPrices } from '@/hooks/useModelPrices';
import { callsPerTurn } from '@/lib/adventure';
import { isOpenRouter, priceLabel } from '@/lib/modelPricing';
import { AutoTextarea, Modal, NumberInput, Select, Toggle, cx, inputClass } from '@/components/ui';
import { openSettings } from '@/components/SettingsDialog';

// ⚙ Actors: which connection each of the adventure's actors uses, and how
// turns run. Shared by every card's adventures.

export function ActorSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connections, chatConnectionId, adventureSettings: s, setAdventureSettings: set } = useLlmStore();
  const unit = useLlmStore((x) => x.priceUnit);
  const prices = useModelPrices(open && connections.some(isOpenRouter));
  const chat = connections.find((c) => c.id === chatConnectionId) ?? connections[0];
  const label = (id: string) => {
    const c = connections.find((x) => x.id === id);
    if (!c) return '';
    const p = isOpenRouter(c) ? prices?.[c.model] : undefined;
    return `${c.name} — ${c.model || 'no model'}${p ? ` · ${priceLabel(p, unit)}` : ''}`;
  };
  return (
    <Modal open={open} onClose={onClose} title="🎲 Adventure: actors and turns">
      <div className="flex flex-col gap-4 text-sm text-slate-300">
        <p className="text-xs text-slate-400">
          Each turn is up to {callsPerTurn(s)} calls: the Director&apos;s plan, the Narrator, and one per acting character. Give the Director a smart model and the Cast a cheap or fast one, or the other way round, to taste.
          {connections.length === 0 && (
            <>
              {' '}
              <button type="button" className="text-violet-300 underline" onClick={() => openSettings('llm')}>
                Add an LLM connection first
              </button>
              .
            </>
          )}
        </p>
        <div className="flex flex-col gap-2">
          {ACTORS.map((a) => (
            <label key={a.id} className="flex flex-col gap-1">
              <span className="text-xs text-slate-300">
                {a.icon} <strong className="font-medium text-slate-100">{a.label}</strong> <span className="text-slate-500">· {a.blurb}</span>
              </span>
              <select
                value={connections.some((c) => c.id === s.connections[a.id]) ? s.connections[a.id] : ''}
                onChange={(e) => set({ connections: { ...s.connections, [a.id]: e.target.value || undefined } })}
                className={cx(inputClass, 'py-1 text-xs')}
              >
                <option value="">Same as the chat{chat ? ` (${label(chat.id)})` : ''}</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {label(c.id)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
          <span>Characters per turn, at most</span>
          <NumberInput value={s.maxActors} min={0} max={6} onChange={(v) => set({ maxActors: v ?? 2 })} className="w-20 text-xs" />
          <span>The story calls you</span>
          <Select value={s.pov} onChange={(pov) => set({ pov })} className="w-56 text-xs" options={[{ value: 'second', label: '"you" (second person)' }, { value: 'third', label: 'by name (third person)' }]} />
          <span title="How much of the story so far each call is sent, in characters (oldest first to go)">Story sent per call</span>
          <span className="flex items-center gap-2">
            <NumberInput value={s.historyBudget} min={2000} max={400000} step={1000} onChange={(v) => set({ historyBudget: v ?? 24000 })} className="w-28 text-xs" />
            <span className="text-slate-500">characters (about {Math.round(s.historyBudget / 4 / 100) / 10}k tokens)</span>
          </span>
        </div>
        <Toggle
          checked={s.autoCast !== false}
          onChange={(autoCast) => set({ autoCast })}
          label="Add newcomers to the Cast"
          title="When the Director brings someone new into the story, they join the adventure's Cast (🌍 World) with a short sheet, so they're played the same way from then on"
        />
        <Toggle checked={s.diceDefault} onChange={(diceDefault) => set({ diceDefault })} label="New adventures roll dice" title="Each adventure has its own 🎲 switch too" />
        <label className="flex flex-col gap-1 text-xs">
          Style notes for the Narrator and the Cast
          <AutoTextarea value={s.style} onChange={(e) => set({ style: e.target.value })} minRows={2} placeholder="Terse and gritty; present tense; no purple prose." className={cx(inputClass, 'text-sm')} />
        </label>
      </div>
    </Modal>
  );
}
