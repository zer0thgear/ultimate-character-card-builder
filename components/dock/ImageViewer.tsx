'use client';

import { useEffect, useState } from 'react';
import { imageBlob, useSessionStore, type SessionImage } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBridgeStore } from '@/store/bridgeStore';
import type { EditorMode } from '@/lib/editorResult';
import { setAsAvatar, keepImage, saveSessionImage, reusePrompt, genFileName, withImage } from '@/lib/imageActions';
import { downloadBlob, IconButton, Button, cx } from '@/components/ui';
import { openLightbox } from '@/components/Lightbox';
import { openVisionWrite } from '@/components/VisionWriteDialog';
import { ExtensionImageActions } from '@/components/ExtensionSlots';
import { useGenerate } from '@/hooks/useGenerate';
import { useSubscription } from '@/hooks/useSubscription';
import { useActiveImageConnection } from '@/store/imageConnections';
import { useConfigStore, toast } from '@/store/uiStore';
import { buildEnhanceRequest } from '@/lib/genRequest';
import { promptSource } from '@/lib/imageRequest';
import { blobToBase64 } from '@/lib/imageUtils';
import { calculateAnlasCost, opusStatus } from '@/lib/anlasCost';
import { ENHANCE_LEVELS, enhanceOutputSize, enhancePriceSize, enhanceScales, scaleLabel, type EnhanceLevelNum, type EnhanceScale } from '@/lib/enhance';

/** Makes this picture the image panel's Img2Img base, optionally opening
 *  the Edit Image or Inpaint canvas on it. */
export const sendToImg2Img = (blob: Blob, open?: EditorMode) => useBridgeStore.getState().sendToImg2Img(blob, open);

