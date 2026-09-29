'use client';

import { useState } from 'react';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { duplicatePreset, newPreset, newPresetPrompt, parseStPreset, PRESET_EFFORTS, PresetImportError, toStPreset, type ChatPreset, type PresetPrompt, type PresetSamplers } from '@/lib/stPreset';
import { assistablePrompts } from '@/lib/assistPreset';
import { isOpenRouter } from '@/lib/modelPricing';
import { useModelPrices } from '@/hooks/useModelPrices';
import { MaxRequestCost } from '@/components/llm/MaxRequestCost';
import { SortableList, arrayMove } from '@/components/SortableList';
import { AutoTextarea, Button, IconButton, Modal, NumberInput, Tabs, TokenBadge, Toggle, confirmDialog, cx, downloadBlob, inputClass, pickFiles } from '@/components/ui';

// SillyTavern chat-completion presets for the test chat: import one or start
// a new one, pick it, and edit it as in SillyTavern's AI Response
// Configuration panel (samplers, the prompt manager, the utility prompts).
// Edits change UCCB's copy; Export writes it back out as a SillyTavern file.

export function PresetPicker() {
  const { presets, chatSettings, setChatSettings, addPreset } = useLlmStore();
  const [editing, setEditing] = useState(false);
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
  const create = () => {
    const name = prompt('Name for the new preset', 'New preset');
    if (name === null) return;
    addPreset(newPreset(name.trim() || 'New preset'));
    setEditing(true);
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs whitespace-nowrap text-slate-400" title="Applies to every chat on every card">Prompt preset (all chats)</span>
        <select value={chatSettings.presetId ?? ''} onChange={(e) => setChatSettings({ presetId: e.target.value || null })} className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs')}>
          <option value="">Built-in prompt (set in the chat&apos;s ⚙)</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {preset && (
          <Button size="sm" variant="primary" onClick={() => setEditing(true)} title="Samplers, prompts and the rest of the preset">
            Edit…
          </Button>
        )}
        <Button size="sm" onClick={() => void importPreset()} title="Import a SillyTavern chat-completion preset (.json)">
          Import…
        </Button>
        <Button size="sm" variant="ghost" onClick={create} title="A new preset with SillyTavern's default prompts">
          + New
        </Button>
      </div>
      {preset && <Toggle checked={chatSettings.presetSamplers} onChange={(presetSamplers) => setChatSettings({ presetSamplers })} label={<span className="text-xs">Use the preset&apos;s samplers ({samplerSummary(preset)})</span>} />}
      {preset && editing && <PresetEditor preset={preset} onClose={() => setEditing(false)} />}
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

type EditorTab = 'samplers' | 'prompts' | 'other';

/** The whole preset, as SillyTavern's AI Response Configuration panel has it. */
function PresetEditor({ preset, onClose }: { preset: ChatPreset; onClose: () => void }) {
  const { addPreset, updatePreset, removePreset, chatSettings, setChatSettings } = useLlmStore();
  const [tab, setTab] = useState<EditorTab>('samplers');
  const set = (patch: Partial<ChatPreset>) => updatePreset(preset.id, patch);

  const exportIt = () => {
    downloadBlob(JSON.stringify(toStPreset(preset), null, 4), `${preset.name.replace(/[\\/:*?"<>|]+/g, '_')}.json`, 'application/json');
    toast('Exported. In SillyTavern: AI Response Configuration → Import preset.', 'success');
  };
  const duplicate = () => {
    const copy = duplicatePreset(preset);
    addPreset(copy);
    toast(`Made "${copy.name}"; it's the one in use now.`, 'success');
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Remove "${preset.name}"?`, body: 'Only UCCB’s copy goes; any file you imported or exported is untouched.', confirmLabel: 'Remove', danger: true }))) return;
    removePreset(preset.id);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Preset"
      size="lg"
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-red-300" onClick={() => void remove()}>
            Remove
          </Button>
          <Button onClick={duplicate} title="A copy to experiment on">
            Duplicate
          </Button>
          <Button onClick={exportIt} title="Save as a SillyTavern preset file">
            Export
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Name
          <input value={preset.name} onChange={(e) => set({ name: e.target.value })} className={inputClass} />
        </label>
        {chatSettings.presetId === preset.id && !chatSettings.presetSamplers && tab === 'samplers' && (
          <button type="button" onClick={() => setChatSettings({ presetSamplers: true })} className="rounded-md bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-200">
            The chat is set to ignore the preset&apos;s samplers (the connection&apos;s own apply). Click to use these.
          </button>
        )}
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'samplers', label: 'Samplers' },
            { value: 'prompts', label: 'Prompts', badge: <span className="text-[10px] text-slate-500">{preset.order.filter((o) => o.enabled).length}</span> },
            { value: 'other', label: 'Other prompts & options' },
          ]}
        />
        {tab === 'samplers' && <SamplerEditor preset={preset} set={set} />}
        {tab === 'prompts' && <PromptManager preset={preset} />}
        {tab === 'other' && <OtherSettings preset={preset} set={set} />}
      </div>
    </Modal>
  );
}

/** A sampler; blank leaves it to the connection (it isn't sent). */
function SamplerField({ label, hint, value, onChange, step, min, max }: { label: string; hint: string; value: number | undefined; onChange: (v: number | undefined) => void; step: number; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-0.5 text-xs text-slate-400" title={hint}>
      {label}
      <NumberInput value={value} onChange={onChange} step={step} min={min} max={max} allowEmpty placeholder="not set" />
    </label>
  );
}

function SamplerEditor({ preset, set }: { preset: ChatPreset; set: (patch: Partial<ChatPreset>) => void }) {
  const s = preset.samplers;
  // What this preset's context and reply length can cost on the chat's connection.
  const chat = useLlmStore((st) => st.connections.find((c) => c.id === st.chatConnectionId));
  const prices = useModelPrices(isOpenRouter(chat));
  const price = isOpenRouter(chat) && chat ? prices?.[chat.model] : undefined;
  const setS = (patch: Partial<PresetSamplers>) => set({ samplers: { ...s, ...patch } });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-slate-500">
        Blank ones aren&apos;t sent, so the connection&apos;s own setting (or the model&apos;s default) applies. Claude only takes the reply length and reasoning effort; current Claude models refuse the rest.
      </p>
      {chat && price && (
        <p className="text-[11px] text-slate-500">
          With the chat&apos;s connection ({chat.model}):{' '}
          <MaxRequestCost price={price} contextSize={preset.maxContext ?? chat.params.max_context} maxTokens={s.max_tokens ?? chat.params.max_tokens} className="text-[11px] text-slate-400" />
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SamplerField label="Temperature" hint="Randomness: higher is more varied, lower more predictable" value={s.temperature} onChange={(temperature) => setS({ temperature })} step={0.05} min={0} max={2} />
        <SamplerField label="Top P" hint="Only the most likely tokens that together make up this share of the probability" value={s.top_p} onChange={(top_p) => setS({ top_p })} step={0.01} min={0} max={1} />
        <SamplerField label="Top K" hint="Only the K most likely tokens (0: off)" value={s.top_k} onChange={(top_k) => setS({ top_k })} step={1} min={0} />
        <SamplerField label="Min P" hint="Drops tokens less likely than this fraction of the most likely one" value={s.min_p} onChange={(min_p) => setS({ min_p })} step={0.01} min={0} max={1} />
        <SamplerField label="Top A" hint="Drops tokens below this times the top token's probability squared" value={s.top_a} onChange={(top_a) => setS({ top_a })} step={0.01} min={0} max={1} />
        <SamplerField label="Repetition penalty" hint="Above 1 discourages repeating tokens" value={s.repetition_penalty} onChange={(repetition_penalty) => setS({ repetition_penalty })} step={0.01} min={0} max={3} />
        <SamplerField label="Frequency penalty" hint="Discourages tokens by how often they've appeared" value={s.frequency_penalty} onChange={(frequency_penalty) => setS({ frequency_penalty })} step={0.05} min={-2} max={2} />
        <SamplerField label="Presence penalty" hint="Discourages tokens that have appeared at all" value={s.presence_penalty} onChange={(presence_penalty) => setS({ presence_penalty })} step={0.05} min={-2} max={2} />
        <SamplerField label="Seed" hint="The same seed and prompt give the same reply, where the server supports it" value={s.seed} onChange={(seed) => setS({ seed })} step={1} min={0} />
        <SamplerField label="Max reply tokens" hint="How long a reply may be" value={s.max_tokens} onChange={(max_tokens) => setS({ max_tokens })} step={50} min={1} />
        <SamplerField label="Context size (tokens)" hint="History past this (less the reply) is left out, oldest first" value={preset.maxContext} onChange={(maxContext) => set({ maxContext })} step={1024} min={512} />
        <label className="flex flex-col gap-0.5 text-xs text-slate-400" title="How hard a reasoning model thinks (where the model supports it)">
          Reasoning effort
          <select value={s.reasoning_effort ?? ''} onChange={(e) => setS({ reasoning_effort: e.target.value || undefined })} className={cx(inputClass, 'py-1')}>
            <option value="">not set</option>
            {PRESET_EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/** The utility prompts and switches from SillyTavern's panel. */
function OtherSettings({ preset: p, set }: { preset: ChatPreset; set: (patch: Partial<ChatPreset>) => void }) {
  const text = (label: string, hint: string, value: string, onChange: (v: string) => void, rows = 2) => (
    <label className="flex flex-col gap-0.5 text-xs text-slate-400" title={hint}>
      {label}
      <AutoTextarea value={value} onChange={(e) => onChange(e.target.value)} minRows={rows} maxRows={8} className="font-mono text-[11px]" />
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      {text('Impersonation prompt', 'Sent for 🎭 Impersonate', p.impersonationPrompt, (impersonationPrompt) => set({ impersonationPrompt }))}
      {text('Continue nudge', 'Sent for → Continue (unless continuing by prefill); {{lastChatMessage}} is the reply so far', p.continueNudgePrompt, (continueNudgePrompt) => set({ continueNudgePrompt }))}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Toggle checked={p.continuePrefill} onChange={(continuePrefill) => set({ continuePrefill })} label={<span className="text-xs">Continue by prefilling the reply (instead of the nudge)</span>} />
        {p.continuePrefill && (
          <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Added after the reply when continuing by prefill">
            then
            <select value={p.continuePostfix} onChange={(e) => set({ continuePostfix: e.target.value })} className={cx(inputClass, 'w-auto py-0.5 text-xs')}>
              <option value="">nothing</option>
              <option value=" ">a space</option>
              <option value={'\n'}>a new line</option>
              <option value={'\n\n'}>a blank line</option>
            </select>
          </label>
        )}
      </div>
      {text('Send if empty', 'Sent as your turn when you send nothing (blank: nothing is sent)', p.sendIfEmpty, (sendIfEmpty) => set({ sendIfEmpty }), 1)}
      {text('Assistant prefill (Claude only)', 'The start of every reply, written for the model; SillyTavern sends it to Claude only', p.assistantPrefill, (assistantPrefill) => set({ assistantPrefill }), 1)}
      <div className="grid gap-3 sm:grid-cols-2">
        {text('New chat marker', 'Before the chat history', p.newChatPrompt, (newChatPrompt) => set({ newChatPrompt }), 1)}
        {text('New example chat marker', 'Before each example dialogue', p.newExampleChatPrompt, (newExampleChatPrompt) => set({ newExampleChatPrompt }), 1)}
        {text('World info format', '{0} is where the lorebook entries go', p.formats.wi, (wi) => set({ formats: { ...p.formats, wi } }), 1)}
        {text('Scenario format', '{{scenario}} is the card’s scenario', p.formats.scenario, (scenario) => set({ formats: { ...p.formats, scenario } }), 1)}
        {text('Personality format', '{{personality}} is the card’s personality', p.formats.personality, (personality) => set({ formats: { ...p.formats, personality } }), 1)}
        <label className="flex flex-col gap-0.5 text-xs text-slate-400" title="How speakers' names are put in the chat, as SillyTavern's Character Names Behavior">
          Character names
          <select value={p.namesBehavior} onChange={(e) => set({ namesBehavior: Number(e.target.value) })} className={cx(inputClass, 'py-1')}>
            <option value={-1}>None</option>
            <option value={0}>Default</option>
            <option value={1}>Completion object</option>
            <option value={2}>In message content</option>
          </select>
        </label>
      </div>
      <Toggle checked={p.squashSystemMessages} onChange={(squashSystemMessages) => set({ squashSystemMessages })} label={<span className="text-xs">Squash system messages (merge runs of them into one)</span>} />
    </div>
  );
}

function PromptManager({ preset }: { preset: ChatPreset }) {
  const updatePreset = useLlmStore((s) => s.updatePreset);
  const [open, setOpen] = useState<string | null>(null);
  const byId = new Map(preset.prompts.map((p) => [p.identifier, p]));
  const setOrder = (order: ChatPreset['order']) => updatePreset(preset.id, { order });
  const setPrompt = (id: string, patch: Partial<PresetPrompt>) => updatePreset(preset.id, { prompts: preset.prompts.map((p) => (p.identifier === id ? { ...p, ...patch } : p)) });
  const add = () => {
    const p = newPresetPrompt();
    // New prompts go in just before the chat history, as a sensible default.
    const at = preset.order.findIndex((o) => o.identifier === 'chatHistory');
    const order = [...preset.order];
    order.splice(at < 0 ? order.length : at, 0, { identifier: p.identifier, enabled: true });
    updatePreset(preset.id, { prompts: [...preset.prompts, p], order });
    setOpen(p.identifier);
  };
  const remove = async (p: PresetPrompt) => {
    if (p.content.trim() && !(await confirmDialog({ title: `Delete "${p.name}"?`, confirmLabel: 'Delete', danger: true }))) return;
    updatePreset(preset.id, { prompts: preset.prompts.filter((x) => x.identifier !== p.identifier), order: preset.order.filter((o) => o.identifier !== p.identifier) });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[11px] text-slate-500">
          As in SillyTavern&apos;s prompt manager: on/off, drag to reorder, click to edit. Grey entries are placeholders filled from the card or chat.
        </p>
        <Button size="sm" onClick={add}>
          + Prompt
        </Button>
      </div>
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
                    {!p.systemPrompt && (
                      <input value={p.name} onChange={(e) => setPrompt(p.identifier, { name: e.target.value })} className={cx(inputClass, 'w-40 py-0.5 text-[11px]')} title="Name" />
                    )}
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
                    {!p.systemPrompt && (
                      <IconButton title="Delete this prompt" tone="danger" onClick={() => void remove(p)} className="ml-auto">
                        🗑
                      </IconButton>
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

/** The writing assistant's preset: which one, whether its samplers and
 *  prompts apply, and which of its prompts to leave out. Separate from the
 *  chat's, so a roleplay preset can drive chats while the assistant uses
 *  another (or the same one, minus its "write the next reply" prompts). */
export function AssistPresetPicker() {
  const { presets, assistSettings: a, setAssistSettings } = useLlmStore();
  const preset = presets.find((p) => p.id === a.presetId) ?? null;
  const excluded = preset ? (a.excluded[preset.id] ?? []) : [];
  const prompts = preset ? assistablePrompts(preset) : [];
  const toggle = (id: string, on: boolean) =>
    preset && setAssistSettings({ excluded: { ...a.excluded, [preset.id]: on ? excluded.filter((x) => x !== id) : [...excluded, id] } });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs whitespace-nowrap text-slate-400">Assistant preset</span>
        <select value={a.presetId ?? ''} onChange={(e) => setAssistSettings({ presetId: e.target.value || null })} className={cx(inputClass, 'py-1 text-xs')}>
          <option value="">None: the assistant&apos;s own instructions only</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {presets.length === 0 && <p className="text-[11px] text-slate-500">Import presets under Chat preset first; any of them can be used here too.</p>}
      {preset && (
        <>
          <Toggle checked={a.samplers} onChange={(samplers) => setAssistSettings({ samplers })} label={<span className="text-xs">Use its samplers ({samplerSummary(preset)})</span>} />
          <Toggle checked={a.prompts} onChange={(p) => setAssistSettings({ prompts: p })} label={<span className="text-xs">Include its prompts around each request</span>} />
          {a.prompts && (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] text-slate-500">
                Prompts ordered before Chat History go before the assistant&apos;s request, the rest after it. The card is already sent, so placeholders are skipped. Untick any that fight a writing task (say, &quot;write {'{{char}}'}&apos;s next reply&quot;).
              </p>
              {prompts.length === 0 && <p className="text-[11px] text-slate-500">This preset has no prompts of its own switched on.</p>}
              {prompts.map(({ prompt, before }) => (
                <label key={prompt.identifier} className="flex items-center gap-2 rounded border border-slate-800 px-2 py-1 text-xs">
                  <input type="checkbox" checked={!excluded.includes(prompt.identifier)} onChange={(e) => toggle(prompt.identifier, e.target.checked)} className="accent-violet-500" />
                  <span className="min-w-0 flex-1 truncate text-slate-200" title={prompt.content}>
                    {prompt.name}
                  </span>
                  <span className="text-[10px] text-slate-500">{before ? 'before' : 'after'}</span>
                  <TokenBadge text={prompt.content} />
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
