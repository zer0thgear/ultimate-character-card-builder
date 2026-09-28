'use client';

import { create } from 'zustand';
import { useEffect, useMemo, useState } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useConfigStore, useUiStore, toast } from '@/store/uiStore';
import { useLlmStore, requestConnection } from '@/store/llmStore';
import { REASONING_EFFORTS, type LlmConnection, type ProviderKind, type SamplerParams } from '@/types/llm';
import { api, streamLlm } from '@/lib/api';
import { AutoTextarea, Button, IconButton, Modal, NumberInput, Select, Tabs, Toggle, confirmDialog, cx, inputClass } from '@/components/ui';
import { AssistPresetPicker, PresetPicker } from '@/components/llm/PresetManager';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { PersonaManager } from '@/components/llm/Personas';
import { MessageList, inspectAssistRun } from '@/components/llm/AssistTrace';
import { useAssistLog } from '@/store/assistLog';
import { assistRequest } from '@/hooks/useLlmStream';
import { ASSIST_JOBS, ASSIST_TEMPLATES, DEFAULT_TEMPLATES } from '@/lib/assist';
import { newCard } from '@/lib/cardSpec';
import { useModelPrices } from '@/hooks/useModelPrices';
import { formatPrice, isOpenRouter, priceLabel } from '@/lib/modelPricing';
import { useProjectStore } from '@/store/projectStore';
import { AccountStatus } from '@/components/AccountStatus';
import { ExtensionSettings, hasExtensionSettings } from '@/components/ExtensionSlots';
import { ImageConnectionsTab } from '@/components/ImageConnectionsSettings';

type SettingsTab = 'general' | 'folders' | 'image' | 'llm' | 'chat' | 'assist' | 'personas' | 'extensions';

const useSettingsDialog = create<{ tab: SettingsTab | null; set: (t: SettingsTab | null) => void }>((set) => ({ tab: null, set: (tab) => set({ tab }) }));
export const openSettings = (tab: SettingsTab = 'general') => useSettingsDialog.getState().set(tab);

export function SettingsDialog() {
  const { tab, set } = useSettingsDialog();
  if (!tab) return null;
  return (
    <Modal open onClose={() => set(null)} title="Settings" size="lg" footer={<Button onClick={() => set(null)}>Done</Button>}>
      <Tabs
        value={tab}
        onChange={set}
        className="mb-4"
        tabs={[
          { value: 'general', label: 'General' },
          { value: 'folders', label: 'Folders' },
          { value: 'image', label: 'Image' },
          { value: 'llm', label: 'LLM connections' },
          { value: 'chat', label: 'Chat preset' },
          { value: 'assist', label: 'Assistant' },
          { value: 'personas', label: 'Personas' },
          // Local extensions' settings, when any are installed.
          ...(hasExtensionSettings ? [{ value: 'extensions' as const, label: 'Extensions' }] : []),
        ]}
      />
      {tab === 'general' && <GeneralTab />}
      {tab === 'folders' && <FoldersTab />}
      {tab === 'image' && <ImageConnectionsTab onOpenGeneral={() => set('general')} />}
      {tab === 'llm' && <LlmTab />}
      {tab === 'assist' && <AssistTab />}
      {tab === 'personas' && <PersonaManager />}
      {tab === 'extensions' && <ExtensionSettings />}
      {tab === 'chat' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-500">
            The SillyTavern chat-completion preset the test chat builds its prompt from. It applies to every chat on every card, and stays picked until you change it. The same picker is in the chat&apos;s ⚙ panel.
          </p>
          <PresetPicker />
        </div>
      )}
    </Modal>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_1fr] sm:gap-4">
      <div>
        <div className="text-sm text-slate-200">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  );
}

