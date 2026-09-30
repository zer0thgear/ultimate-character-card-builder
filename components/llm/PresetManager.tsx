'use client';

import { useState } from 'react';
import { useLlmStore } from '@/store/llmStore';
import { openSettings } from '@/components/SettingsDialog';
import { formatTokens, useTextTokens } from '@/lib/textTokens';
import { toast } from '@/store/uiStore';
import { duplicatePreset, newPreset, newPresetPrompt, parseStPreset, PRESET_EFFORTS, PresetImportError, toStPreset, type ChatPreset, type PresetPrompt, type PresetSamplers } from '@/lib/stPreset';
import { assistablePrompts } from '@/lib/assistPreset';
import { isOpenRouter } from '@/lib/modelPricing';
import { useModelPrices } from '@/hooks/useModelPrices';
import { MaxRequestCost } from '@/components/llm/MaxRequestCost';
import { SortableList, arrayMove } from '@/components/SortableList';
import { AutoTextarea, Button, IconButton, Modal, NumberInput, Tabs, TokenBadge, Toggle, confirmDialog, textDialog, cx, downloadBlob, inputClass, pickFiles } from '@/components/ui';

// SillyTavern chat-completion presets for the test chat: import one or start
// a new one, pick it, and edit it as in SillyTavern's AI Response
// Configuration panel (samplers, the prompt manager, the utility prompts).
// Edits change UCCB's copy; Export writes it back out as a SillyTavern file.

/** The chat's preset picker. With `onEdit`, editing is left to the caller
 *  (Settings → Chat preset, which opens the editor on a given tab). */
