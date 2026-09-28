'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore, DEFAULT_NEGATIVE } from '@/store/settingsStore';
import { useSessionStore, type SessionImage } from '@/store/sessionStore';
import { useProjectStore } from '@/store/projectStore';
import { useBridgeStore } from '@/store/bridgeStore';
import { useConfigStore, toast } from '@/store/uiStore';
import { useGenerate } from '@/hooks/useGenerate';
import { useSubscription } from '@/hooks/useSubscription';
import { useTokenCounts } from '@/hooks/useTokenCounts';
import { useLlmStream } from '@/hooks/useLlmStream';
import { MODELS, maxCharacters } from '@/lib/models';
import { SAMPLERS } from '@/lib/samplers';
import { getAvailableQualityLevels, getAvailableUcLevels, QUALITY_LEVEL_LABELS, UC_LEVEL_LABELS } from '@/lib/naiPresets';
import { isV3Model, promptSource, randomSeed } from '@/lib/imageRequest';
import { buildGenerateRequest, POSITIONS, SIZE_PRESETS, type Img2ImgBase } from '@/lib/genRequest';
import { applyEditorResult, type EditorMode, type Img2ImgSource } from '@/lib/editorResult';
import { hasInpaintStrength, toInpaintingModel } from '@/lib/inpaint';
import { CanvasEditor } from '@/components/CanvasEditor';
import { AccountStatus } from '@/components/AccountStatus';
import { calculateAnlasCost, opusStatus, MAX_GENERATION_PIXELS } from '@/lib/anlasCost';
import { hasVariety } from '@/lib/variety';
import { blobToBase64, getImageDimensions } from '@/lib/imageUtils';
import { eraseStealthMarks } from '@/lib/requestImage';
import { appearanceTagsMessages, artReferenceNote, castSceneMessages, cleanTags, sceneTagsMessages, takeDatasetTags } from '@/lib/assist';
import { withReferences, type Reference } from '@/lib/references';
import { ReferenceTray, referenceConnectionId } from '@/components/llm/References';
import { create } from 'zustand';
import { mergeCast, parseCast, type MergeResult } from '@/lib/castPrompt';
import { greetingText } from '@/lib/chatPrompt';
import { saveSessionImage } from '@/lib/imageActions';
import { TagAutocompleteField } from '@/components/TagAutocompleteField';
import { TokenMeter } from '@/components/TokenMeter';
import { Button, IconButton, NumberInput, Toggle, cx, inputClass } from '@/components/ui';
import { ImageViewer } from '@/components/dock/ImageViewer';
import { openSettings } from '@/components/SettingsDialog';
import type { CharacterPromptEntry, NovelAIModel, NovelAINoiseSchedule } from '@/types/novelai';
import type { LlmMessage } from '@/types/llm';
import { uuid } from '@/lib/uuid';
import { AssistTraceButton } from '@/components/llm/AssistTrace';
import { activeImageConnection, loadBackendOptions, selectImageConnection, updateImageConnection, useActiveImageConnection, useBackendOptions } from '@/store/imageConnections';
import { composeBackendPrompts, IMAGE_KIND_LABELS, SD_DEFAULT_NEGATIVE } from '@/lib/imageBackends';
import { joinPromptParts } from '@/lib/promptText';
import type { BackendGenRequest, ImageConnection } from '@/types/imageBackend';

const promptClass = cx(inputClass, 'min-h-16 resize-y font-mono text-[13px] leading-relaxed');

export function ImagePanel() {
  const projectId = useProjectStore((s) => s.project?.id);
  const images = useSessionStore((s) => s.images);
  const selectedId = useSessionStore((s) => s.selectedId);
  const streamPreview = useSessionStore((s) => s.streamPreview);
  const generating = useSessionStore((s) => s.generating);
  // The viewer shows this card's newest gen unless another is picked.
  const mine = images.filter((i) => i.projectId === projectId);
  const shown = mine.find((i) => i.id === selectedId) ?? mine[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="h-[46%] min-h-48 flex-shrink-0 border-b border-slate-800 phone:h-[38%] phone:min-h-40">
        <ImageViewer image={shown} all={mine} preview={generating > 0 ? streamPreview : null} generating={generating > 0} />
      </div>
      {mine.length > 1 && <HistoryStrip images={mine} selected={shown?.id} />}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <PromptForm />
      </div>
    </div>
  );
}

