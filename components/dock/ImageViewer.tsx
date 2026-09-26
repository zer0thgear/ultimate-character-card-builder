'use client';

import { useSessionStore, type SessionImage } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBridgeStore } from '@/store/bridgeStore';
import type { EditorMode } from '@/lib/editorResult';
import { setAsAvatar, keepImage, saveSessionImage, reusePrompt, genFileName } from '@/lib/imageActions';
import { downloadBlob, IconButton, Button, cx } from '@/components/ui';

/** Makes this picture the image panel's Img2Img base, optionally opening
 *  the Edit Image or Inpaint canvas on it. */
export const sendToImg2Img = (blob: Blob, open?: EditorMode) => useBridgeStore.getState().sendToImg2Img(blob, open);

export function ImageViewer({ image, preview, generating }: { image?: SessionImage; preview: string | null; generating: boolean }) {
  const removeImages = useSessionStore((s) => s.removeImages);
  const set = useSettingsStore((s) => s.set);
  const src = preview ?? image?.url;
  return (
    <div className="flex h-full flex-col">
      <div className="checker relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className={cx('max-h-full max-w-full object-contain', preview && 'opacity-80')} />
        ) : (
          <span className="text-sm text-slate-500">{generating ? 'Generating…' : 'Your gens for this card show up here.'}</span>
        )}
        {generating && <div className="absolute top-2 left-2 animate-pulse rounded bg-black/60 px-2 py-0.5 text-xs text-white">Generating…</div>}
      </div>
      {image && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1 border-t border-slate-800 bg-slate-950 px-2 py-1">
          <Button size="sm" variant="primary" onClick={() => void setAsAvatar(image.blob)} title="Make this the card's picture">
            Set as avatar
          </Button>
          <Button size="sm" onClick={() => void keepImage(image)} disabled={!!image.keptFile} title="Keep it with the card (saved in the project, shown in Gallery)">
            {image.keptFile ? '★ Kept' : '☆ Keep'}
          </Button>
          <Button size="sm" onClick={() => void saveSessionImage(image)} title={image.savedPath ?? 'Save to the output folder'}>
            {image.savedPath ? '✓ Saved' : 'Save to folder'}
          </Button>
          <div className="ml-auto flex items-center">
            <IconButton title="Download" onClick={() => downloadBlob(image.blob, genFileName(image), 'image/png')}>
              ⬇
            </IconButton>
            <IconButton title="Use as the Img2Img base" onClick={() => sendToImg2Img(image.blob)}>
              ⎘
            </IconButton>
            <IconButton title="Inpaint: mark part of it to regenerate" onClick={() => sendToImg2Img(image.blob, 'mask')}>
              🖌
            </IconButton>
            <IconButton title={`Use this seed (${image.seed})`} onClick={() => set('seed', image.seed)}>
              🌱
            </IconButton>
            <IconButton title="Load this image's prompt back into the form" onClick={() => void reusePrompt(image.blob)}>
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
