'use client';

import { useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useSessionStore, type SessionImage } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { api } from '@/lib/api';
import { setAsAvatar, keepImage, saveSessionImage, saveToFolder, reusePrompt } from '@/lib/imageActions';
import { Button, Empty, IconButton, Modal, Section, confirmDialog, cx, downloadBlob, inputClass } from '@/components/ui';
import { sendToImg2Img } from '@/components/dock/ImageViewer';
import type { KeptImage } from '@/types/project';

// This card's pictures: gens kept with it (saved in the project) and this
// session's gens (in memory until kept, saved or cleared).

export function GalleryPanel() {
  const project = useProjectStore((s) => s.project);
  const images = useSessionStore((s) => s.images);
  const { clearSession, select } = useSessionStore();
  const setDockTab = useUiStore((s) => s.setDockTab);
  const [view, setView] = useState<{ kind: 'kept'; item: KeptImage } | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (!project) return null;
  const session = images.filter((i) => showAll || i.projectId === project.id);
  const unsaved = images.filter((i) => !i.keptFile && !i.savedPath && !i.pinned).length;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-3">
      <Section title={`Kept with this card (${project.kept.length})`}>
        {project.kept.length === 0 ? (
          <Empty>Keep a gen (☆ Keep) to save it with the card: candidate avatars, expressions, outfit references.</Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {[...project.kept].reverse().map((k) => (
              <button key={k.file} type="button" onClick={() => setView({ kind: 'kept', item: k })} className="group relative overflow-hidden rounded-md border border-slate-800 hover:border-violet-500" style={{ aspectRatio: `${k.width || 2} / ${k.height || 3}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={api.keptUrl(project.id, k.file)} alt={k.label ?? ''} className="h-full w-full object-cover" loading="lazy" />
                {k.label && <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-[10px] text-white">{k.label}</span>}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={`This session (${session.length})`}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'This card only' : 'All cards'}
            </Button>
            {images.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const pinned = images.filter((i) => i.pinned).length;
                  if (await confirmDialog({ title: 'Clear this session?', body: `${images.length - pinned} gens go${pinned ? `; ${pinned} kept ones stay` : ''}. ${unsaved ? `${unsaved} haven't been kept or saved anywhere.` : ''}`, confirmLabel: 'Clear', danger: true })) clearSession();
                }}
              >
                Clear
              </Button>
            )}
          </>
        }
      >
        {session.length === 0 ? (
          <Empty>Nothing generated yet this session. Gens live in memory until you keep them, save them or close the page.</Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {session.map((img) => (
              <SessionThumb
                key={img.id}
                img={img}
                onOpen={() => {
                  select(img.id);
                  setDockTab('image');
                }}
              />
            ))}
          </div>
        )}
      </Section>
      {view && <KeptViewer projectId={project.id} item={view.item} onClose={() => setView(null)} />}
    </div>
  );
}

function SessionThumb({ img, onOpen }: { img: SessionImage; onOpen: () => void }) {
  return (
    <div className="group relative overflow-hidden rounded-md border border-slate-800" style={{ aspectRatio: `${img.parameters.width} / ${img.parameters.height}` }}>
      <button type="button" onClick={onOpen} className="h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt="" className="h-full w-full object-cover" />
      </button>
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-0.5 bg-black/70 opacity-0 group-hover:opacity-100 touch:opacity-100">
        <IconButton title="Set as avatar" className="text-white" onClick={() => void setAsAvatar(img.blob)}>
          👤
        </IconButton>
        <IconButton title={img.keptFile ? 'Kept' : 'Keep with the card'} className="text-white" disabled={!!img.keptFile} onClick={() => void keepImage(img)}>
          {img.keptFile ? '★' : '☆'}
        </IconButton>
        <IconButton title={img.savedPath ?? 'Save to folder'} className="text-white" onClick={() => void saveSessionImage(img)}>
          💾
        </IconButton>
      </div>
      {(img.keptFile || img.savedPath) && <span className="absolute top-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] text-white">{img.keptFile ? '★' : '✓'}</span>}
    </div>
  );
}

function KeptViewer({ projectId, item, onClose }: { projectId: string; item: KeptImage; onClose: () => void }) {
  const { unkeep, updateKept } = useProjectStore();
  const [label, setLabel] = useState(item.label ?? '');
  const url = api.keptUrl(projectId, item.file);
  const blob = async () => (await fetch(url)).blob();
  return (
    <Modal
      open
      onClose={onClose}
      title={item.label || 'Kept gen'}
      size="xl"
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-red-400"
            onClick={async () => {
              if (await confirmDialog({ title: 'Stop keeping this gen?', body: "It's deleted from the project folder. Save it to a folder first if you want a copy.", confirmLabel: 'Delete', danger: true })) {
                await unkeep(item.file);
                onClose();
              }
            }}
          >
            Delete
          </Button>
          <Button onClick={async () => downloadBlob(await blob(), `${item.label || item.id}.png`, 'image/png')}>Download</Button>
          <Button onClick={async () => void saveToFolder(await blob(), `${item.label || item.id}.png`)}>Save to folder</Button>
          <Button onClick={async () => { sendToImg2Img(await blob()); onClose(); }}>Img2Img base</Button>
          <Button onClick={async () => { sendToImg2Img(await blob(), 'mask'); onClose(); }}>Inpaint</Button>
          <Button onClick={async () => { await reusePrompt(await blob()); onClose(); }}>Reuse prompt</Button>
          <Button variant="primary" onClick={async () => { await setAsAvatar(await blob()); onClose(); }}>
            Set as avatar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="checker flex flex-1 items-center justify-center rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="max-h-[65vh] object-contain" />
        </div>
        <div className="flex w-full flex-col gap-2 md:w-72">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== (item.label ?? '') && updateKept(item.file, { label })} placeholder='e.g. "avatar v2", "angry"' className={inputClass} />
          </label>
          <div className="text-xs text-slate-500">
            {item.width}×{item.height} · seed {item.seed ?? '?'} · {new Date(item.createdAt).toLocaleString()}
          </div>
          {item.prompt && <div className={cx('max-h-72 overflow-y-auto rounded bg-slate-950 p-2 font-mono text-[11px] whitespace-pre-wrap text-slate-400')}>{item.prompt}</div>}
        </div>
      </div>
    </Modal>
  );
}