function HistoryStrip({ images, selected }: { images: SessionImage[]; selected?: string }) {
  const select = useSessionStore((s) => s.select);
  return (
    <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-slate-800 p-1.5">
      {images.slice(0, 60).map((img) => (
        <button
          key={img.id}
          type="button"
          onClick={() => select(img.id)}
          className={cx('relative h-14 w-11 flex-shrink-0 overflow-hidden rounded border-2', img.id === selected ? 'border-violet-500' : 'border-transparent opacity-75 hover:opacity-100')}
          title={`Seed ${img.seed}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt="" className="h-full w-full object-cover" />
          {img.keptFile && <span className="absolute top-0 right-0 bg-black/60 px-0.5 text-[9px]">★</span>}
        </button>
      ))}
    </div>
  );
}

// ─── The prompt form ─────────────────────────────────────────────────────────

function PromptForm() {
  const form = useSettingsStore();
  const { set, patch } = form;
  const apiKey = useSessionStore((s) => s.apiKey);
  const { generate, generateOn, error, clearError } = useGenerate();
  // Where gens go. NovelAI has the whole form; A1111 and ComfyUI the parts
  // that mean something to them.
  const connection = useActiveImageConnection();
  const nai = connection?.kind === 'novelai';
  const { subscription, refresh } = useSubscription();
  const setGenerating = useSessionStore((s) => s.setGenerating);
  const generating = useSessionStore((s) => s.generating);
  const retryNotice = useSessionStore((s) => s.retryNotice);
  const projectId = useProjectStore((s) => s.project?.id);
  const config = useConfigStore((s) => s.config);
  const counts = useTokenCounts(form);
  const [advanced, setAdvanced] = useState(false);
  // The Image2Image base, with any paint (Edit Image) or mask (Inpaint).
  const [source, setSource] = useState<Img2ImgSource | null>(null);
  const [strength, setStrength] = useState(0.6);
  const [noise, setNoise] = useState(0);
  const [inpaintStrength, setInpaintStrength] = useState(1);
  const [canvas, setCanvas] = useState<EditorMode | null>(null);
  const inpainting = !!source?.mask;
  const stopRef = useRef(false);

  const isV3 = isV3Model(form.model);
  const basePrompt = form.basePrompts.find((p) => p.selected) ?? form.basePrompts[0];
  const setBasePrompt = (text: string) => set('basePrompts', form.basePrompts.map((p) => (p.id === basePrompt?.id ? { ...p, text } : p)));

  const anlas = calculateAnlasCost({
    model: inpainting ? toInpaintingModel(form.model) : form.model,
    width: source?.width ?? form.width,
    height: source?.height ?? form.height,
    steps: form.steps,
    smea: form.smea,
    smeaDyn: form.smeaDyn,
    strength: !source ? 1 : inpainting ? (hasInpaintStrength(form.model) ? inpaintStrength : 1) : strength,
    ...opusStatus(subscription),
  });
  const cost = nai ? anlas : 0;
  const tooBig = nai && (source?.width ?? form.width) * (source?.height ?? form.height) > MAX_GENERATION_PIXELS;
  /** Why this connection can't make the gen asked for, if it can't. */
  const unsupported = !connection
    ? 'no connection'
    : connection.kind === 'comfyui' && source
      ? "Img2Img isn't available with ComfyUI yet: remove the base, or switch to NovelAI or an A1111 connection."
      : connection.kind === 'a1111' && source?.mask
        ? "Inpainting is NovelAI-only for now: clear the mask to use the picture as an Img2Img base, or switch to NovelAI."
        : null;

  /** The base as sent: stealth marks erased as NovelAI's canvas does, and
   *  the mask when inpainting. */
  const baseForRequest = async (): Promise<Img2ImgBase | undefined> => {
    if (!source) return undefined;
    const image = await blobToBase64(await eraseStealthMarks(source.blob));
    const mask = source.mask ? await blobToBase64(source.mask.full) : undefined;
    return { image, mask, width: source.width, height: source.height, strength, noise, inpaintStrength };
  };
  const hasPrompt = !!basePrompt?.text.trim() || form.characters.some((c) => c.enabled && c.prompt.trim());

  const run = async () => {
    if (!connection) return openSettings('image');
    if (nai && !apiKey) return openSettings('general');
    if (generating || !hasPrompt || tooBig || unsupported) return;
    clearError();
    stopRef.current = false;
    setGenerating(1);
    try {
      const base = await baseForRequest();
      for (let i = 0; i < form.copies && !stopRef.current; i++) {
        const seed = form.seed === 0 ? randomSeed() : form.seed + i;
        const now = useSettingsStore.getState();
        const { request, resolved } = buildGenerateRequest(now, seed, base);
        const opts = { projectId, source: promptSource(form, resolved), wildcardPicks: resolved.picks, forceStandard: !!base };
        const made = nai ? await generate(request, opts) : await generateOn(connection, backendRequest(connection, now, resolved, seed, base), request, opts);
        if (!made) break;
        if (useConfigStore.getState().config.autoSaveGens) for (const img of made) void saveSessionImage(img, true);
        if (i < form.copies - 1) await new Promise((r) => setTimeout(r, 1200));
      }
    } finally {
      setGenerating(-1);
      void refresh();
    }
  };

  // Ctrl+Enter generates from anywhere in the form, as in NovelFrontEnd.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && (e.target as HTMLElement).closest('[data-gen-form]')) {
        e.preventDefault();
        void runRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  /** A new base; the request keeps its size (rounded to NovelAI's grid as
   *  it's sent, lib/requestImage.ts). */
  const setAsBase = async (blob: Blob, open?: EditorMode) => {
    const { width, height } = await getImageDimensions(blob);
    setSource({ blob, url: URL.createObjectURL(blob), width, height });
    setCanvas(open ?? null);
  };
  // "Img2Img base" from a viewer, gallery or the library lands here, even
  // if it was sent before this panel mounted.
  const setAsBaseRef = useRef(setAsBase);
  useEffect(() => {
    setAsBaseRef.current = setAsBase;
  });
  useEffect(() => {
    const take = (req: { image: Blob; open?: EditorMode } | null) => {
      if (!req) return;
      useBridgeStore.getState().clearImg2Img();
      void setAsBaseRef.current(req.image, req.open);
    };
    take(useBridgeStore.getState().img2img);
    return useBridgeStore.subscribe((s) => take(s.img2img));
  }, []);

  return (
    <div className="flex flex-col gap-4" data-gen-form>
      {!connection ? (
        <button type="button" onClick={() => openSettings('image')} className="rounded-md bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-200">
          Set up an image connection to generate: NovelAI, A1111 / Forge or ComfyUI, in Settings → Image. You can write prompts meanwhile.
        </button>
      ) : (
        <ImageConnectionPicker current={connection} />
      )}
      {nai && !apiKey && (
        <button type="button" onClick={() => openSettings('general')} className="rounded-md bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-200">
          Add your NovelAI API key in Settings to generate.
        </button>
      )}

      <div className="flex items-center gap-2">
        <Button variant="primary" className="h-10 flex-1 text-base" disabled={!hasPrompt || tooBig || !!unsupported || generating > 0} onClick={() => void run()} title="Ctrl+Enter">
          {generating > 0 ? (retryNotice ?? 'Generating…') : `Generate${form.copies > 1 ? ` ×${form.copies}` : ''}`}
          {nai && <span className="text-xs font-normal opacity-75">{cost === 0 ? 'free' : `${cost * form.copies} Anlas`}</span>}
        </Button>
        {generating > 0 && form.copies > 1 && (
          <Button variant="danger" onClick={() => (stopRef.current = true)}>
            Stop
          </Button>
        )}
        <label className="flex flex-col text-[10px] text-slate-500" title="Images per Generate, one after another">
          Copies
          <NumberInput value={form.copies} onChange={(v) => set('copies', v ?? 1)} min={1} max={8} step={1} className="w-14" />
        </label>
      </div>
      {config.autoSaveGens && config.outputDir && (
        <div className="-mt-2 text-right text-[11px] text-slate-500" title={config.outputDir}>
          Auto-saving to the output folder
        </div>
      )}
      {nai && <AccountStatus />}
      {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
      {unsupported && connection && <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{unsupported}</div>}
      {tooBig && <div className="text-xs text-red-400">That size is past NovelAI&apos;s limit of about 3.1 megapixels.</div>}

      {source && (
        <div className={cx('flex gap-3 rounded-md border p-2', inpainting ? 'border-pink-500/30 bg-pink-500/5' : 'border-sky-500/30 bg-sky-500/5')}>
          <button type="button" className="checker relative h-24 w-16 flex-shrink-0 overflow-hidden rounded" onClick={() => setCanvas(inpainting ? 'mask' : 'paint')} title={inpainting ? 'Edit the mask' : 'Edit the image'}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={source.url} alt="Base" className="h-full w-full object-cover" />
            {source.mask && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={source.mask.url} alt="Mask" className="absolute inset-0 h-full w-full object-cover opacity-60" style={{ imageRendering: 'pixelated' }} />
            )}
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-slate-300">
            <div className="flex items-center justify-between gap-1">
              <span className="font-medium">
                {inpainting ? 'Inpainting' : 'Img2Img base'} <span className="font-normal text-slate-500">{source.width}×{source.height}, the output keeps this size</span>
              </span>
              <IconButton title="Stop using this base" onClick={() => setSource(null)}>
                ✕
              </IconButton>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" onClick={() => setCanvas('paint')} title="Paint over the picture, then generate from it">
                {source.paint ? 'Edit paint' : 'Edit image'}
              </Button>
              {(nai || source.mask) && (
                <Button size="sm" onClick={() => setCanvas('mask')} title="Mark what to regenerate">
                  {source.mask ? 'Edit mask' : 'Inpaint'}
                </Button>
              )}
              {source.mask && (
                <Button size="sm" variant="ghost" onClick={() => setSource({ ...source, mask: undefined })}>
                  Clear mask
                </Button>
              )}
            </div>
            {inpainting ? (
              hasInpaintStrength(form.model) ? (
                <label className="flex items-center gap-2" title="1 repaints the masked area from scratch; lower keeps more of what was there">
                  Strength
                  <input type="range" min={0.01} max={1} step={0.01} value={inpaintStrength} onChange={(e) => setInpaintStrength(Number(e.target.value))} className="flex-1 accent-pink-500" />
                  <span className="w-8 tabular-nums">{inpaintStrength.toFixed(2)}</span>
                </label>
              ) : (
                <span className="text-slate-500">V3 repaints the masked area from scratch.</span>
              )
            ) : (
              <>
                <label className="flex items-center gap-2">
                  Strength
                  <input type="range" min={0.01} max={0.99} step={0.01} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="flex-1 accent-violet-500" />
                  <span className="w-8 tabular-nums">{strength.toFixed(2)}</span>
                </label>
                {nai && (
                  <label className="flex items-center gap-2">
                    Noise
                    <input type="range" min={0} max={0.99} step={0.01} value={noise} onChange={(e) => setNoise(Number(e.target.value))} className="flex-1 accent-violet-500" />
                    <span className="w-8 tabular-nums">{noise.toFixed(2)}</span>
                  </label>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {source && canvas && (
        <CanvasEditor
          mode={canvas}
          image={canvas === 'paint' ? (source.original ?? source.blob) : source.blob}
          width={source.width}
          height={source.height}
          initialLayer={canvas === 'paint' ? source.paint : source.mask?.layer}
          onSave={(result) => {
            setSource(applyEditorResult(source, canvas, result));
            setCanvas(null);
          }}
          onCancel={() => setCanvas(null)}
        />
      )}

      <StyleSection text={form.stylePrompt} onChange={(v) => set('stylePrompt', v)} model={form.model} apiKey={apiKey} />

      <ArtReferences />

      <SceneSection
        text={basePrompt?.text ?? ''}
        onChange={setBasePrompt}
        model={form.model}
        apiKey={apiKey}
        meter={nai && counts && basePrompt ? <TokenMeter own={counts.base[basePrompt.id] ?? 0} others={counts.characterPromptTotal} budget={counts.budget} othersLabel="Characters" /> : null}
      />
      {/* NovelAI's dataset switches, put first in the prompt; the card's own.
          ✨ turns them on when it judges the scene or character needs them. */}
      <div className={cx('-mt-2 flex flex-wrap gap-x-4 gap-y-1', !nai && 'hidden')}>
        <Toggle checked={form.nsfwMode} onChange={(v) => set('nsfwMode', v)} label={<span className="text-xs" title="Puts nsfw first in the prompt">NSFW</span>} />
        <Toggle checked={form.furMode} onChange={(v) => set('furMode', v)} label={<span className="text-xs" title="Puts fur dataset first in the prompt (NovelAI's furry data)">Fur dataset</span>} />
      </div>

      {(!nai || !isV3) && <CharactersSection counts={nai ? (counts?.characters ?? {}) : {}} nai={nai} />}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">Negative prompt</span>
        <TagAutocompleteField value={form.negativePrompt} onChange={(v) => set('negativePrompt', v)} model={form.model} apiKey={apiKey} className={promptClass} rows={3} />
        {nai && counts && <TokenMeter own={counts.negative} others={counts.characterUcTotal} budget={counts.budget} othersLabel="Character negatives" />}
        {form.negativePrompt !== (nai || !connection ? DEFAULT_NEGATIVE : SD_DEFAULT_NEGATIVE) && (
          <button
            type="button"
            className="self-start text-[11px] text-slate-500 hover:text-slate-300"
            onClick={() => set('negativePrompt', nai || !connection ? DEFAULT_NEGATIVE : SD_DEFAULT_NEGATIVE)}
            title={nai || !connection ? "NovelAI's default negative" : 'A negative that suits most Stable Diffusion checkpoints'}
          >
            Reset to default
          </button>
        )}
      </div>

      {connection && !nai && <BackendSettings connection={connection} />}
      <div className={cx('grid grid-cols-2 gap-3', !nai && connection && 'hidden')}>
        <label className="col-span-2 flex flex-col gap-0.5 text-xs text-slate-400">
          Model
          <select value={form.model} onChange={(e) => set('model', e.target.value as NovelAIModel)} className={cx(inputClass, 'py-1')}>
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
          Size
          <select
            value={SIZE_PRESETS.find((p) => p.width === form.width && p.height === form.height)?.label ?? 'custom'}
            onChange={(e) => {
              const p = SIZE_PRESETS.find((x) => x.label === e.target.value);
              if (p) patch({ width: p.width, height: p.height });
            }}
            className={cx(inputClass, 'py-1')}
          >
            {SIZE_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label} ({p.width}×{p.height})
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        <div className="flex items-end gap-1 text-xs text-slate-400">
          <label className="flex flex-1 flex-col gap-0.5">
            W
            <NumberInput value={form.width} onChange={(v) => set('width', v ?? 832)} min={64} max={2048} step={64} />
          </label>
          <IconButton title="Swap width and height" onClick={() => patch({ width: form.height, height: form.width })}>
            ⇄
          </IconButton>
          <label className="flex flex-1 flex-col gap-0.5">
            H
            <NumberInput value={form.height} onChange={(v) => set('height', v ?? 1216)} min={64} max={2048} step={64} />
          </label>
        </div>
        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
          Quality tags
          <select value={form.qualityPreset} onChange={(e) => set('qualityPreset', e.target.value as typeof form.qualityPreset)} className={cx(inputClass, 'py-1')}>
            {getAvailableQualityLevels(form.model).map((l) => (
              <option key={l} value={l}>
                {QUALITY_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
          UC preset
          <select value={form.ucPreset} onChange={(e) => set('ucPreset', e.target.value as typeof form.ucPreset)} className={cx(inputClass, 'py-1')}>
            {getAvailableUcLevels(form.model).map((l) => (
              <option key={l} value={l}>
                {UC_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
          Steps
          <NumberInput value={form.steps} onChange={(v) => set('steps', v ?? 28)} min={1} max={50} step={1} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
          Prompt guidance (CFG)
          <NumberInput value={form.scale} onChange={(v) => set('scale', v ?? 5)} min={0} max={10} step={0.1} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
          Seed <span className="text-slate-500">(0 = random)</span>
          <div className="flex gap-1">
            <NumberInput value={form.seed} onChange={(v) => set('seed', v ?? 0)} min={0} max={4294967295} step={1} />
            <IconButton title="Random each time" onClick={() => set('seed', 0)}>
              🎲
            </IconButton>
          </div>
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
          Sampler
          <select value={form.sampler} onChange={(e) => set('sampler', e.target.value as typeof form.sampler)} className={cx(inputClass, 'py-1')}>
            {SAMPLERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(nai || !connection) && (
        <button type="button" className="self-start text-xs text-slate-400 hover:text-slate-200" onClick={() => setAdvanced(!advanced)}>
          {advanced ? '▾' : '▸'} More settings
        </button>
      )}
      {advanced && (nai || !connection) && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-0.5 text-xs text-slate-400">
            CFG rescale
            <NumberInput value={form.cfgRescale} onChange={(v) => set('cfgRescale', v ?? 0)} min={0} max={1} step={0.02} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-slate-400">
            Noise schedule
            <select value={form.noiseSchedule} onChange={(e) => set('noiseSchedule', e.target.value as NovelAINoiseSchedule)} className={cx(inputClass, 'py-1')}>
              {['karras', 'exponential', 'polyexponential', 'native'].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-2">
            {hasVariety(form.model) && <Toggle checked={form.variety} onChange={(v) => set('variety', v)} label={<span className="text-xs">Variety+</span>} />}
            {form.model.startsWith('nai-diffusion-5') && <Toggle checked={form.transparentBg} onChange={(v) => set('transparentBg', v)} label={<span className="text-xs">Transparent background</span>} />}
            {isV3 && <Toggle checked={form.smea} onChange={(v) => set('smea', v)} label={<span className="text-xs">SMEA</span>} />}
            {isV3 && form.smea && <Toggle checked={form.smeaDyn} onChange={(v) => set('smeaDyn', v)} label={<span className="text-xs">DYN</span>} />}
            <Toggle checked={form.streamingMode} onChange={(v) => set('streamingMode', v)} label={<span className="text-xs">Live preview (streaming)</span>} />
          </div>
        </div>
      )}
      <div className="h-4" />
    </div>
  );
}

// ─── Scene (base prompt), with "illustrate a greeting" ───────────────────────

/** What a cast did to the character slots, for the toast. */
function castSummary(m: MergeResult): string {
  const list = (names: string[]) => names.join(', ');
  const parts = [
    m.updated.length ? `updated ${list(m.updated)}` : '',
    m.added.length ? `added ${list(m.added)}` : '',
    m.setAside.length ? `switched off ${list(m.setAside)} (not in this scene)` : '',
    m.dropped.length ? `no room for ${list(m.dropped)}` : '',
  ].filter(Boolean);
  return parts.length ? ` Characters: ${parts.join('; ')}.` : '';
}

/** Turns on the dataset switches a prompt writer asked for (never off: that
 *  stays your call), and says which, for the toast. */
function switchedOn(nsfw: boolean, fur: boolean): string {
  const form = useSettingsStore.getState();
  // Other backends have no dataset switches: an nsfw the writer asked for
  // goes back in the prompt as a tag (fur dataset means nothing to them).
  if (activeImageConnection()?.kind !== 'novelai' && activeImageConnection()) {
    const base = form.basePrompts.find((p) => p.selected) ?? form.basePrompts[0];
    if (nsfw && base && !/(^|,)\s*nsfw\s*(,|$)/i.test(base.text)) {
      form.set('basePrompts', form.basePrompts.map((p) => (p.id === base.id ? { ...p, text: joinPromptParts('nsfw', p.text) } : p)));
      return ' It added nsfw to the prompt.';
    }
    return '';
  }
  const on: string[] = [];
  if (nsfw && !form.nsfwMode) {
    form.set('nsfwMode', true);
    on.push('NSFW');
  }
  if (fur && !form.furMode) {
    form.set('furMode', true);
    on.push('Fur dataset');
  }
  return on.length ? ` ${on.join(' and ')} turned on, as it suggested.` : '';
}

// Art references: pictures (or other cards) the ✨ prompt writers draw
// from, per card, for this visit.
const useArtRefs = create<{ byCard: Record<string, Reference[]>; set: (card: string, refs: Reference[]) => void }>((set) => ({
  byCard: {},
  set: (card, refs) => set((s) => ({ byCard: { ...s.byCard, [card]: refs } })),
}));
const NO_REFS: Reference[] = [];

/** A prompt writer's request with the card's art references on it, and the
 *  connection it goes to. */
function artRequest(messages: LlmMessage[]): [LlmMessage[], { connectionId?: string }] {
  const id = useProjectStore.getState().project?.id;
  const refs = (id && useArtRefs.getState().byCard[id]) || NO_REFS;
  return [withReferences(messages, refs), { connectionId: referenceConnectionId(refs) }];
}
const hasArtRefs = () => {
  const id = useProjectStore.getState().project?.id;
  return !!(id && useArtRefs.getState().byCard[id]?.length);
};
const artNote = () => (hasArtRefs() ? artReferenceNote() : '');

function ArtReferences() {
  const id = useProjectStore((s) => s.project?.id);
  const refs = useArtRefs((s) => (id && s.byCard[id]) || NO_REFS);
  const setRefs = useArtRefs((s) => s.set);
  if (!id) return null;
  return (
    <ReferenceTray
      refs={refs}
      label="Art references"
      hint="Pictures (or other cards) for ✨ From greeting and ✨ From description to draw from: a character's look, an outfit, a place. You can also drop pictures here."
      onAdd={(r) => setRefs(id, [...refs, ...r.filter((n) => !refs.some((c) => c.id === n.id))])}
      onRemove={(rid) => setRefs(id, refs.filter((r) => r.id !== rid))}
      className="-mb-1"
    />
  );
}

/** The card's style: artist and style tags in front of every prompt, which
 *  the ✨ writers leave alone. */
function StyleSection({ text, onChange, model, apiKey }: { text: string; onChange: (v: string) => void; model: NovelAIModel; apiKey: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">
        Style <span className="font-normal text-slate-500 normal-case">(artist and style tags, first in every prompt; ✨ leaves it alone)</span>
      </span>
      <TagAutocompleteField value={text} onChange={onChange} model={model} apiKey={apiKey} className={promptClass} rows={2} placeholder="artist:name, 0.8::artist:other::, watercolor, flat color" />
    </div>
  );
}

function SceneSection({ text, onChange, model, apiKey, meter }: { text: string; onChange: (v: string) => void; model: NovelAIModel; apiKey: string; meter: React.ReactNode }) {
  const card = useProjectStore((s) => s.project?.card.data);
  const illustrate = useBridgeStore((s) => s.illustrate);
  const clearIllustrate = useBridgeStore((s) => s.clearIllustrate);
  const { runAssist, runId, running, stop } = useLlmStream();
  const [pickOpen, setPickOpen] = useState(false);

  const placeCharacters = useSettingsStore((s) => s.placeCharacters);
  const setForm = useSettingsStore((s) => s.set);
  // V3 has no character prompts; other backends get them appended.
  const castModel = activeImageConnection()?.kind === 'novelai' || !activeImageConnection() ? !isV3Model(model) : true;

  const fromText = async (scene: string) => {
    if (!card) return;
    // V3 has no character prompts: everything goes in the one prompt.
    if (!castModel) {
      const [messages, opts] = artRequest(sceneTagsMessages(card, scene, artNote()));
      const r = await runAssist(messages, undefined, '✨ Scene prompt', opts);
      if (r.error) return toast(r.error, 'error');
      const { tags, nsfw, fur } = takeDatasetTags(cleanTags(r.text));
      if (tags) {
        onChange(tags);
        toast(`Scene prompt written from the greeting.${switchedOn(nsfw, fur)} Tweak it, then Generate.`, 'success');
      }
      return;
    }
    // V4 and later: the main prompt and a prompt for each character in it.
    const form = useSettingsStore.getState();
    const place = form.placeCharacters;
    const [messages, opts] = artRequest(castSceneMessages(card, scene, artNote(), form.characters.filter((c) => !c.archived), place));
    const r = await runAssist(messages, undefined, '✨ Scene prompt', opts);
    if (r.error) return toast(r.error, 'error');
    const cast = parseCast(r.text);
    if (!cast.scene && !cast.characters.length) return toast("The assistant's reply had no prompts in it (🔍 shows what it said).", 'error');
    if (cast.scene) onChange(cast.scene);
    let summary = '';
    if (cast.characters.length) {
      const now = useSettingsStore.getState();
      const m = mergeCast(now.characters, cast.characters, { scene: true, max: maxCharacters(now.model), cardName: card.name });
      now.set('characters', m.characters);
      if (place && cast.characters.some((c) => c.center)) now.set('useCoords', true);
      summary = castSummary(m);
    }
    toast(`Scene written from the greeting.${summary}${switchedOn(cast.nsfw, cast.fur)} Tweak it, then Generate.`, 'success');
  };

  // A greeting's 🎨 in the editor lands here.
  useEffect(() => {
    if (illustrate) {
      clearIllustrate();
      void fromText(illustrate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [illustrate]);

  const greetings = card ? [card.first_mes, ...card.alternate_greetings].map((g, i) => ({ i, text: g })).filter((g) => g.text.trim()) : [];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">
          Scene <span className="font-normal text-slate-500 normal-case">(base prompt: framing, pose, setting)</span>
        </span>
        <div className="relative flex items-center gap-1">
          <AssistTraceButton runId={runId} />
          {running ? (
            <Button size="sm" variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" disabled={!greetings.length} onClick={() => setPickOpen(!pickOpen)} title="Write the scene prompt from a greeting with the assistant">
              ✨ From greeting ▾
            </Button>
          )}
          {pickOpen && (
            <div className="absolute right-0 z-30 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl" onMouseLeave={() => setPickOpen(false)}>
              {castModel && (
                <div className="border-b border-slate-800 px-2 pt-1 pb-2" title="Also place each character on NovelAI's grid (turns Positions on). Off, NovelAI decides where they go.">
                  <Toggle checked={placeCharacters} onChange={(v) => setForm('placeCharacters', v)} label={<span className="text-xs">Place characters too</span>} />
                </div>
              )}
              {greetings.map((g) => (
                <button
                  key={g.i}
                  type="button"
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800"
                  onClick={() => {
                    setPickOpen(false);
                    void fromText(greetingText(card!, g.i));
                  }}
                >
                  <span className="font-semibold text-slate-200">{g.i === 0 ? 'First message' : `Alt #${g.i}`}</span> · {g.text.slice(0, 80)}…
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <TagAutocompleteField value={text} onChange={onChange} model={model} apiKey={apiKey} className={promptClass} rows={3} placeholder="cowboy shot, smile, looking at viewer, indoors, tavern, warm lighting" />
      {meter}
    </div>
  );
}

// ─── Characters (V4+) ────────────────────────────────────────────────────────

function CharactersSection({ counts, nai }: { counts: Record<string, { prompt: number; uc: number }>; nai: boolean }) {
  const { characters, set, model, useCoords } = useSettingsStore();
  const apiKey = useSessionStore((s) => s.apiKey);
  const card = useProjectStore((s) => s.project?.card.data);
  const { runAssist, runId, running, stop } = useLlmStream();
  const [openUc, setOpenUc] = useState<Set<string>>(new Set());
  const max = maxCharacters(model);
  const active = characters.filter((c) => !c.archived);
  const projectId = useProjectStore((s) => s.project?.id);
  const referenced = useArtRefs((s) => !!(projectId && s.byCard[projectId]?.length));

  const update = (id: string, patch: Partial<CharacterPromptEntry>) => set('characters', characters.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const add = (prompt = '') =>
    set('characters', [...characters, { id: uuid(), label: active.length === 0 ? card?.name || 'Character' : `Character ${active.length + 1}`, prompt, uc: '', center: { x: 0.5, y: 0.5 }, enabled: true }]);

  /** Every character the card describes, each into the slot of that name
   *  (a card about several gets several). */
  const appearance = async () => {
    if (!card) return;
    const [messages, opts] = artRequest(appearanceTagsMessages(card, artNote(), active.map((c) => c.label ?? '')));
    const r = await runAssist(messages, undefined, '✨ Character prompt', opts);
    if (r.error) return toast(r.error, 'error');
    const cast = parseCast(r.text);
    // A reply without CHARACTER lines is one character's tags.
    const members = cast.characters.length ? cast.characters : cast.scene ? [{ name: active[0]?.label || card.name || 'Character', tags: cast.scene }] : [];
    if (!members.length) return;
    const now = useSettingsStore.getState();
    const m = mergeCast(now.characters, members, { scene: false, max: maxCharacters(now.model), cardName: card.name });
    set('characters', m.characters);
    toast(`${members.length === 1 ? 'Character prompt' : 'Character prompts'} written from the card's description${hasArtRefs() ? ' and your references' : ''}.${castSummary(m)}${switchedOn(cast.nsfw, cast.fur)}`, 'success');
  };

  const positions = useMemo(() => POSITIONS.flatMap((y) => POSITIONS.map((x) => ({ x, y }))), []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">
          Characters <span className="font-normal text-slate-500 normal-case">{nai ? '(appearance, per character)' : '(each added to the end of the prompt; negatives to the negative)'}</span>
        </span>
        <div className="flex items-center gap-1">
          {nai && active.length > 1 && <Toggle checked={useCoords} onChange={(v) => set('useCoords', v)} label={<span className="text-xs">Positions</span>} />}
          <AssistTraceButton runId={runId} />
          {running ? (
            <Button size="sm" variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" disabled={!card?.description.trim() && !referenced} onClick={() => void appearance()} title="Write each character's prompt from the card's description and any art references (one per character, for a card about several)">
              ✨ From description
            </Button>
          )}
          <Button size="sm" disabled={active.length >= max} onClick={() => add()}>
            + Add
          </Button>
        </div>
      </div>
      {active.length === 0 && <p className="text-xs text-slate-500">Add a character to describe {card?.name || 'the character'}&apos;s look separately from the scene, or let ✨ write it from the description.</p>}
      {active.map((c) => (
        <div key={c.id} className={cx('flex flex-col gap-1.5 rounded-md border border-slate-800 bg-slate-900/60 p-2', !c.enabled && 'opacity-60')}>
          <div className="flex items-center gap-2">
            <Toggle checked={c.enabled} onChange={(enabled) => update(c.id, { enabled })} />
            <input value={c.label ?? ''} onChange={(e) => update(c.id, { label: e.target.value })} className="min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none" placeholder="Name" />
            {nai && useCoords && active.length > 1 && (
              <select
                value={`${c.center.x},${c.center.y}`}
                onChange={(e) => {
                  const [x, y] = e.target.value.split(',').map(Number);
                  update(c.id, { center: { x, y } });
                }}
                className={cx(inputClass, 'w-24 py-0.5 text-xs')}
                title="Where in the picture"
              >
                {positions.map((p) => (
                  <option key={`${p.x},${p.y}`} value={`${p.x},${p.y}`}>
                    {'ABCDE'[POSITIONS.indexOf(p.x)]}
                    {POSITIONS.indexOf(p.y) + 1}
                  </option>
                ))}
              </select>
            )}
            <IconButton title="Negative prompt for this character" onClick={() => setOpenUc((s) => (s.has(c.id) ? new Set([...s].filter((x) => x !== c.id)) : new Set(s).add(c.id)))}>
              −
            </IconButton>
            <IconButton title="Remove character" tone="danger" onClick={() => set('characters', characters.filter((x) => x.id !== c.id))}>
              ✕
            </IconButton>
          </div>
          <TagAutocompleteField value={c.prompt} onChange={(prompt) => update(c.id, { prompt })} model={model} apiKey={apiKey} className={promptClass} rows={2} placeholder="1girl, long silver hair, red eyes, knight armor" />
          {(openUc.has(c.id) || c.uc) && <TagAutocompleteField value={c.uc} onChange={(uc) => update(c.id, { uc })} model={model} apiKey={apiKey} className={cx(promptClass, 'min-h-10')} rows={1} placeholder="This character's negative" />}
          {counts[c.id] && <span className="text-right text-[10px] text-slate-500 tabular-nums">{counts[c.id].prompt} tokens</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Other backends ──────────────────────────────────────────────────────────

/** A1111 / ComfyUI's request, from the form: the prompt with the characters
 *  appended, and the connection's checkpoint, sampler and scheduler. */
function backendRequest(c: ImageConnection, form: ReturnType<typeof useSettingsStore.getState>, resolved: Parameters<typeof composeBackendPrompts>[1], seed: number, base?: Img2ImgBase): BackendGenRequest {
  const { prompt, negative } = composeBackendPrompts(form, resolved);
  return {
    prompt,
    negative,
    width: base?.width ?? form.width,
    height: base?.height ?? form.height,
    steps: form.steps,
    cfg: form.scale,
    seed,
    checkpoint: c.checkpoint,
    sampler: c.sampler,
    scheduler: c.scheduler,
    ...(base ? { init: { image: base.image, strength: base.strength } } : {}),
  };
}

/** Which connection gens go to, when there's a choice. */
function ImageConnectionPicker({ current }: { current: ImageConnection }) {
  const connections = useSettingsStore((s) => s.imageConnections);
  if (connections.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      Generate with
      <select value={current.id} onChange={(e) => selectImageConnection(e.target.value)} className={cx(inputClass, 'w-auto flex-1 py-1 text-xs')}>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name === IMAGE_KIND_LABELS[c.kind] ? c.name : `${c.name} (${IMAGE_KIND_LABELS[c.kind]})`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The settings A1111 and ComfyUI take: the checkpoint, sampler and
 *  scheduler (from the server's lists, kept on the connection), size,
 *  steps, CFG and seed (the form's, shared with NovelAI). */
function BackendSettings({ connection: c }: { connection: ImageConnection }) {
  const form = useSettingsStore();
  const { set, patch } = form;
  const options = useBackendOptions((s) => s.byId[c.id]);
  useEffect(() => {
    if (!options) void loadBackendOptions(c).catch(() => {});
  }, [c, options]);
  const loaded = options && options !== 'loading' && !('error' in options) ? options : null;
  const pick = (label: string, key: 'checkpoint' | 'sampler' | 'scheduler', list: string[] | undefined, fallback: string) => (
    <label className={cx('flex flex-col gap-0.5 text-xs text-slate-400', key === 'checkpoint' && 'col-span-2')}>
      {label}
      <select value={c[key]} onChange={(e) => updateImageConnection(c.id, { [key]: e.target.value })} className={cx(inputClass, 'py-1')}>
        <option value="">{fallback}</option>
        {c[key] && !list?.includes(c[key]) && <option value={c[key]}>{c[key]}</option>}
        {list?.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
  const custom = c.kind === 'comfyui' && c.workflow;
  return (
    <div className="grid grid-cols-2 gap-3">
      {options && options !== 'loading' && 'error' in options && (
        <div className="col-span-2 flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span className="flex-1">{options.error}</span>
          <Button size="sm" onClick={() => void loadBackendOptions(c, true).catch(() => {})}>
            Retry
          </Button>
        </div>
      )}
      {pick('Checkpoint', 'checkpoint', loaded?.checkpoints, c.kind === 'a1111' ? `The one loaded${loaded?.current ? ` (${loaded.current})` : ''}` : custom ? "The workflow's own" : loaded?.checkpoints[0] ? `First: ${loaded.checkpoints[0]}` : 'The first one')}
      {pick('Sampler', 'sampler', loaded?.samplers, custom ? "The workflow's own" : 'Default')}
      {pick('Scheduler', 'scheduler', loaded?.schedulers, custom ? "The workflow's own" : 'Default')}
      <label className="flex flex-col gap-0.5 text-xs text-slate-400">
        Size
        <select
          value={SIZE_PRESETS.find((p) => p.width === form.width && p.height === form.height)?.label ?? 'custom'}
          onChange={(e) => {
            const p = SIZE_PRESETS.find((x) => x.label === e.target.value);
            if (p) patch({ width: p.width, height: p.height });
          }}
          className={cx(inputClass, 'py-1')}
        >
          {SIZE_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label} ({p.width}×{p.height})
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      <div className="flex items-end gap-1 text-xs text-slate-400">
        <label className="flex flex-1 flex-col gap-0.5">
          W
          <NumberInput value={form.width} onChange={(v) => set('width', v ?? 832)} min={64} max={4096} step={8} />
        </label>
        <IconButton title="Swap width and height" onClick={() => patch({ width: form.height, height: form.width })}>
          ⇄
        </IconButton>
        <label className="flex flex-1 flex-col gap-0.5">
          H
          <NumberInput value={form.height} onChange={(v) => set('height', v ?? 1216)} min={64} max={4096} step={8} />
        </label>
      </div>
      <label className="flex flex-col gap-0.5 text-xs text-slate-400">
        Steps
        <NumberInput value={form.steps} onChange={(v) => set('steps', v ?? 28)} min={1} max={150} step={1} />
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-slate-400">
        CFG
        <NumberInput value={form.scale} onChange={(v) => set('scale', v ?? 6)} min={0} max={30} step={0.5} />
      </label>
      <label className="col-span-2 flex flex-col gap-0.5 text-xs text-slate-400">
        Seed <span className="text-slate-500">(0 = random)</span>
        <div className="flex gap-1">
          <NumberInput value={form.seed} onChange={(v) => set('seed', v ?? 0)} min={0} max={4294967295} step={1} />
          <IconButton title="Random each time" onClick={() => set('seed', 0)}>
            🎲
          </IconButton>
        </div>
      </label>
    </div>
  );
}
