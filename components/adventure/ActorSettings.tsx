'use client';

import { ACTORS, customActorId, type ActorId, type CustomActor } from '@/types/adventure';
import { useLlmStore } from '@/store/llmStore';
import { usePackStore } from '@/store/packStore';
import { useModelPrices } from '@/hooks/useModelPrices';
import { ADVENTURE_TEMPLATES, CUSTOM_ACTOR_EXAMPLES, callsPerTurn, fieldKey } from '@/lib/adventure';
import { isOpenRouter, priceLabel } from '@/lib/modelPricing';
import { AutoTextarea, Button, IconButton, Modal, NumberInput, Select, Toggle, cx, inputClass } from '@/components/ui';
import { openSettings } from '@/components/SettingsDialog';
import { PromptTemplateEditor } from '@/components/llm/PromptTemplateEditor';
import { uuid } from '@/lib/uuid';

// ⚙ Actors: which connection each of the adventure's actors uses, and how
// turns run. Shared by every card's adventures.

export function ActorSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connections, chatConnectionId, adventureSettings: s, setAdventureSettings: set } = useLlmStore();
  const unit = useLlmStore((x) => x.priceUnit);
  const packPrompts = usePackStore((x) => x.layer.adventurePrompts);
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
          Each turn is up to {callsPerTurn(s)} calls: the Director&apos;s plan, one per character with something to add, a passage of narration around each (usually fewer), and one for each of your actors that runs. Give the Director a smart model and the Cast a cheap or fast one, or the other way round, to taste.
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
          {[...ACTORS, ...(s.customActors ?? []).filter((a) => a.enabled !== false && a.name.trim()).map((a) => ({ id: customActorId(a), icon: a.icon || '✦', label: a.name, blurb: a.about || 'One of your actors' }))].map((a: { id: ActorId; icon: string; label: string; blurb: string }) => (
            <label key={a.id} className="flex flex-col gap-1">
              <span className="text-xs text-slate-300">
                {a.icon} <strong className="font-medium text-slate-100">{a.label}</strong> <span className="text-slate-500">· {a.blurb}</span>
              </span>
              <select
                aria-label={`${a.label}'s connection`}
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
        <CustomActors actors={s.customActors ?? []} onChange={(customActors) => set({ customActors })} />
        <PromptTemplateEditor
          templates={ADVENTURE_TEMPLATES}
          base={packPrompts}
          edits={s.prompts ?? {}}
          onChange={(prompts) => set({ prompts })}
          intro={
            <>
              What each actor is told. <code className="text-slate-400">{'{{placeholders}}'}</code> are filled in per call, and a paragraph whose placeholder comes out empty (no style notes, say) is left out. Macros such as {'{{user}}'} and {'{{char}}'} are filled in for the card and you. The story, the world and the Director&apos;s brief are sent with each call.
            </>
          }
        />
      </div>
    </Modal>
  );
}

/** Actors of your own: a prompt, and a field in the Director's plan that
 *  briefs it (or none, to run every turn). */
function CustomActors({ actors, onChange }: { actors: CustomActor[]; onChange: (next: CustomActor[]) => void }) {
  const packActors = usePackStore((s) => s.layer.actors);
  const update = (id: string, patch: Partial<CustomActor>) => onChange(actors.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const add = (from?: Omit<CustomActor, 'id' | 'enabled'>) => onChange([...actors, { name: '', icon: '✦', about: '', prompt: '', brief: '', when: 'after', ...from, id: uuid(), enabled: true }]);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Your actors</div>
      <p className="text-xs text-slate-500">
        Calls of your own each turn, with a prompt you write: an inner voice, a quest log, a rival&apos;s cutaways. Give one a brief and the Director gets a field for it in its plan, and it runs on the turns the Director fills that field; with no brief it runs every turn. Its part shows in the story.
      </p>
      {actors.map((a) => (
        <div key={a.id} className={cx('flex flex-col gap-1.5 rounded-md border border-slate-800 p-2.5 text-xs', a.enabled === false && 'opacity-60')}>
          <div className="flex items-center gap-2">
            <input aria-label="Icon" value={a.icon} onChange={(e) => update(a.id, { icon: e.target.value })} className={cx(inputClass, 'w-12 py-1 text-center')} />
            <input aria-label="Actor name" placeholder="Name" value={a.name} onChange={(e) => update(a.id, { name: e.target.value })} className={cx(inputClass, 'min-w-0 flex-1 py-1')} />
            <Toggle checked={a.enabled !== false} onChange={(enabled) => update(a.id, { enabled })} label="On" />
            <IconButton title="Remove this actor" tone="danger" onClick={() => onChange(actors.filter((x) => x.id !== a.id))}>
              🗑
            </IconButton>
          </div>
          <input aria-label="What it is" placeholder="What it is, for the Director" value={a.about} onChange={(e) => update(a.id, { about: e.target.value })} className={cx(inputClass, 'py-1')} />
          <AutoTextarea aria-label="Its prompt" placeholder="Its prompt: who it is and what it writes. Macros work." value={a.prompt} onChange={(e) => update(a.id, { prompt: e.target.value })} minRows={2} maxRows={10} className="font-mono text-xs" />
          <label className="flex flex-col gap-0.5">
            <span className="text-slate-400">
              The Director&apos;s brief for it {a.brief.trim() && a.name.trim() ? <code className="text-slate-500">&quot;{fieldKey(a)}&quot;</code> : <span className="text-slate-500">(empty: it runs every turn)</span>}
            </span>
            <input aria-label="The Director's brief for it" placeholder="what the Director tells it, e.g. what changed in the goals this turn" value={a.brief} onChange={(e) => update(a.id, { brief: e.target.value })} className={cx(inputClass, 'py-1')} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={a.when ?? 'after'} onChange={(when) => update(a.id, { when })} className="w-56 text-xs" options={[{ value: 'after', label: 'After the turn\'s beats' }, { value: 'before', label: 'Before the beats (after any roll)' }]} />
            <Toggle checked={!!a.private} onChange={(p) => update(a.id, { private: p })} label="Keep it from the Narrator and the Cast" title="Its part still shows to you, and the Director reads it" />
          </div>
          {a.name.trim() && !a.prompt.trim() && a.enabled !== false && <p className="text-amber-300/90">It needs a prompt to take part.</p>}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <Button size="sm" onClick={() => add()}>
          + Actor
        </Button>
        Start from:
        {CUSTOM_ACTOR_EXAMPLES.map((x) => (
          <Button key={x.name} size="sm" variant="ghost" onClick={() => add(x)}>
            {x.icon} {x.name}
          </Button>
        ))}
        {packActors.map(({ from, ...x }, i) => (
          <Button key={`pack-${i}`} size="sm" variant="ghost" onClick={() => add(x)} title={`From the extension pack "${from}"`}>
            {x.icon} {x.name} <span className="text-sky-400/80">🧩</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