function GeneralTab() {
  const { apiKey, setApiKey } = useSessionStore();
  const { config, update } = useConfigStore();
  const { theme, setTheme, exportKeepsMetadata, setExportKeepsMetadata, exportMaxSize, exportCompression, setExportImage } = useUiStore();
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <Row label="NovelAI API key" hint="Account Settings → Get Persistent API Token (pst-…). Used for images, tag suggestions and NovelAI text.">
        <div className="flex gap-2">
          <input type={show ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} placeholder="pst-…" className={inputClass} autoComplete="off" />
          <Button size="sm" onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'Show'}
          </Button>
        </div>
        <p className="text-xs text-slate-500">Kept on this computer (data/settings.json) and shared by every device you open UCCB on, like your connections and presets.</p>
        {apiKey && <AccountStatus className="mt-1" />}
      </Row>
      <Row label="Who can connect" hint="UCCB always accepts this computer and your Tailscale devices. Changes apply within a few seconds.">
        <Toggle checked={config.allowLan} onChange={(allowLan) => void update({ allowLan })} label="Also allow devices on the home network" />
        <p className="text-xs text-slate-500">
          {config.allowLan
            ? 'Anyone on this Wi-Fi can open UCCB, use your API keys and change your cards.'
            : 'Other devices on the Wi-Fi are turned away; use Tailscale to reach UCCB from your phone.'}
        </p>
      </Row>
      <Row label="Theme">
        <div className="flex gap-2">
          <Button size="sm" variant={theme === 'dark' ? 'primary' : 'secondary'} onClick={() => setTheme('dark')}>
            Dark
          </Button>
          <Button size="sm" variant={theme === 'light' ? 'primary' : 'secondary'} onClick={() => setTheme('light')}>
            Light
          </Button>
        </div>
      </Row>
      <Row label="Card PNG export" hint="NovelAI writes the prompt and settings into every image it makes.">
        <Toggle checked={exportKeepsMetadata} onChange={setExportKeepsMetadata} label="Keep the avatar's generation metadata in exported cards" />
      </Row>
      <Row label="Card picture on export" hint="The avatar kept in UCCB stays full size and quality; this only shapes exported PNG and CHARX cards.">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
          Longest edge at most
          <select value={exportMaxSize} onChange={(e) => setExportImage({ exportMaxSize: Number(e.target.value) })} className={cx(inputClass, 'w-32 py-1')}>
            <option value={0}>as it is</option>
            {[512, 768, 1024, 1216, 1536, 2048].map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['off', 'No recompression', 'The picture as it is'],
              ['lossless', 'Lossless', 'Repacked tighter, pixel for pixel the same'],
              ['palette', 'Small (256 colours)', 'Usually a third of the size or less; fine for most anime-style art'],
            ] as const
          ).map(([value, label, hint]) => (
            <Button key={value} size="sm" variant={exportCompression === value ? 'primary' : 'secondary'} title={hint} onClick={() => setExportImage({ exportCompression: value })}>
              {label}
            </Button>
          ))}
        </div>
      </Row>
    </div>
  );
}

function FolderInput({ value, onChange, title, placeholder }: { value: string; onChange: (v: string) => void; title: string; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="flex gap-2">
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onChange(draft.trim())} placeholder={placeholder} className={inputClass} />
      <Button
        size="sm"
        onClick={async () => {
          const r = await api.pickFolder(draft, title);
          if (r.unsupported) toast('No folder picker on this system; type the path instead.');
          else if (r.path) {
            setDraft(r.path);
            onChange(r.path);
          }
        }}
      >
        Browse…
      </Button>
    </div>
  );
}

const RECENT_DAYS = [
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '0', label: 'Until I clear them' },
];

