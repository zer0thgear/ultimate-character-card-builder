'use client';

import { useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useSessionStore } from '@/store/sessionStore';
import { toast } from '@/store/uiStore';
import { addImageConnection, loadBackendOptions, removeImageConnection, selectImageConnection, updateImageConnection } from '@/store/imageConnections';
import { DEFAULT_URLS, IMAGE_KIND_LABELS, describeSlots, findComfySlots, parseComfyWorkflow } from '@/lib/imageBackends';
import type { ImageBackendKind, ImageConnection } from '@/types/imageBackend';
import { Button, confirmDialog, cx, inputClass, pickFiles } from '@/components/ui';

// Settings → Image: where gens are made. NovelAI (with the key from
// General), A1111 and its forks, or ComfyUI; the Image tab uses the one
// picked here (or chosen there, when there are several).

export function ImageConnectionsTab({ onOpenGeneral }: { onOpenGeneral: () => void }) {
  const connections = useSettingsStore((s) => s.imageConnections);
  const activeId = useSettingsStore((s) => s.imageConnectionId ?? s.imageConnections[0]?.id);
  const [openId, setOpenId] = useState<string | null>(activeId ?? null);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        Where the Image tab makes gens. NovelAI has UCCB&apos;s full generator (character prompts, positions, Img2Img, inpainting, Anlas). A1111 / Forge (and reForge, SD.Next) and ComfyUI take the style, scene and characters as one prompt, with their own checkpoints and samplers, and both do Img2Img (ComfyUI through your workflow&apos;s Load Image node, or nodes UCCB adds to load the base). Those servers are reached through UCCB&apos;s own server, so they need no CORS setting.
      </p>
      {!connections.length && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200">No image connections yet: add one to start generating.</p>}
      {connections.map((c) => (
        <div key={c.id} className="rounded-md border border-slate-800">
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
            <span className="text-xs text-slate-500">{openId === c.id ? '▾' : '▸'}</span>
            <span className="font-medium text-slate-200">{c.name}</span>
            <span className="min-w-0 truncate text-xs text-slate-500">
              {IMAGE_KIND_LABELS[c.kind]}
              {c.kind !== 'novelai' && ` · ${c.baseUrl}`}
            </span>
            {activeId === c.id && <span className="ml-auto flex-shrink-0 rounded bg-violet-500/15 px-1.5 text-[10px] text-violet-300">in use</span>}
          </button>
          {openId === c.id && (
            <div className="border-t border-slate-800 p-3">
              <ImageConnectionEditor connection={c} onOpenGeneral={onOpenGeneral} />
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={activeId === c.id} onClick={() => selectImageConnection(c.id)}>
                  Use for images
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-red-300"
                  onClick={async () => {
                    if (await confirmDialog({ title: `Remove ${c.name}?`, body: 'Gens made with it stay.', confirmLabel: 'Remove', danger: true })) removeImageConnection(c.id);
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {(['novelai', 'a1111', 'comfyui'] as ImageBackendKind[]).map((k) => (
          <Button key={k} size="sm" onClick={() => setOpenId(addImageConnection(k).id)}>
            + {IMAGE_KIND_LABELS[k]}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ImageConnectionEditor({ connection: c, onOpenGeneral }: { connection: ImageConnection; onOpenGeneral: () => void }) {
  const apiKey = useSessionStore((s) => s.apiKey);
  const [testing, setTesting] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const set = (patch: Partial<ImageConnection>) => updateImageConnection(c.id, patch);

  const test = async () => {
    setTesting(true);
    try {
      const o = await loadBackendOptions(c, true);
      toast(`Connected: ${o.checkpoints.length} checkpoint${o.checkpoints.length === 1 ? '' : 's'}, ${o.samplers.length} samplers.`, 'success');
    } catch (err) {
      toast(`Couldn't connect: ${(err as Error).message}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  const importWorkflow = async () => {
    const [file] = await pickFiles('.json,application/json');
    if (!file) return;
    try {
      const workflow = parseComfyWorkflow(await file.text());
      const slots = findComfySlots(workflow);
      set({ workflow, workflowName: file.name.replace(/\.json$/i, '') });
      const found = describeSlots(slots);
      if (!slots.positive.length && !slots.placeholders.some((p) => p.name === 'prompt')) {
        toast("Imported, but UCCB couldn't find where its prompt goes. Put %prompt% in the prompt node's text (and %negative% in the negative's), then import it again.", 'error');
      } else toast(`Imported. UCCB will fill in its ${found.join(', ')}.`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (c.kind === 'novelai') {
    return (
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Name
          <input value={c.name} onChange={(e) => set({ name: e.target.value })} className={inputClass} />
        </label>
        <p className={cx('text-xs', apiKey ? 'text-slate-500' : 'text-amber-300')}>
          {apiKey ? 'Uses the NovelAI key from General.' : 'Needs your NovelAI key: '}
          {!apiKey && (
            <button type="button" className="underline" onClick={onOpenGeneral}>
              add it in General
            </button>
          )}
        </p>
      </div>
    );
  }

  const slots = c.workflow ? findComfySlots(c.workflow) : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Name
          <input value={c.name} onChange={(e) => set({ name: e.target.value })} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Server address
          <input value={c.baseUrl} onChange={(e) => set({ baseUrl: e.target.value.trim() })} placeholder={DEFAULT_URLS[c.kind]} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">
          {c.kind === 'a1111' ? 'Login (optional: user:password, if it runs with --api-auth)' : 'API key (optional, sent as a Bearer token, for a ComfyUI behind a proxy)'}
          <div className="flex gap-1">
            <input type={showAuth ? 'text' : 'password'} value={c.auth} onChange={(e) => set({ auth: e.target.value })} className={inputClass} autoComplete="off" />
            <Button size="sm" onClick={() => setShowAuth(!showAuth)}>
              {showAuth ? 'Hide' : 'Show'}
            </Button>
          </div>
        </label>
      </div>
      {c.kind === 'a1111' && <p className="text-xs text-slate-500">Start A1111 or Forge with --api (and --listen to reach it from another machine). The checkpoint, sampler and scheduler are picked in the Image tab.</p>}
      {c.kind === 'comfyui' && (
        <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">Workflow:</span>
            <span className="font-medium text-slate-200">{c.workflow ? (c.workflowName ?? 'Yours') : 'Built-in txt2img'}</span>
            <Button size="sm" className="ml-auto" onClick={() => void importWorkflow()}>
              Import workflow…
            </Button>
            {c.workflow && (
              <Button size="sm" variant="ghost" onClick={() => set({ workflow: null, workflowName: undefined })}>
                Use built-in
              </Button>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            {c.workflow
              ? `UCCB fills in its ${slots ? describeSlots(slots).join(', ') || 'nothing (add %prompt% placeholders)' : ''}; everything else (LoRAs, upscalers, custom nodes) runs as you built it.`
              : 'A checkpoint, your prompt and negative, then the sampler: the workflow ComfyUI starts with. For LoRAs, upscaling or custom nodes, build your own in ComfyUI and import it.'}{' '}
            To import one: in ComfyUI, Workflow → Export (API). UCCB finds the prompt through the sampler&apos;s positive and negative inputs; or put %prompt%, %negative%, %seed%, %width%, %height% (and so on) in any node&apos;s fields to say exactly where. For Img2Img, the base goes into the workflow&apos;s Load Image node (or %image%), with the strength as the sampler&apos;s denoise (or %denoise%); a workflow without one gets nodes added to load the base, scale it to the gen&apos;s size and encode it.
          </p>
        </div>
      )}
      <div>
        <Button size="sm" disabled={testing} onClick={() => void test()}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
      </div>
    </div>
  );
}
