'use client';

import { create } from 'zustand';
import { useState } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useConfigStore, useUiStore, toast } from '@/store/uiStore';
import { useLlmStore, requestConnection } from '@/store/llmStore';
import type { LlmConnection, ProviderKind, SamplerParams } from '@/types/llm';
import { api, streamLlm } from '@/lib/api';
import { Button, IconButton, Modal, NumberInput, Tabs, Toggle, cx, inputClass } from '@/components/ui';
import { AssistPresetPicker, PresetPicker } from '@/components/llm/PresetManager';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';

type SettingsTab = 'general' | 'folders' | 'llm' | 'chat' | 'assist';

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
          { value: 'llm', label: 'LLM connections' },
          { value: 'chat', label: 'Chat preset' },
          { value: 'assist', label: 'Assistant' },
        ]}
      />
      {tab === 'general' && <GeneralTab />}
      {tab === 'folders' && <FoldersTab />}
      {tab === 'llm' && <LlmTab />}
      {tab === 'assist' && <AssistTab />}
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
        <p className="text-xs text-slate-500">Kept in this browser&apos;s localStorage. Don&apos;t use UCCB on a shared computer.</p>
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
      <Row label="Gen library folders" hint="Folders the Library tab browses: GenBrowser's library, a downloads folder, the output folder… Subfolders are included.">
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
  const { connections, addConnection, chatConnectionId, assistConnectionId, setChatConnection, setAssistConnection } = useLlmStore();
  const [openId, setOpenId] = useState<string | null>(connections[0]?.id ?? null);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        Connections are used by the test chat and the writing assistant; each can use its own. Keys are kept in this browser and sent only to the provider, through UCCB&apos;s local server.
      </p>
      {connections.map((c) => (
        <div key={c.id} className="rounded-md border border-slate-800">
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
            <span className="text-xs text-slate-500">{openId === c.id ? '▾' : '▸'}</span>
            <span className="font-medium text-slate-200">{c.name}</span>
            <span className="text-xs text-slate-500">
              {KIND_LABELS[c.kind]} · {c.model || 'no model'}
            </span>
            <span className="ml-auto flex gap-1 text-[10px]">
              {chatConnectionId === c.id && <span className="rounded bg-sky-500/15 px-1.5 text-sky-300">chat</span>}
              {assistConnectionId === c.id && <span className="rounded bg-violet-500/15 px-1.5 text-violet-300">assistant</span>}
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
                </option>
              ))}
            </select>
          )}
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
    </div>
  );
}