const formatBytes = (n: number) => (n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

function RecentGensRow() {
  const { config, update } = useConfigStore();
  const [stats, setStats] = useState<{ count: number; bytes: number } | null>(null);
  const days = String(config.recentGensDays);
  useEffect(() => {
    let live = true;
    void api.recentGenStats().then((s) => live && setStats(s), () => {});
    return () => {
      live = false;
    };
  }, [config.recentGensDays]);
  return (
    <Row label="Recent gens" hint="Every gen is kept on this computer (data/recent-gens) so a closed or frozen tab doesn't lose it, and your other devices see it too. Keep or save the ones you want for good.">
      <label className="flex items-center gap-2 text-sm text-slate-300">
        Delete after
        <Select
          value={RECENT_DAYS.some((o) => o.value === days) ? days : '7'}
          onChange={(v) => void update({ recentGensDays: Number(v) })}
          options={RECENT_DAYS}
          className="w-44"
        />
      </label>
      <p className="text-xs text-slate-500">
        {stats ? `${stats.count} gen${stats.count === 1 ? '' : 's'}, ${formatBytes(stats.bytes)}. ` : ''}Counted from when each was made, and cleared automatically once they&apos;re older. Gallery → Recent gens → Clear removes them sooner.
      </p>
    </Row>
  );
}

function FoldersTab() {
  const { config, update } = useConfigStore();
  const [adding, setAdding] = useState('');
  return (
    <div className="flex flex-col gap-5">
      <Row label="Output folder" hint="Where “Save to folder” writes gens. Nothing is written until you save one (or turn on auto-save).">
        <FolderInput value={config.outputDir} onChange={(outputDir) => void update({ outputDir })} title="Folder for saved gens" placeholder="e.g. D:\Gens\UCCB" />
        <Toggle checked={config.outputPerCard} onChange={(outputPerCard) => void update({ outputPerCard })} label="Put each card's gens in a subfolder named after it" />
        <Toggle checked={config.autoSaveGens} onChange={(autoSaveGens) => void update({ autoSaveGens })} disabled={!config.outputDir} label="Save every gen as it arrives" />
      </Row>
      <RecentGensRow />
      <Row label="Gen library folders" hint="Folders the Library tab browses: an old gens folder, a downloads folder, the output folder… Subfolders are included.">
        {config.libraryFolders.map((f) => (
          <div key={f} className="flex items-center gap-2 rounded-md bg-slate-950 px-2.5 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate text-slate-300" title={f}>
              {f}
            </span>
            <IconButton title="Remove from the library (the folder itself is untouched)" tone="danger" onClick={() => void update({ libraryFolders: config.libraryFolders.filter((x) => x !== f) })}>
              ✕
            </IconButton>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a folder…" className={inputClass} />
          <Button
            size="sm"
            onClick={async () => {
              let path = adding.trim();
              if (!path) {
                const r = await api.pickFolder('', 'Add a folder to the gen library');
                if (r.unsupported) return toast('No folder picker on this system; type the path instead.');
                path = r.path;
              }
              if (!path) return;
              await update({ libraryFolders: [...config.libraryFolders, path] });
              setAdding('');
            }}
          >
            {adding.trim() ? 'Add' : 'Browse…'}
          </Button>
        </div>
        {config.outputDir && !config.libraryFolders.includes(config.outputDir) && (
          <button type="button" className="self-start text-xs text-violet-300 hover:underline" onClick={() => void update({ libraryFolders: [...config.libraryFolders, config.outputDir] })}>
            + Add the output folder
          </button>
        )}
      </Row>
    </div>
  );
}

// ─── LLM connections ─────────────────────────────────────────────────────────

const KIND_LABELS: Record<ProviderKind, string> = { novelai: 'NovelAI', openai: 'OpenAI-compatible', anthropic: 'Anthropic (Claude)' };

function LlmTab() {
  const { connections, addConnection, chatConnectionId, assistConnectionId, visionConnectionId, setChatConnection, setAssistConnection, setVisionConnection, priceUnit, setPriceUnit } = useLlmStore();
  const [openId, setOpenId] = useState<string | null>(connections[0]?.id ?? null);
  const anyOpenRouter = connections.some(isOpenRouter);
  const prices = useModelPrices(anyOpenRouter);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        Connections are used by the test chat, the writing assistant and Write from image; each can use its own. Keys are kept on this computer (data/settings.json) and sent only to the provider, through UCCB&apos;s local server.
      </p>
      {anyOpenRouter && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          OpenRouter prices per
          <div className="flex overflow-hidden rounded-md border border-slate-700">
            {(['1M', '1K'] as const).map((u) => (
              <button key={u} type="button" onClick={() => setPriceUnit(u)} className={cx('px-2 py-0.5', priceUnit === u ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-slate-800')}>
                {u === '1M' ? '1M tokens' : '1K tokens'}
              </button>
            ))}
          </div>
          <span className="text-slate-500">(from OpenRouter&apos;s model list, in US dollars)</span>
        </div>
      )}
      {connections.map((c) => (
        <div key={c.id} className="rounded-md border border-slate-800">
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
            <span className="text-xs text-slate-500">{openId === c.id ? '▾' : '▸'}</span>
            <span className="font-medium text-slate-200">{c.name}</span>
            <span className="min-w-0 truncate text-xs text-slate-500">
              {KIND_LABELS[c.kind]} · {c.model || 'no model'}
              {isOpenRouter(c) && prices?.[c.model] && <span className="text-emerald-300/80"> · {priceLabel(prices[c.model], priceUnit)}</span>}
            </span>
            <span className="ml-auto flex flex-shrink-0 gap-1 text-[10px]">
              {chatConnectionId === c.id && <span className="rounded bg-sky-500/15 px-1.5 text-sky-300">chat</span>}
              {assistConnectionId === c.id && <span className="rounded bg-violet-500/15 px-1.5 text-violet-300">assistant</span>}
              {visionConnectionId === c.id && <span className="rounded bg-amber-500/15 px-1.5 text-amber-300">vision</span>}
            </span>
          </button>
          {openId === c.id && (
            <div className="border-t border-slate-800 p-3">
              <ConnectionEditor connection={c} />
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={chatConnectionId === c.id} onClick={() => setChatConnection(c.id)}>
                  Use for chat
                </Button>
                <Button size="sm" disabled={assistConnectionId === c.id} onClick={() => setAssistConnection(c.id)}>
                  Use for assistant
                </Button>
                <Button size="sm" disabled={visionConnectionId === c.id} onClick={() => setVisionConnection(c.id)} title="For ✨ Write from image; needs a model that can see images">
                  Use for vision
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {(['novelai', 'openai', 'anthropic'] as ProviderKind[]).map((k) => (
          <Button key={k} size="sm" onClick={() => setOpenId(addConnection(k).id)}>
            + {KIND_LABELS[k]}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ConnectionEditor({ connection: c }: { connection: LlmConnection }) {
  const { updateConnection, removeConnection } = useLlmStore();
  const [models, setModels] = useState<string[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const set = (patch: Partial<LlmConnection>) => updateConnection(c.id, patch);
  const setParam = (patch: Partial<SamplerParams>) => updateConnection(c.id, { params: patch as SamplerParams });
  const priceUnit = useLlmStore((s) => s.priceUnit);
  const prices = useModelPrices(isOpenRouter(c));
  const price = isOpenRouter(c) ? prices?.[c.model] : undefined;
  const listPrice = (m: string) => (isOpenRouter(c) && prices?.[m] ? ` · ${priceLabel(prices[m], priceUnit)}` : '');

  const fetchModels = async () => {
    try {
      const list = await api.llmModels(requestConnection(c));
      setModels(list);
      if (!list.length) toast('The server listed no models.', 'error');
    } catch (err) {
      toast(`Couldn't list models: ${(err as Error).message}`, 'error');
    }
  };
  const test = async () => {
    setTesting(true);
    let reply = '';
    let failure = '';
    await streamLlm({ connection: { ...requestConnection(c), params: { ...c.params, max_tokens: 30 } }, messages: [{ role: 'user', content: 'Reply with just the word "pong".' }] }, (e) => {
      if (e.type === 'text') reply += e.text;
      if (e.type === 'error') failure = e.message;
    }).catch((err: Error) => (failure = err.message));
    setTesting(false);
    if (failure) toast(`Test failed: ${failure}`, 'error');
    else toast(`Connected. The model said: ${reply.trim().slice(0, 80) || '(nothing)'}`, 'success');
  };

  const num = (key: keyof SamplerParams, label: string, step = 0.01, hint?: string) => (
    <label className="flex flex-col gap-0.5 text-xs text-slate-400" title={hint}>
      {label}
      <NumberInput value={c.params[key] as number | undefined} onChange={(v) => setParam({ [key]: v })} step={step} allowEmpty placeholder="default" />
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Name
          <input value={c.name} onChange={(e) => set({ name: e.target.value })} className={inputClass} />
        </label>
        {c.kind === 'openai' && (
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Base URL
            <input value={c.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://…/v1" className={inputClass} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          API key {c.kind === 'novelai' && <span className="text-slate-500">(blank: use the NovelAI key from General)</span>}
          <div className="flex gap-1">
            <input type={showKey ? 'text' : 'password'} value={c.apiKey} onChange={(e) => set({ apiKey: e.target.value.trim() })} className={inputClass} autoComplete="off" />
            <Button size="sm" onClick={() => setShowKey(!showKey)}>
              {showKey ? 'Hide' : 'Show'}
            </Button>
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Model
          <div className="flex gap-1">
            <input value={c.model} onChange={(e) => set({ model: e.target.value })} list={`models-${c.id}`} className={inputClass} placeholder="model id" />
            <Button size="sm" onClick={() => void fetchModels()} title="Ask the server which models it has">
              List
            </Button>
          </div>
          {models && (
            <datalist id={`models-${c.id}`}>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          {models && models.length > 0 && (
            <select value="" onChange={(e) => e.target.value && set({ model: e.target.value })} className={cx(inputClass, 'py-1 text-xs')}>
              <option value="">{models.length} models, pick one…</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {listPrice(m)}
                </option>
              ))}
            </select>
          )}
          {price && (
            <span className="text-[11px] text-emerald-300/80" title="OpenRouter's price for this model, in US dollars">
              {priceLabel(price, priceUnit)}
              {price.cacheRead !== undefined && price.cacheRead >= 0 && ` · cached input ${formatPrice(price.cacheRead, priceUnit)}`}
            </span>
          )}
          {isOpenRouter(c) && c.model && prices && !price && <span className="text-[11px] text-slate-500">No price listed for this model id on OpenRouter.</span>}
        </label>
      </div>

      <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Generation</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
          Max tokens
          <NumberInput value={c.params.max_tokens} onChange={(v) => setParam({ max_tokens: v ?? 600 })} min={1} step={50} />
        </label>
        {c.kind !== 'anthropic' ? (
          <>
            {num('temperature', 'Temperature')}
            {num('top_p', 'Top P')}
            {num('top_k', 'Top K', 1)}
            {num('min_p', 'Min P')}
            {num('frequency_penalty', 'Frequency penalty')}
            {num('presence_penalty', 'Presence penalty')}
            {c.kind === 'openai' && (
              <label className="flex flex-col gap-0.5 text-xs text-slate-400" title="For reasoning models. Sent as reasoning_effort (reasoning.effort to OpenRouter); models that don't reason may ignore or refuse it.">
                Reasoning effort
                <select value={c.params.reasoning_effort ?? ''} onChange={(e) => setParam({ reasoning_effort: (e.target.value || undefined) as SamplerParams['reasoning_effort'] })} className={cx(inputClass, 'py-1')}>
                  <option value="">server default</option>
                  {REASONING_EFFORTS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <>
            <label className="flex flex-col gap-0.5 text-xs text-slate-400">
              Effort
              <select value={c.params.effort ?? ''} onChange={(e) => setParam({ effort: (e.target.value || undefined) as SamplerParams['effort'] })} className={cx(inputClass, 'py-1')}>
                <option value="">model default</option>
                {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <div className="col-span-2 flex items-end pb-1">
              <Toggle checked={!!c.params.thinking} onChange={(thinking) => setParam({ thinking })} label="Adaptive thinking (shows a summary)" />
            </div>
            {num('temperature', 'Temperature', 0.01, 'Older Claude models only; current ones reject it')}
          </>
        )}
      </div>
      {c.kind === 'novelai' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 flex items-end pb-1 sm:col-span-4">
            <Toggle checked={!!c.params.enable_thinking} onChange={(enable_thinking) => setParam({ enable_thinking })} label="Thinking (enable_thinking)" />
            <span className="ml-3 text-[11px] text-slate-500">NovelAI&apos;s API has thinking on or off, with no effort level.</span>
          </div>
          {num('unified_linear', 'Unified: linear', 0.01, "NovelAI's unified sampler")}
          {num('unified_quadratic', 'Unified: quadratic')}
          {num('unified_cubic', 'Unified: cubic')}
          {num('unified_increase_linear_with_entropy', 'Unified: entropy')}
        </div>
      )}
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Stop sequences <span className="text-slate-500">(one per line)</span>
        <textarea
          value={(c.params.stop ?? []).join('\n')}
          onChange={(e) => setParam({ stop: e.target.value.split('\n').filter((s) => s.length) })}
          rows={2}
          className={cx(inputClass, 'font-mono text-xs')}
        />
      </label>
      {c.kind !== 'anthropic' && <ExtraJson connection={c} />}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={testing} onClick={() => void test()}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto text-red-400" onClick={() => removeConnection(c.id)}>
          Remove
        </Button>
      </div>
    </div>
  );
}

function ExtraJson({ connection: c }: { connection: LlmConnection }) {
  const { updateConnection } = useLlmStore();
  const [draft, setDraft] = useState(c.params.extra ? JSON.stringify(c.params.extra, null, 2) : '');
  const [bad, setBad] = useState(false);
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      Extra body fields <span className="text-slate-500">(JSON, merged into every request, e.g. {'{"repetition_penalty": 1.05}'})</span>
      <textarea
        value={draft}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!draft.trim()) {
            setBad(false);
            return updateConnection(c.id, { params: { extra: undefined } as unknown as SamplerParams });
          }
          try {
            const extra = JSON.parse(draft);
            setBad(false);
            updateConnection(c.id, { params: { extra } as SamplerParams });
          } catch {
            setBad(true);
          }
        }}
        className={cx(inputClass, 'font-mono text-xs', bad && 'border-red-500')}
      />
    </label>
  );
}

function AssistTab() {
  const { assistConnectionId, setAssistConnection } = useLlmStore();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        The writing assistant: ✨ on every field, new greetings, lorebook entries, tag suggestions, the card review, the art prompts and Brainstorm. It can use its own SillyTavern preset, separate from the chat&apos;s.
      </p>
      <ConnectionPicker value={assistConnectionId} onChange={setAssistConnection} label="Assistant model" />
      <AssistPresetPicker />
      <RecentAssistRuns />
      <AssistPromptEditor />
      <AssistPromptPreview />
    </div>
  );
}

/** This session's assistant requests, each openable to its prompt,
 *  reasoning and reply. */
function RecentAssistRuns() {
  const runs = useAssistLog((s) => s.runs);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Recent requests</div>
      {runs.length === 0 ? (
        <p className="text-xs text-slate-500">None yet this session. Each ✨ you run shows up here, with exactly what was sent and what came back.</p>
      ) : (
        <div className="flex max-h-56 flex-col overflow-y-auto rounded-md border border-slate-800">
          {runs.map((r) => (
            <button key={r.id} type="button" onClick={() => inspectAssistRun(r.id)} className="flex items-center gap-2 border-b border-slate-800 px-2.5 py-1.5 text-left text-xs last:border-0 hover:bg-slate-800/60">
              <span className="min-w-0 flex-1 truncate text-slate-200">{r.label}</span>
              {r.reasoning && <span title="Has reasoning">🧠</span>}
              {r.error && <span className="text-red-400">failed</span>}
              {r.running && <span className="animate-pulse text-violet-300">running</span>}
              <span className="flex-shrink-0 text-slate-500">
                {r.model || r.connection} · {new Date(r.at).toLocaleTimeString([], { timeStyle: 'short' })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The assistant's built-in prompts, editable, each with its default a
 *  click away. Edits are saved with the LLM settings (every device). */
function AssistPromptEditor() {
  const { assistSettings, setAssistSettings } = useLlmStore();
  const edits = assistSettings.templates ?? {};
  const save = (next: Record<string, string>) => setAssistSettings({ templates: next });
  const setTemplate = (key: string, text: string) => {
    const next = { ...edits };
    // Back to the default word for word counts as not edited.
    if (text === DEFAULT_TEMPLATES[key]) delete next[key];
    else next[key] = text;
    save(next);
  };
  const restore = (key: string) => {
    const next = { ...edits };
    delete next[key];
    save(next);
  };
  const groups = [...new Set(ASSIST_TEMPLATES.map((t) => t.group))];
  const edited = Object.keys(edits).filter((k) => k in DEFAULT_TEMPLATES).length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Prompts {edited > 0 && <span className="font-normal normal-case text-violet-300">· {edited} edited</span>}</span>
        {edited > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (await confirmDialog({ title: 'Restore every prompt to its default?', body: `Your ${edited} edited prompt${edited === 1 ? '' : 's'} go back to the built-in wording.`, confirmLabel: 'Restore all', danger: true })) save({});
            }}
          >
            ↺ Restore all
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        What each job asks. <code className="text-slate-400">{'{{placeholders}}'}</code> are filled in per request; a paragraph whose placeholder comes out empty (no instruction given, say) is left out. {'{{char}}'} and {'{{user}}'} are sent as written, for the model to read as macros. An emptied system prompt is left out.
      </p>
      {groups.map((group) => {
        const templates = ASSIST_TEMPLATES.filter((t) => t.group === group);
        const changed = templates.filter((t) => t.key in edits).length;
        return (
          <details key={group} className="rounded-md border border-slate-800">
            <summary className="cursor-pointer px-2.5 py-1.5 text-sm text-slate-200">
              {group}
              {changed > 0 && <span className="ml-2 text-xs text-violet-300">{changed} edited</span>}
            </summary>
            <div className="flex flex-col gap-3 border-t border-slate-800 p-2.5">
              {templates.map((t) => {
                const isEdited = t.key in edits;
                return (
                  <div key={t.key} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-slate-300">{t.label}</span>
                      {isEdited && <span className="rounded bg-violet-500/15 px-1.5 text-[10px] text-violet-300">edited</span>}
                      {t.vars.length > 0 && <span className="text-[10px] text-slate-500">{t.vars.map((v) => `{{${v}}}`).join(' ')}</span>}
                      <Button size="sm" variant="ghost" className="ml-auto" disabled={!isEdited} onClick={() => restore(t.key)} title="Back to the built-in wording">
                        ↺ Default
                      </Button>
                    </div>
                    {t.note && <p className="text-[11px] text-slate-500">{t.note}</p>}
                    <AutoTextarea value={edits[t.key] ?? t.text} onChange={(e) => setTemplate(t.key, e.target.value)} minRows={2} maxRows={16} className="font-mono text-xs" />
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** Any job's prompt, as it would be sent now: for the open card, through
 *  the assistant's preset if one is on. */
function AssistPromptPreview() {
  const [job, setJob] = useState(0);
  const card = useProjectStore((s) => s.project?.card.data);
  // Re-read when the preset or its switches change.
  const settings = useLlmStore((s) => s.assistSettings);
  const presets = useLlmStore((s) => s.presets);
  const built = useMemo(() => assistRequest(ASSIST_JOBS[job].build(card ?? newCard().data)), [job, card, settings, presets]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">What each job sends</div>
      <p className="text-xs text-slate-500">
        {card ? 'Built from the open card' : 'No card is open, so this uses an empty one'}
        {built.preset ? `, wrapped in the "${built.preset}" preset` : ''}. Your instructions go where it says so.
      </p>
      <select value={job} onChange={(e) => setJob(Number(e.target.value))} className={cx(inputClass, 'py-1 text-xs')}>
        {ASSIST_JOBS.map((j, i) => (
          <option key={j.label} value={i}>
            {j.label}
          </option>
        ))}
      </select>
      <MessageList messages={built.messages} />
    </div>
  );
}
