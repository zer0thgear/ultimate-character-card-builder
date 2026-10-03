'use client';

import { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { useProjectStore } from '@/store/projectStore';
import { imageBlob, useSessionStore, type SessionImage } from '@/store/sessionStore';
import { useConfigStore, useUiStore, toast } from '@/store/uiStore';
import { EXPIRY_WARNING_MS, expiresIn, shortTimeLeft } from '@/lib/recentGens';
import { api } from '@/lib/api';
import { setAsAvatar, keepImage, saveSessionImage, saveToFolder, reusePrompt, genFileName, withImage } from '@/lib/imageActions';
import { Button, Empty, IconButton, Modal, Section, confirmDialog, cx, downloadBlob, inputClass } from '@/components/ui';
import { sendToImg2Img } from '@/components/dock/ImageViewer';
import type { KeptImage } from '@/types/project';
import { openLightbox } from '@/components/Lightbox';
import { openVisionWrite } from '@/components/VisionWriteDialog';
import { ExtensionImageActions } from '@/components/ExtensionSlots';

// This card's pictures: gens kept with it (saved in the project) and recent
// gens (on the server for Settings → Folders' number of days; see
// store/sessionStore.ts).
//
// Either section can be put into selecting (its Select button, or a long
// press on a picture) to act on several at once from the bar at the bottom.

type Selecting = { kind: 'kept' | 'session'; ids: Set<string> } | null;

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_');
const keptName = (k: KeptImage) => `${safeName(k.label || k.id)}.png`;
const plural = (n: number, one = 'gen') => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Several pictures as one download: a single PNG, or a zip of them. */
async function downloadMany(files: { name: string; blob: () => Promise<Blob> }[], zipName: string) {
  if (files.length === 1) return downloadBlob(await files[0].blob(), files[0].name, 'image/png');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    // Two with the same name (the same label, say) both go in.
    let name = f.name;
    for (let n = 2; used.has(name); n++) name = f.name.replace(/\.png$/, ` (${n}).png`);
    used.add(name);
    zip.file(name, await f.blob());
  }
  downloadBlob(await zip.generateAsync({ type: 'blob' }), zipName, 'application/zip');
}