export function PresetPicker({ onEdit }: { onEdit?: (tab: EditorTab, presetId?: string) => void } = {}) {
  const { presets, chatSettings, setChatSettings, addPreset } = useLlmStore();
  const [ownEditing, setOwnEditing] = useState(false);
  const setEditing = (on: boolean) => (onEdit ? on && onEdit('samplers') : setOwnEditing(on));
  const editing = !onEdit && ownEditing;
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
  const create = async () => {
    const name = await textDialog({ title: 'New preset', label: "Name (it starts with SillyTavern's default prompts)", initial: 'New preset', confirmLabel: 'Create' });
    if (name === null) return;
    const made = newPreset(name.trim() || 'New preset');
    addPreset(made);
    if (onEdit) onEdit('samplers', made.id);
    else setOwnEditing(true);
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs whitespace-nowrap text-slate-400" title="Applies to every chat on every card">Chat preset (all chats)</span>
        <select value={chatSettings.presetId ?? ''} onChange={(e) => setChatSettings({ presetId: e.target.value || null })} className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs')}>
          <option value="">Built-in prompt (set in the chat&apos;s 🔧)</option>
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
        <Button size="sm" variant="ghost" onClick={() => void create()} title="A new preset with SillyTavern's default prompts">
          + New preset
        </Button>
      </div>
      {preset && <Toggle checked={chatSettings.presetSamplers} onChange={(presetSamplers) => setChatSettings({ presetSamplers })} label={<span className="text-xs">Use the preset&apos;s samplers ({samplerSummary(preset)})</span>} />}
      {preset && editing && <PresetEditor preset={preset} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** The chat toolbar's preset dropdown: every chat's preset, or the built-in
 *  prompt, with a way to the full Chat preset settings. */
export function ChatPresetSelect() {
  const { presets, chatSettings, setChatSettings } = useLlmStore();
  const preset = presets.find((p) => p.id === chatSettings.presetId) ?? null;
  return (
    <select
      value={preset?.id ?? ''}
      onChange={(e) => (e.target.value === '__manage' ? openSettings('chat') : setChatSettings({ presetId: e.target.value || null }))}
      title={preset ? `Chat preset: every chat uses "${preset.name}"` : 'Chat preset: none, the built-in prompt'}
      className={cx(inputClass, 'max-w-36 py-0.5 text-xs', preset && 'border-violet-500/40 text-violet-200')}
    >
      <option value="">Built-in prompt</option>
      {presets.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option value="__manage">Import, edit or add presets…</option>
    </select>
  );
}

/** Settings → Chat preset: the picker, what the chosen preset does at a
 *  glance (its prompts in order, samplers and options, each a click from
 *  its place in the editor), and every preset you have. */
export function ChatPresetTab() {
  const { presets, chatSettings, setChatSettings, updatePreset } = useLlmStore();
  const [editing, setEditing] = useState<{ id: string; tab: EditorTab } | null>(null);
  const preset = presets.find((p) => p.id === chatSettings.presetId) ?? null;
  const editingPreset = editing ? presets.find((p) => p.id === editing.id) : undefined;
  const edit = (tab: EditorTab, id = preset?.id) => id && setEditing({ id, tab });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-500">
        The SillyTavern chat-completion preset the test chat builds its prompt from. It applies to every chat on every card, and stays picked until you change it. The same picker is in the chat&apos;s toolbar and its 🔧 panel.
      </p>
      <PresetPicker onEdit={(tab, id) => edit(tab, id)} />
      {preset ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <OverviewBox title="Prompts, in order" action={<Button size="sm" variant="ghost" onClick={() => edit('prompts')}>Edit…</Button>}>
            <PromptOrderGlance preset={preset} onToggle={(i, enabled) => updatePreset(preset.id, { order: preset.order.map((o, j) => (j === i ? { ...o, enabled } : o)) })} onOpen={() => edit('prompts')} />
          </OverviewBox>
          <div className="flex flex-col gap-3">
            <OverviewBox title="Samplers" action={<Button size="sm" variant="ghost" onClick={() => edit('samplers')}>Edit…</Button>}>
              <SamplerGlance preset={preset} />
            </OverviewBox>
            <OverviewBox title="Other options" action={<Button size="sm" variant="ghost" onClick={() => edit('other')}>Edit…</Button>}>
              <OptionsGlance preset={preset} />
            </OverviewBox>
          </div>
        </div>
      ) : (
        <OverviewBox title="Built-in prompt">
          <p className="text-[11px] text-slate-500">
            With no preset, the chat sends the card as SillyTavern&apos;s default prompt does: this main prompt (or the card&apos;s system prompt), lorebook, description, personality, scenario, your persona, examples, the chat, then post-history instructions. The connection&apos;s own samplers apply.
          </p>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            <span className="flex justify-between">
              Main prompt <TokenBadge text={chatSettings.mainPrompt} />
            </span>
            <AutoTextarea value={chatSettings.mainPrompt} onChange={(e) => setChatSettings({ mainPrompt: e.target.value })} minRows={2} maxRows={8} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Default post-history instructions
            <AutoTextarea value={chatSettings.defaultPostHistory} onChange={(e) => setChatSettings({ defaultPostHistory: e.target.value })} minRows={1} maxRows={6} placeholder="Optional, sent after the chat" />
          </label>
        </OverviewBox>
      )}
      <PresetLibrary onEdit={(p) => edit('samplers', p.id)} />
      {editingPreset && editing && <PresetEditor key={`${editing.id}.${editing.tab}`} preset={editingPreset} initialTab={editing.tab} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OverviewBox({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-md border border-slate-800 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The prompt manager as a list: on/off right here, the rest in the editor. */
function PromptOrderGlance({ preset, onToggle, onOpen }: { preset: ChatPreset; onToggle: (i: number, on: boolean) => void; onOpen: () => void }) {
  const byId = new Map(preset.prompts.map((p) => [p.identifier, p]));
  const on = preset.order.filter((o) => o.enabled);
  const ownText = on.map((o) => byId.get(o.identifier)).filter((p) => p && !p.marker).map((p) => p!.content).join('\n\n');
  const tokens = useTextTokens(ownText);
  return (
    <>
      <ol className="flex flex-col">
        {preset.order.map((item, i) => {
          const p = byId.get(item.identifier);
          if (!p) return null;
          return (
            <li key={item.identifier} className={cx('flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-800/50', !item.enabled && 'opacity-45')}>
              <span className="w-4 text-right text-[10px] text-slate-600 tabular-nums">{i + 1}</span>
              <Toggle checked={item.enabled} onChange={(v) => onToggle(i, v)} />
              <button
                type="button"
                onClick={onOpen}
                title={p.marker ? 'Filled in from the card or chat' : p.content.slice(0, 400) || '(empty)'}
                className={cx('min-w-0 flex-1 truncate text-left text-xs', p.marker ? 'text-slate-500 italic' : 'text-slate-200')}
              >
                {p.name}
              </button>
              {p.injectionPosition === 1 && <span className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-300">@{p.injectionDepth}</span>}
              {!p.marker && <span className={cx('rounded px-1 text-[9px] uppercase', p.role === 'system' ? 'bg-violet-500/15 text-violet-300' : p.role === 'user' ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300')}>{p.role}</span>}
              {!p.marker && <TokenBadge text={p.content} />}
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-slate-500">
        {on.length} of {preset.order.length} on · about {formatTokens(tokens)} tokens of the preset&apos;s own text in every request, before the card and chat. Grey ones are filled in from the card or chat.
      </p>
    </>
  );
}

const SAMPLER_ROWS: [keyof PresetSamplers, string][] = [
  ['temperature', 'Temperature'],
  ['top_p', 'Top P'],
  ['top_k', 'Top K'],
  ['min_p', 'Min P'],
  ['top_a', 'Top A'],
  ['repetition_penalty', 'Repetition penalty'],
  ['frequency_penalty', 'Frequency penalty'],
  ['presence_penalty', 'Presence penalty'],
  ['seed', 'Seed'],
  ['reasoning_effort', 'Reasoning effort'],
];

function GlanceRow({ label, value, dim }: { label: string; value: React.ReactNode; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={cx('truncate text-right tabular-nums', dim ? 'text-slate-600' : 'text-slate-200')}>{value}</span>
    </div>
  );
}

function SamplerGlance({ preset }: { preset: ChatPreset }) {
  const { chatSettings, setChatSettings } = useLlmStore();
  const chat = useLlmStore((st) => st.connections.find((c) => c.id === st.chatConnectionId));
  const prices = useModelPrices(isOpenRouter(chat));
  const price = isOpenRouter(chat) && chat ? prices?.[chat.model] : undefined;
  const s = preset.samplers;
  const used = chatSettings.presetSamplers;
  return (
    <div className="flex flex-col gap-1.5">
      <Toggle checked={used} onChange={(presetSamplers) => setChatSettings({ presetSamplers })} label={<span className="text-xs">Use these (off: the connection&apos;s own)</span>} />
      <div className={cx('flex flex-col gap-0.5', !used && 'opacity-50')}>
        <GlanceRow label="Reply length" value={s.max_tokens ? `${s.max_tokens.toLocaleString()} tokens` : 'not set'} dim={!s.max_tokens} />
        <GlanceRow label="Context size" value={preset.maxContext ? `${preset.maxContext.toLocaleString()} tokens` : 'not set'} dim={!preset.maxContext} />
        {SAMPLER_ROWS.map(([key, label]) => {
          const v = s[key];
          return <GlanceRow key={key} label={label} value={v === undefined || v === '' ? 'not set' : String(v)} dim={v === undefined || v === ''} />;
        })}
      </div>
      <p className="text-[11px] text-slate-500">&quot;Not set&quot; isn&apos;t sent: the connection&apos;s setting or the model&apos;s default applies.</p>
      {chat && price && (
        <MaxRequestCost price={price} contextSize={preset.maxContext ?? chat.params.max_context} maxTokens={(used ? s.max_tokens : undefined) ?? chat.params.max_tokens} className="text-[11px] text-slate-400" />
      )}
    </div>
  );
}

const NAMES_BEHAVIOR: Record<number, string> = { [-1]: 'None', 0: 'Default', 1: 'Completion object', 2: 'In message content' };

function OptionsGlance({ preset: p }: { preset: ChatPreset }) {
  const set = (text: string) => (text.trim() ? 'set' : 'empty');
  return (
    <div className="flex flex-col gap-0.5">
      <GlanceRow label="→ Continue" value={p.continuePrefill ? 'by prefilling the reply' : 'with the nudge prompt'} />
      <GlanceRow label="Impersonation prompt" value={set(p.impersonationPrompt)} dim={!p.impersonationPrompt.trim()} />
      <GlanceRow label="Assistant prefill (Claude)" value={set(p.assistantPrefill)} dim={!p.assistantPrefill.trim()} />
      <GlanceRow label="Send if empty" value={set(p.sendIfEmpty)} dim={!p.sendIfEmpty.trim()} />
      <GlanceRow label="Character names" value={NAMES_BEHAVIOR[p.namesBehavior] ?? String(p.namesBehavior)} />
      <GlanceRow label="Squash system messages" value={p.squashSystemMessages ? 'on' : 'off'} dim={!p.squashSystemMessages} />
    </div>
  );
}

/** Every preset: which the chat and the assistant use, and what to do with each. */
function PresetLibrary({ onEdit }: { onEdit: (p: ChatPreset) => void }) {
  const { presets, chatSettings, setChatSettings, assistSettings } = useLlmStore();
  if (!presets.length) return <p className="text-[11px] text-slate-500">No presets yet: import one from SillyTavern (AI Response Configuration → Export preset), or start one with + New.</p>;
  return (
    <OverviewBox title={`Your presets (${presets.length})`}>
      <ul className="flex flex-col gap-1">
        {presets.map((p) => {
          const inChat = chatSettings.presetId === p.id;
          const inAssist = assistSettings.presetId === p.id;
          return (
            <li key={p.id} className={cx('flex flex-wrap items-center gap-1.5 rounded border px-2 py-1', inChat ? 'border-violet-500/40 bg-violet-500/5' : 'border-slate-800')}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-slate-200">{p.name}</span>
                <span className="text-[10px] text-slate-500">
                  {p.order.filter((o) => o.enabled).length} of {p.order.length} prompts on · {samplerSummary(p)} · added {new Date(p.importedAt).toLocaleDateString()}
                </span>
              </div>
              {inChat && <span className="rounded bg-violet-500/15 px-1.5 text-[10px] text-violet-300">chat</span>}
              {inAssist && <span className="rounded bg-sky-500/15 px-1.5 text-[10px] text-sky-300" title="Settings → Assistant uses it too">assistant</span>}
              {!inChat && (
                <Button size="sm" variant="ghost" onClick={() => setChatSettings({ presetId: p.id })} title="Build the test chat's prompt from this one">
                  Use
                </Button>
              )}
              <IconButton title="Edit" onClick={() => onEdit(p)}>
                ✎
              </IconButton>
              <IconButton title="Duplicate (a copy to experiment on; it becomes the chat's)" onClick={() => copyPreset(p)}>
                ⧉
              </IconButton>
              <IconButton title="Export as a SillyTavern preset file" onClick={() => exportPreset(p)}>
                ⬇
              </IconButton>
              <IconButton title="Remove UCCB's copy" tone="danger" onClick={() => void removePresetAsk(p)}>
                🗑
              </IconButton>
            </li>
          );
        })}
      </ul>
    </OverviewBox>
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

const exportPreset = (preset: ChatPreset) => {
  downloadBlob(JSON.stringify(toStPreset(preset), null, 4), `${preset.name.replace(/[\\/:*?"<>|]+/g, '_')}.json`, 'application/json');
  toast('Exported. In SillyTavern: AI Response Configuration → Import preset.', 'success');
};
const copyPreset = (preset: ChatPreset) => {
  const copy = duplicatePreset(preset);
  useLlmStore.getState().addPreset(copy);
  toast(`Made "${copy.name}"; it's the one in use now.`, 'success');
};
/** Removes UCCB's copy, once you've said so. */
const removePresetAsk = async (preset: ChatPreset) => {
  if (!(await confirmDialog({ title: `Remove "${preset.name}"?`, body: 'Only UCCB’s copy goes; any file you imported or exported is untouched.', confirmLabel: 'Remove', danger: true }))) return false;
  useLlmStore.getState().removePreset(preset.id);
  return true;
};

/** The whole preset, as SillyTavern's AI Response Configuration panel has it. */
function PresetEditor({ preset, onClose, initialTab = 'samplers' }: { preset: ChatPreset; onClose: () => void; initialTab?: EditorTab }) {
  const { updatePreset, chatSettings, setChatSettings } = useLlmStore();
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const set = (patch: Partial<ChatPreset>) => updatePreset(preset.id, patch);

  const exportIt = () => exportPreset(preset);
  const duplicate = () => copyPreset(preset);
  const remove = async () => {
    if (await removePresetAsk(preset)) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Preset"
      size="lg"
      fixedHeight
      pinned={
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Name
            <input value={preset.name} onChange={(e) => set({ name: e.target.value })} className={inputClass} />
          </label>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'samplers', label: 'Samplers' },
              { value: 'prompts', label: 'Prompts', badge: <span className="text-[10px] text-slate-500">{preset.order.filter((o) => o.enabled).length}</span> },
              { value: 'other', label: 'Other prompts & options' },
            ]}
          />
        </div>
      }
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
        {chatSettings.presetId === preset.id && !chatSettings.presetSamplers && tab === 'samplers' && (
          <button type="button" onClick={() => setChatSettings({ presetSamplers: true })} className="rounded-md bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-200">
            The chat is set to ignore the preset&apos;s samplers (the connection&apos;s own apply). Click to use these.
          </button>
        )}
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