export function ImageViewer({ image, all = [], preview, generating }: { image?: SessionImage; all?: SessionImage[]; preview: string | null; generating: boolean }) {
  const removeImages = useSessionStore((s) => s.removeImages);
  const select = useSessionStore((s) => s.select);
  /** Full screen, swiping through this card's gens; the viewer follows. */
  const fullscreen = (img: SessionImage) => {
    const list = all.some((i) => i.id === img.id) ? all : [img];
    openLightbox(list.map((i) => i.url), list.findIndex((i) => i.id === img.id), (n) => select(list[n].id));
  };
  const set = useSettingsStore((s) => s.set);
  const nai = useActiveImageConnection()?.kind === 'novelai';
  const [enhancing, setEnhancing] = useState(false);
  const { generate, error: enhanceError, clearError } = useGenerate();
  const setGenerating = useSessionStore((s) => s.setGenerating);
  const { refresh } = useSubscription();
  useEffect(() => {
    if (enhanceError) {
      toast(`Enhance failed: ${enhanceError}`, 'error');
      clearError();
    }
  }, [enhanceError, clearError]);
  /** Runs an Enhance of `img`; the result lands in the gens like any other. */
  const enhance = async (img: SessionImage, level: EnhanceLevelNum, scale: EnhanceScale) => {
    setPanelFor(null);
    setEnhancing(true);
    setGenerating(1);
    try {
      const blob = await imageBlob(img);
      const now = useSettingsStore.getState();
      const { request, resolved } = buildEnhanceRequest(now, img, level, scale, await blobToBase64(blob));
      const made = await generate(request, { sourceImageId: img.id, sourceImageUrl: URL.createObjectURL(blob), wildcardPicks: resolved.picks, source: promptSource(now, resolved), projectId: img.projectId, forceStandard: true });
      if (made && useConfigStore.getState().config.autoSaveGens) for (const m of made) void saveSessionImage(m, true);
    } catch (err) {
      toast(`Enhance failed: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      setGenerating(-1);
      setEnhancing(false);
      void refresh();
    }
  };
  // A new picture closes the Enhance panel.
  const [panelFor, setPanelFor] = useState<string | null>(null);
  const src = preview ?? image?.url;
  return (
    <div className="flex h-full flex-col">
      <div className="checker relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            title={image && !preview ? 'Tap for full screen' : undefined}
            onClick={() => image && !preview && fullscreen(image)}
            className={cx('max-h-full max-w-full object-contain', preview ? 'opacity-80' : image && 'cursor-zoom-in')}
          />
        ) : (
          <span className="text-sm text-slate-500">{generating ? 'Generating…' : 'Your gens for this card show up here.'}</span>
        )}
        {generating && <div className="absolute top-2 left-2 animate-pulse rounded bg-black/60 px-2 py-0.5 text-xs text-white">Generating…</div>}
      </div>
      {image && nai && panelFor === image.id && !generating && <EnhancePanel image={image} onEnhance={(level, scale) => void enhance(image, level, scale)} />}
      {image && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1 border-t border-slate-800 bg-slate-950 px-2 py-1">
          <Button size="sm" variant="primary" onClick={() => withImage(image, setAsAvatar)} title="Make this the card's picture">
            Set as avatar
          </Button>
          <Button size="sm" onClick={() => void keepImage(image)} disabled={!!image.keptFile} title="Keep it with the card (saved in the project, shown in Gallery)">
            {image.keptFile ? '★ Kept' : '☆ Keep'}
          </Button>
          <Button size="sm" onClick={() => void saveSessionImage(image)} title={image.savedPath ?? 'Save to the output folder'}>
            {image.savedPath ? '✓ Saved' : 'Save to folder'}
          </Button>
          {nai && (
            <Button size="sm" variant={panelFor === image.id ? 'primary' : 'secondary'} disabled={enhancing || generating} onClick={() => setPanelFor(panelFor === image.id ? null : image.id)} title="Enhance: NovelAI re-renders it larger, adding detail (an Image2Image at the size you pick)">
              ✨ Enhance
            </Button>
          )}
          <div className="ml-auto flex items-center">
            <IconButton title="Full screen" onClick={() => fullscreen(image)}>
              ⛶
            </IconButton>
            <IconButton title="Download" onClick={() => withImage(image, (b) => downloadBlob(b, genFileName(image), 'image/png'))}>
              ⬇
            </IconButton>
            <IconButton title="Use as the Img2Img base" onClick={() => withImage(image, (b) => sendToImg2Img(b))}>
              ⎘
            </IconButton>
            <IconButton title="Inpaint: mark part of it to regenerate" onClick={() => withImage(image, (b) => sendToImg2Img(b, 'mask'))}>
              🖌
            </IconButton>
            <IconButton title={`Use this seed (${image.seed})`} onClick={() => set('seed', image.seed)}>
              🌱
            </IconButton>
            <IconButton title="✨ Write from this image: a physical description, a greeting, or ask about it (vision model)" onClick={() => withImage(image, openVisionWrite)}>
              ✍
            </IconButton>
            <ExtensionImageActions variant="icon" image={{ name: genFileName(image), source: 'gen', blob: () => imageBlob(image), projectId: image.projectId }} />
            <IconButton title="Load this image's prompt back into the form" onClick={() => withImage(image, reusePrompt)}>
              ♻
            </IconButton>
            <IconButton title="Remove from this session" tone="danger" onClick={() => removeImages([image.id])}>
              🗑
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Enhance (NovelAI) ───────────────────────────────────────────────────────

// The last scale picked for pictures of each size, as NovelAI remembers it.
const SCALE_MEMORY_KEY = 'uccb-enhance-scale-by-size';
function rememberedScale(pixels: number, options: EnhanceScale[]): EnhanceScale | null {
  try {
    const saved = (JSON.parse(localStorage.getItem(SCALE_MEMORY_KEY) ?? '{}') as Record<string, EnhanceScale>)[pixels];
    return saved !== undefined && options.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}
function rememberScale(pixels: number, scale: EnhanceScale) {
  try {
    const saved = JSON.parse(localStorage.getItem(SCALE_MEMORY_KEY) ?? '{}') as Record<string, EnhanceScale>;
    localStorage.setItem(SCALE_MEMORY_KEY, JSON.stringify({ ...saved, [pixels]: scale }));
  } catch {
    /* storage unavailable */
  }
}

/** NovelAI's Enhance, as on novelai.net: a level (how much it may change)
 *  and a size, with its cost. The result lands in the gens like any other. */
function EnhancePanel({ image, onEnhance }: { image: SessionImage; onEnhance: (level: EnhanceLevelNum, scale: EnhanceScale) => void }) {
  const form = useSettingsStore();
  const { subscription } = useSubscription();
  const [level, setLevel] = useState<EnhanceLevelNum>(3);
  const [choice, setChoice] = useState<EnhanceScale | null>(null);
  const w = image.parameters.width;
  const h = image.parameters.height;
  const options = enhanceScales(w, h, form.model);
  const scale = choice !== null && options.includes(choice) ? choice : (rememberedScale(w * h, options) ?? options[0] ?? null);
  const price = scale !== null ? enhancePriceSize(w, h, scale) : null;
  const cost = price
    ? calculateAnlasCost({ model: form.model, width: price.width, height: price.height, steps: form.steps, smea: false, smeaDyn: false, strength: ENHANCE_LEVELS[level - 1].strength, ...opusStatus(subscription) })
    : 0;

  if (!options.length) {
    return <div className="flex-shrink-0 border-t border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">NovelAI can&apos;t enhance a {w}×{h} picture: no larger size stays within its 3.1 megapixel limit.</div>;
  }
  return (
    <div className="flex flex-shrink-0 flex-col gap-2 border-t border-slate-800 bg-slate-900 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-12 font-semibold tracking-wide text-slate-400 uppercase">Level</span>
        {ENHANCE_LEVELS.map((l) => (
          <button
            key={l.level}
            type="button"
            onClick={() => setLevel(l.level)}
            title={`Strength ${l.strength}, noise ${l.noise}: ${l.level <= 2 ? 'stays close to the picture' : l.level >= 4 ? 'changes more, adds more detail' : 'balanced'}`}
            className={cx('flex min-w-9 flex-col items-center rounded px-2 py-0.5', level === l.level ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}
          >
            <span className="font-semibold">{l.level}</span>
            <span className="text-[10px] opacity-70">{l.strength}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-12 font-semibold tracking-wide text-slate-400 uppercase">Size</span>
        {/* Smallest first, as NovelAI lists them. */}
        {[...options].reverse().map((sc) => {
          const out = enhanceOutputSize(w, h, sc);
          return (
            <button
              key={String(sc)}
              type="button"
              onClick={() => {
                setChoice(sc);
                rememberScale(w * h, sc);
              }}
              title={sc === 'max' ? `Re-renders at this size, then NovelAI upscales it (to about ${out.width}×${out.height})` : `${out.width}×${out.height}`}
              className={cx('rounded px-2 py-1 font-semibold', scale === sc ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}
            >
              {scaleLabel(sc)}
            </button>
          );
        })}
        {scale !== null && <span className="text-slate-500">{(() => { const o = enhanceOutputSize(w, h, scale); return `→ ${o.width}×${o.height}`; })()}</span>}
        <Button size="sm" variant="primary" className="ml-auto" disabled={scale === null} onClick={() => scale !== null && onEnhance(level, scale)}>
          Enhance <span className="text-[11px] font-normal opacity-75">{cost === 0 ? 'free' : `${cost} Anlas`}</span>
        </Button>
      </div>
      <p className="text-[11px] text-slate-500">Uses the form&apos;s prompt and settings, as NovelAI does (the picture&apos;s own wildcard rolls are kept).</p>
    </div>
  );
}