export function GalleryPanel() {
  const project = useProjectStore((s) => s.project);
  const images = useSessionStore((s) => s.images);
  const { clearSession, select, removeImages } = useSessionStore();
  const setDockTab = useUiStore((s) => s.setDockTab);
  const [view, setView] = useState<{ kind: 'kept'; item: KeptImage } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [selecting, setSelecting] = useState<Selecting>(null);
  const [busy, setBusy] = useState(false);
  // For the ⏳ on gens about to be deleted: the time, once a minute.
  const keepDays = useConfigStore((s) => s.config.recentGensDays);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelecting(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  if (!project) return null;
  const session = images.filter((i) => showAll || i.projectId === project.id);
  const unsaved = images.filter((i) => !i.keptFile && !i.savedPath && !i.pinned).length;
  const leftOf = (img: SessionImage) => expiresIn(img, keepDays, now);
  const goingSoon = session.filter((img) => (leftOf(img) ?? Infinity) < EXPIRY_WARNING_MS).length;
  const kept = [...project.kept].reverse();

  const start = (kind: 'kept' | 'session', id?: string) => setSelecting({ kind, ids: new Set(id ? [id] : []) });
  const toggle = (id: string) =>
    setSelecting((s) => {
      if (!s) return s;
      const ids = new Set(s.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { ...s, ids };
    });
  // What's picked, in the grid's order, and still there.
  const pickedKept = selecting?.kind === 'kept' ? kept.filter((k) => selecting.ids.has(k.file)) : [];
  const pickedSession = selecting?.kind === 'session' ? session.filter((i) => selecting.ids.has(i.id)) : [];
  const count = pickedKept.length + pickedSession.length;
  const stamp = new Date().toISOString().slice(0, 10);
  const cardName = safeName(project.card.data.name || 'card');
  const keptBlob = async (k: KeptImage) => (await fetch(api.keptUrl(project.id, k.file))).blob();

  /** Runs a batch action with the bar disabled. Returning false (a
   *  cancelled confirm) keeps the selection; anything else ends selecting. */
  const run = async (fn: () => Promise<boolean | void>) => {
    setBusy(true);
    try {
      if ((await fn()) !== false) setSelecting(null);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Saves each to the output folder; stops (saveToFolder says why once)
   *  if there's no folder yet. */
  const saveAll = async (items: { blob: () => Promise<Blob>; save: (b: Blob) => Promise<string | null> }[]) => {
    let n = 0;
    for (const it of items) {
      if (!(await it.save(await it.blob()))) return n > 0;
      n++;
    }
    toast(`Saved ${plural(n)} to the output folder.`, 'success');
  };

  const sessionActions = {
    keep: () =>
      run(async () => {
        let n = 0;
        for (const img of pickedSession) if (!img.keptFile && (await keepImage(img, undefined, true))) n++;
        if (n) toast(`Kept ${plural(n)} with ${project.card.data.name || 'the card'}.`, 'success');
      }),
    save: () => run(() => saveAll(pickedSession.map((img) => ({ blob: () => imageBlob(img), save: () => saveSessionImage(img, true) })))),
    download: () => run(() => downloadMany(pickedSession.map((i) => ({ name: genFileName(i), blob: () => imageBlob(i) })), `${cardName}-gens-${stamp}.zip`)),
    remove: () =>
      run(async () => {
        const loose = pickedSession.filter((i) => !i.keptFile && !i.savedPath).length;
        const ok = await confirmDialog({
          title: `Remove ${plural(pickedSession.length)} from recent gens?`,
          body: loose ? `${plural(loose)} haven't been kept or saved anywhere, and will be gone.` : 'Each is kept with the card or saved to a folder, so those copies stay.',
          confirmLabel: 'Remove',
          danger: loose > 0,
        });
        if (!ok) return false;
        removeImages(pickedSession.map((i) => i.id));
      }),
  };

  const keptActions = {
    save: () => run(() => saveAll(pickedKept.map((k) => ({ blob: () => keptBlob(k), save: (b) => saveToFolder(b, keptName(k), true) })))),
    download: () => run(() => downloadMany(pickedKept.map((k) => ({ name: keptName(k), blob: () => keptBlob(k) })), `${cardName}-kept-${stamp}.zip`)),
    remove: () =>
      run(async () => {
        const ok = await confirmDialog({ title: `Stop keeping ${plural(pickedKept.length)}?`, body: "They're deleted from the project folder. Save or download them first if you want copies.", confirmLabel: 'Delete', danger: true });
        if (!ok) return false;
        for (const k of pickedKept) await useProjectStore.getState().unkeep(k.file);
        toast(`Deleted ${plural(pickedKept.length)}.`, 'success');
      }),
  };

  const selectButtons = (kind: 'kept' | 'session', all: string[]) =>
    selecting?.kind === kind ? (
      <>
        <Button size="sm" variant="ghost" onClick={() => setSelecting({ kind, ids: selecting.ids.size === all.length ? new Set() : new Set(all) })}>
          {selecting.ids.size === all.length ? 'None' : 'All'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelecting(null)}>
          Done
        </Button>
      </>
    ) : (
      all.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => start(kind)} title="Pick several to act on at once (or long-press a picture)">
          Select
        </Button>
      )
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
        <Section title={`Kept with this card (${project.kept.length})`} actions={selectButtons('kept', kept.map((k) => k.file))}>
          {project.kept.length === 0 ? (
            <Empty>Keep a gen (☆ Keep) to save it with the card: candidate avatars, expressions, outfit references.</Empty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
              {kept.map((k) => {
                const picked = selecting?.kind === 'kept' && selecting.ids.has(k.file);
                return (
                  <Pressable
                    key={k.file}
                    onTap={() => (selecting?.kind === 'kept' ? toggle(k.file) : setView({ kind: 'kept', item: k }))}
                    onLongPress={() => (selecting?.kind === 'kept' ? toggle(k.file) : start('kept', k.file))}
                    className={cx('group relative overflow-hidden rounded-md border', picked ? 'border-violet-500 ring-2 ring-violet-500' : 'border-slate-800 hover:border-violet-500')}
                    style={{ aspectRatio: `${k.width || 2} / ${k.height || 3}` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={api.keptUrl(project.id, k.file)} alt={k.label ?? ''} className={cx('h-full w-full object-cover', picked && 'opacity-80')} loading="lazy" draggable={false} />
                    {k.label && <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-[10px] text-white">{k.label}</span>}
                    {selecting?.kind === 'kept' && <Check on={picked} />}
                  </Pressable>
                );
              })}
            </div>
          )}
        </Section>

        <Section
          title={
            <>
              Recent gens ({session.length})
              {goingSoon > 0 && (
                <span className="ml-1.5 text-[11px] font-normal text-amber-300 normal-case" title={`Recent gens are deleted after ${keepDays} day${keepDays === 1 ? '' : 's'} (Settings → Folders). Keep one with the card (☆) or save it (💾) to hold on to it.`}>
                  ⏳ {goingSoon} going within a day
                </span>
              )}
            </>
          }
          actions={
            <>
              {selectButtons('session', session.map((i) => i.id))}
              {selecting?.kind !== 'session' && (
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
                        if (await confirmDialog({ title: 'Clear recent gens?', body: `${plural(images.length - pinned)} go, on every device${pinned ? `; ${pinned} kept ${pinned === 1 ? 'one stays' : 'ones stay'}` : ''}. ${unsaved ? `${unsaved} of them ${unsaved === 1 ? "hasn't" : "haven't"} been kept or saved anywhere.` : ''}`, confirmLabel: 'Clear', danger: true })) clearSession();
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </>
              )}
            </>
          }
        >
          {session.length === 0 ? (
            <Empty>No recent gens. New ones stay here for the days set in Settings → Folders (on every device), until you keep them with a card, save them or clear them.</Empty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
              {session.map((img) => (
                <SessionThumb
                  key={img.id}
                  img={img}
                  left={leftOf(img)}
                  selecting={selecting?.kind === 'session'}
                  picked={selecting?.kind === 'session' && selecting.ids.has(img.id)}
                  onOpen={() => {
                    select(img.id);
                    setDockTab('image');
                  }}
                  onToggle={() => toggle(img.id)}
                  onLongPress={() => (selecting?.kind === 'session' ? toggle(img.id) : start('session', img.id))}
                />
              ))}
            </div>
          )}
        </Section>
      </div>

      {selecting && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-t border-slate-800 bg-slate-950 px-3 py-2">
          <span className="mr-auto text-sm text-slate-300">{count === 0 ? 'Tap pictures to select them' : `${count} selected`}</span>
          {selecting.kind === 'session' ? (
            <>
              <Button size="sm" disabled={busy || !pickedSession.some((i) => !i.keptFile)} onClick={() => void sessionActions.keep()} title="Keep them with the card (saved in the project)">
                ☆ Keep
              </Button>
              <Button size="sm" disabled={busy || !count} onClick={() => void sessionActions.save()} title="Save them to the output folder">
                💾 Save to folder
              </Button>
              <Button size="sm" disabled={busy || !count} onClick={() => void sessionActions.download()} title="Download (several come as a zip)">
                ⬇ Download
              </Button>
              <Button size="sm" variant="danger" disabled={busy || !count} onClick={() => void sessionActions.remove()} title="Remove them from recent gens (on every device)">
                🗑 Remove
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={busy || !count} onClick={() => void keptActions.save()} title="Save them to the output folder">
                💾 Save to folder
              </Button>
              <Button size="sm" disabled={busy || !count} onClick={() => void keptActions.download()} title="Download (several come as a zip)">
                ⬇ Download
              </Button>
              <Button size="sm" variant="danger" disabled={busy || !count} onClick={() => void keptActions.remove()} title="Stop keeping them (deletes them from the project)">
                🗑 Delete
              </Button>
            </>
          )}
        </div>
      )}

      {view && (
        <KeptViewer
          projectId={project.id}
          item={view.item}
          onClose={() => setView(null)}
          onFullscreen={() => {
            // Swipes through the kept gens, in the grid's order; the dialog follows.
            openLightbox(kept.map((k) => api.keptUrl(project.id, k.file)), kept.findIndex((k) => k.file === view.item.file), (n) => setView({ kind: 'kept', item: kept[n] }));
          }}
        />
      )}
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span className={cx('pointer-events-none absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded-full border text-xs', on ? 'border-violet-400 bg-violet-500 text-white' : 'border-white/70 bg-black/40 text-transparent')}>
      ✓
    </span>
  );
}

/** A button that tells a tap from a long press (which starts selecting). */
function Pressable({ onTap, onLongPress, className, style, children }: { onTap: () => void; onLongPress: () => void; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);
  const origin = useRef<[number, number]>([0, 0]);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      type="button"
      // Its long press selects; no help bubble (components/TouchTips.tsx).
      data-longpress
      className={cx('select-none [-webkit-touch-callout:none]', className)}
      style={style}
      onPointerDown={(e) => {
        pressed.current = false;
        origin.current = [e.clientX, e.clientY];
        cancel();
        timer.current = setTimeout(() => {
          pressed.current = true;
          onLongPress();
        }, 500);
      }}
      // Scrolling the grid isn't a long press.
      onPointerMove={(e) => Math.hypot(e.clientX - origin.current[0], e.clientY - origin.current[1]) > 8 && cancel()}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      // The phone's own long-press menu would cover the grid.
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        // The click that ends a long press doesn't also count as a tap.
        if (pressed.current) pressed.current = false;
        else onTap();
      }}
    >
      {children}
    </button>
  );
}

function SessionThumb({ img, left, selecting, picked, onOpen, onToggle, onLongPress }: { img: SessionImage; /** Until it's deleted (null: never). */ left: number | null; selecting: boolean; picked: boolean; onOpen: () => void; onToggle: () => void; onLongPress: () => void }) {
  return (
    <div className={cx('group relative overflow-hidden rounded-md border', picked ? 'border-violet-500 ring-2 ring-violet-500' : 'border-slate-800')} style={{ aspectRatio: `${img.parameters.width} / ${img.parameters.height}` }}>
      <Pressable onTap={selecting ? onToggle : onOpen} onLongPress={onLongPress} className="h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt="" className={cx('h-full w-full object-cover', picked && 'opacity-80')} draggable={false} />
      </Pressable>
      {selecting ? (
        <Check on={picked} />
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex justify-center gap-0.5 bg-black/70 opacity-0 group-hover:opacity-100 touch:opacity-100">
          <IconButton title="Set as avatar" className="text-white" onClick={() => withImage(img, setAsAvatar)}>
            👤
          </IconButton>
          <IconButton title={img.keptFile ? 'Kept' : 'Keep with the card'} className="text-white" disabled={!!img.keptFile} onClick={() => void keepImage(img)}>
            {img.keptFile ? '★' : '☆'}
          </IconButton>
          <IconButton title={img.savedPath ?? 'Save to folder'} className="text-white" onClick={() => void saveSessionImage(img)}>
            💾
          </IconButton>
        </div>
      )}
      {left !== null && left < EXPIRY_WARNING_MS && (
        <span className="absolute top-0.5 left-0.5 rounded bg-amber-500/90 px-1 text-[9px] font-medium text-black" title={`Deleted in about ${shortTimeLeft(left)}, with the recent gens older than Settings → Folders keeps. Keep it with the card (☆) or save it (💾) to hold on to it.`}>
          ⏳ {shortTimeLeft(left)}
        </span>
      )}
      {(img.keptFile || img.savedPath) && <span className="pointer-events-none absolute top-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] text-white">{img.keptFile ? '★' : '✓'}</span>}
    </div>
  );
}

function KeptViewer({ projectId, item, onClose, onFullscreen }: { projectId: string; item: KeptImage; onClose: () => void; onFullscreen: () => void }) {
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
          <Button onClick={async () => openVisionWrite(await blob())} title="A physical description, a greeting, or ask about it (vision model)">✨ Write from image</Button>
          <ExtensionImageActions image={{ name: keptName(item), source: 'kept', blob, projectId }} />
          <Button variant="primary" onClick={async () => { await setAsAvatar(await blob()); onClose(); }}>
            Set as avatar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="checker flex flex-1 items-center justify-center rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" title="Tap for full screen" onClick={onFullscreen} className="max-h-[65vh] cursor-zoom-in object-contain" />
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
