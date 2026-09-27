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
import { appearanceTagsMessages, cleanTags, sceneTagsMessages } from '@/lib/assist';
import { greetingText } from '@/lib/chatPrompt';
import { saveSessionImage } from '@/lib/imageActions';
import { TagAutocompleteField } from '@/components/TagAutocompleteField';
import { TokenMeter } from '@/components/TokenMeter';
import { Button, IconButton, NumberInput, Toggle, cx, inputClass } from '@/components/ui';
import { ImageViewer } from '@/components/dock/ImageViewer';
import { openSettings } from '@/components/SettingsDialog';
import type { CharacterPromptEntry, NovelAIModel, NovelAINoiseSchedule } from '@/types/novelai';
import { uuid } from '@/lib/uuid';
import { AssistTraceButton } from '@/components/llm/AssistTrace';

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
  const { generate, error, clearError } = useGenerate();
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

  const cost = calculateAnlasCost({
    model: inpainting ? toInpaintingModel(form.model) : form.model,
    width: source?.width ?? form.width,
    height: source?.height ?? form.height,
    steps: form.steps,
    smea: form.smea,
    smeaDyn: form.smeaDyn,
    strength: !source ? 1 : inpainting ? (hasInpaintStrength(form.model) ? inpaintStrength : 1) : strength,
    ...opusStatus(subscription),
  });
  const tooBig = (source?.width ?? form.width) * (source?.height ?? form.height) > MAX_GENERATION_PIXELS;

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
    if (!apiKey) return openSettings('general');
    if (generating || !hasPrompt || tooBig) return;
    clearError();
    stopRef.current = false;
    setGenerating(1);
    try {
      const base = await baseForRequest();
      for (let i = 0; i < form.copies && !stopRef.current; i++) {
        const seed = form.seed === 0 ? randomSeed() : form.seed + i;
        const { request, resolved } = buildGenerateRequest(useSettingsStore.getState(), seed, base);
        const made = await generate(request, { projectId, source: promptSource(form, resolved), wildcardPicks: resolved.picks, forceStandard: !!base });
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
      {!apiKey && (
        <button type="button" onClick={() => openSettings('general')} className="rounded-md bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-200">
          Add your NovelAI API key in Settings to generate.
        </button>
      )}

      <div className="flex items-center gap-2">
        <Button variant="primary" className="h-10 flex-1 text-base" disabled={!hasPrompt || tooBig || generating > 0} onClick={() => void run()} title="Ctrl+Enter">
          {generating > 0 ? (retryNotice ?? 'Generating…') : `Generate${form.copies > 1 ? ` ×${form.copies}` : ''}`}
          <span className="text-xs font-normal opacity-75">{cost === 0 ? 'free' : `${cost * form.copies} Anlas`}</span>
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
      <AccountStatus />
      {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
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
              <Button size="sm" onClick={() => setCanvas('mask')} title="Mark what to regenerate">
                {source.mask ? 'Edit mask' : 'Inpaint'}
              </Button>
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
                <label className="flex items-center gap-2">
                  Noise
                  <input type="range" min={0} max={0.99} step={0.01} value={noise} onChange={(e) => setNoise(Number(e.target.value))} className="flex-1 accent-violet-500" />
                  <span className="w-8 tabular-nums">{noise.toFixed(2)}</span>
                </label>
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

      <SceneSection
        text={basePrompt?.text ?? ''}
        onChange={setBasePrompt}
        model={form.model}
        apiKey={apiKey}
        meter={counts && basePrompt ? <TokenMeter own={counts.base[basePrompt.id] ?? 0} others={counts.characterPromptTotal} budget={counts.budget} othersLabel="Characters" /> : null}
      />

      {!isV3 && <CharactersSection counts={counts?.characters ?? {}} />}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">Negative prompt</span>
        <TagAutocompleteField value={form.negativePrompt} onChange={(v) => set('negativePrompt', v)} model={form.model} apiKey={apiKey} className={promptClass} rows={3} />
        {counts && <TokenMeter own={counts.negative} others={counts.characterUcTotal} budget={counts.budget} othersLabel="Character negatives" />}
        {form.negativePrompt !== DEFAULT_NEGATIVE && (
          <button type="button" className="self-start text-[11px] text-slate-500 hover:text-slate-300" onClick={() => set('negativePrompt', DEFAULT_NEGATIVE)}>
            Reset to default
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
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

      <button type="button" className="self-start text-xs text-slate-400 hover:text-slate-200" onClick={() => setAdvanced(!advanced)}>
        {advanced ? '▾' : '▸'} More settings
      </button>
      {advanced && (
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
            <Toggle checked={form.furMode} onChange={(v) => set('furMode', v)} label={<span className="text-xs">Fur dataset</span>} />
            <Toggle checked={form.streamingMode} onChange={(v) => set('streamingMode', v)} label={<span className="text-xs">Live preview (streaming)</span>} />
          </div>
        </div>
      )}
      <div className="h-4" />
    </div>
  );
}

// ─── Scene (base prompt), with "illustrate a greeting" ───────────────────────

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

  const fromText = async (scene: string) => {
    if (!card) return;
    const r = await runAssist(sceneTagsMessages(card, scene, ''), undefined, '✨ Scene prompt');
    if (r.error) return toast(r.error, 'error');
    const tags = cleanTags(r.text);
    if (tags) {
      onChange(tags);
      toast('Scene prompt written from the greeting. Tweak it, then Generate.', 'success');
    }
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

function CharactersSection({ counts }: { counts: Record<string, { prompt: number; uc: number }> }) {
  const { characters, set, model, useCoords } = useSettingsStore();
  const apiKey = useSessionStore((s) => s.apiKey);
  const card = useProjectStore((s) => s.project?.card.data);
  const { runAssist, runId, running, stop } = useLlmStream();
  const [openUc, setOpenUc] = useState<Set<string>>(new Set());
  const max = maxCharacters(model);
  const active = characters.filter((c) => !c.archived);

  const update = (id: string, patch: Partial<CharacterPromptEntry>) => set('characters', characters.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const add = (prompt = '') =>
    set('characters', [...characters, { id: uuid(), label: active.length === 0 ? card?.name || 'Character' : `Character ${active.length + 1}`, prompt, uc: '', center: { x: 0.5, y: 0.5 }, enabled: true }]);

  const appearance = async (target?: CharacterPromptEntry) => {
    if (!card) return;
    const r = await runAssist(appearanceTagsMessages(card, ''), undefined, '✨ Character prompt');
    if (r.error) return toast(r.error, 'error');
    const tags = cleanTags(r.text);
    if (!tags) return;
    if (target) update(target.id, { prompt: tags });
    else add(tags);
    toast("Character prompt written from the card's description.", 'success');
  };

  const positions = useMemo(() => POSITIONS.flatMap((y) => POSITIONS.map((x) => ({ x, y }))), []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">
          Characters <span className="font-normal text-slate-500 normal-case">(appearance, per character)</span>
        </span>
        <div className="flex items-center gap-1">
          {active.length > 1 && <Toggle checked={useCoords} onChange={(v) => set('useCoords', v)} label={<span className="text-xs">Positions</span>} />}
          <AssistTraceButton runId={runId} />
          {running ? (
            <Button size="sm" variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" disabled={!card?.description.trim()} onClick={() => void appearance(active[0])} title="Write the first character's prompt from the card's description">
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
            {useCoords && active.length > 1 && (
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
