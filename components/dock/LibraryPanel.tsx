'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfigStore, toast } from '@/store/uiStore';
import { api } from '@/lib/api';
import type { LibraryItem } from '@/lib/librarySearch';
import { newCardFromImage, setAsAvatar, reusePrompt, saveToFolder, keepLibraryImages } from '@/lib/imageActions';
import { Button, Empty, IconButton, Modal, cx, inputClass } from '@/components/ui';
import { sendToImg2Img } from '@/components/dock/ImageViewer';
import { openSettings } from '@/components/SettingsDialog';
import { useProjectStore } from '@/store/projectStore';
import { copyText } from '@/lib/clipboard';
import { openLightbox } from '@/components/Lightbox';
import { openVisionWrite } from '@/components/VisionWriteDialog';
import { ExtensionImageActions } from '@/components/ExtensionSlots';

// Older gens, from any folders set in Settings (an old gens folder, a
// downloads folder…), searchable by prompt: for
// inspiration, reusing a prompt, or picking an existing picture. With a
// card open, images can be added to its gallery (★ marks the ones already
// there; the same picture is never added twice).

const PAGE = 120;

interface Folder {
  root: number;
  path: string;
  count: number;
}

export function LibraryPanel() {
  const config = useConfigStore((s) => s.config);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const [scope, setScope] = useState<{ root: number; folder: string } | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  // What the grid currently shows, so a new search reads as loading until
  // its results arrive (without an effect setting a loading flag).
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<{ scanning: boolean; done: number; total: number } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [showFolders, setShowFolders] = useState(false);
  const [help, setHelp] = useState(false);
  const request = useRef(0);
  const projectId = useProjectStore((s) => s.project?.id);
  const keptCount = useProjectStore((s) => s.project?.kept.length ?? 0);
  // Which library images are in the open card's gallery (by content), for
  // the ★ badges; asked again whenever the gallery changes.
  const [inGallery, setInGallery] = useState<{ projectId: string; ids: Set<string> } | null>(null);
  const galleryIds = inGallery && inGallery.projectId === projectId ? inGallery.ids : null;
  const [picking, setPicking] = useState<Set<string> | null>(null);
  const [adding, setAdding] = useState(false);
  const key = JSON.stringify([query, sort, scope, config.libraryFolders]);
  const loading = busy || (config.libraryFolders.length > 0 && shownFor !== key);

  const params = useCallback((offset: number, rescan = false) => ({ q: query, sort, offset, limit: PAGE, rescan: rescan ? 1 : undefined, root: scope?.root, folder: scope?.folder }), [query, sort, scope]);

  const show = useCallback((r: Awaited<ReturnType<typeof api.library>>, append: boolean) => {
    setItems((prev) => (append ? [...prev, ...r.items] : r.items));
    setTotal(r.total);
    setFolders(
      Object.entries(r.folders)
        .map(([k, count]) => {
          const i = k.indexOf(':');
          return { root: Number(k.slice(0, i)), path: k.slice(i + 1), count };
        })
        .sort((x, y) => x.root - y.root || x.path.localeCompare(y.path)),
    );
    setError(null);
    setScan(r.scan);
  }, []);

  // A new search, sort or folder starts over from the first page.
  useEffect(() => {
    if (!config.libraryFolders.length) return;
    const id = ++request.current;
    api
      .library(params(0))
      .then((r) => id === request.current && show(r, false))
      .catch((err: Error) => id === request.current && setError(err.message))
      .finally(() => id === request.current && setShownFor(key));
  }, [params, show, key, config.libraryFolders.length]);

  useEffect(() => {
    if (!projectId || !config.libraryFolders.length) return;
    let live = true;
    api
      .libraryGensInGallery(projectId)
      .then((r) => live && setInGallery({ projectId, ids: new Set(r.ids) }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [projectId, keptCount, config.libraryFolders.length, scan?.scanning]);

  const addPicked = async () => {
    if (!picking?.size) return;
    setAdding(true);
    if (await keepLibraryImages([...picking])) setPicking(null);
    setAdding(false);
  };

  // While the server is indexing, refresh what's shown every couple of
  // seconds (as many images as are loaded now), so results fill in.
  const shownCount = useRef(0);
  useEffect(() => {
    shownCount.current = items.length;
  }, [items.length]);
  useEffect(() => {
    if (!scan?.scanning) return;
    const t = setTimeout(() => {
      const id = ++request.current;
      api
        .library({ ...params(0), limit: Math.max(PAGE, shownCount.current) })
        .then((r) => id === request.current && show(r, false))
        .catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [scan, params, show]);

  const fetchPage = async (offset: number, rescan = false) => {
    const id = ++request.current;
    try {
      const r = await api.library(params(offset, rescan));
      if (id === request.current) show(r, offset > 0);
    } catch (err) {
      if (id === request.current) setError((err as Error).message);
    }
  };

  /** More of the same search, or a rescan, from a button. */
  const load = async (offset: number, rescan = false) => {
    setBusy(true);
    await fetchPage(offset, rescan);
    setBusy(false);
  };

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  if (!config.libraryFolders.length) {
    return (
      <div className="p-4">
        <Empty>
          Point the library at folders of gens (wherever you keep them, your downloads…) to browse and search them here.
          <div className="mt-3">
            <Button variant="primary" onClick={() => openSettings('folders')}>
              Add folders
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  const rootName = (i: number) => config.libraryFolders[i]?.split(/[\\/]/).filter(Boolean).pop() ?? `Folder ${i + 1}`;

  return (
    <div className="flex h-full min-h-0">
      {showFolders && (
        <div className="w-44 flex-shrink-0 overflow-y-auto border-r border-slate-800 p-1.5 text-xs">
          <button type="button" onClick={() => setScope(null)} className={cx('block w-full truncate rounded px-2 py-1 text-left', !scope ? 'bg-violet-500/15 text-slate-100' : 'text-slate-400 hover:bg-slate-900')}>
            Everything
          </button>
          {folders.map((f) => {
            const depth = f.path ? f.path.split('/').length : 0;
            const active = scope?.root === f.root && scope.folder === f.path;
            return (
              <button
                key={`${f.root}:${f.path}`}
                type="button"
                onClick={() => setScope({ root: f.root, folder: f.path })}
                title={f.path ? `${config.libraryFolders[f.root]}\\${f.path}` : config.libraryFolders[f.root]}
                className={cx('flex w-full items-center gap-1 rounded py-1 pr-1 text-left', active ? 'bg-violet-500/15 text-slate-100' : 'text-slate-400 hover:bg-slate-900')}
                style={{ paddingLeft: 8 + depth * 10 }}
              >
                <span className="min-w-0 flex-1 truncate">{f.path ? f.path.split('/').pop() : `📁 ${rootName(f.root)}`}</span>
                <span className="text-[10px] text-slate-600">{f.count}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-slate-800 p-2">
          <IconButton title={showFolders ? 'Hide folders' : 'Show folders'} onClick={() => setShowFolders(!showFolders)}>
            ▤
          </IconButton>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="white hair, -nsfw, blonde | red hair, char:elf, model:v4.5…" className={cx(inputClass, 'py-1 text-xs')} />
          <IconButton title="Search syntax" onClick={() => setHelp(true)}>
            ?
          </IconButton>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={cx(inputClass, 'w-24 py-1 text-xs')}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
            <option value="random">Random</option>
          </select>
          <IconButton title="Rescan the folders for new, changed or removed files" onClick={() => void load(0, true)}>
            ⟳
          </IconButton>
          {projectId && (
            <IconButton title={picking ? 'Stop selecting' : "Select images to add to this card's gallery"} tone={picking ? 'accent' : 'default'} onClick={() => setPicking(picking ? null : new Set())}>
              ☑
            </IconButton>
          )}
        </div>
        {picking && projectId && (
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 bg-violet-500/10 px-2 py-1.5 text-xs text-slate-300">
            <span className="mr-auto">{picking.size ? `${picking.size} selected` : "Tap images to add to this card's gallery"}</span>
            <Button size="sm" variant="ghost" onClick={() => setPicking(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={adding || !picking.size} onClick={() => void addPicked()}>
              {adding ? 'Adding…' : '☆ Add to gallery'}
            </Button>
          </div>
        )}
        <div className="flex-shrink-0 px-2 py-1 text-[11px] text-slate-500">{scan?.scanning
            ? `${total.toLocaleString()} images so far · indexing ${scan.done.toLocaleString()} of ${scan.total.toLocaleString()} new or changed files…`
            : loading && !items.length
              ? 'Loading…'
              : `${total.toLocaleString()} images`}</div>
        {error && <div className="mx-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1.5">
            {items.map((item, i) => {
              const picked = !!picking?.has(item.id);
              const kept = !!galleryIds?.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (!picking) return setOpen(i);
                    const next = new Set(picking);
                    if (picked) next.delete(item.id);
                    else next.add(item.id);
                    setPicking(next);
                  }}
                  className={cx('relative overflow-hidden rounded border bg-slate-900', picked ? 'border-violet-500 ring-2 ring-violet-500' : 'border-slate-800 hover:border-violet-500')}
                  style={{ aspectRatio: `${item.width || 2} / ${item.height || 3}` }}
                  title={item.info.prompt?.slice(0, 300) ?? item.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={api.libraryThumb(item.id)} alt="" className={cx('h-full w-full object-cover', picked && 'opacity-80')} loading="lazy" />
                  {kept && (
                    <span className="pointer-events-none absolute top-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] text-amber-300" title="In this card's gallery">
                      ★
                    </span>
                  )}
                  {picked && <span className="pointer-events-none absolute top-0.5 left-0.5 rounded bg-violet-500 px-1 text-[9px] text-white">✓</span>}
                </button>
              );
            })}
          </div>
          {items.length < total && (
            <div className="py-3 text-center">
              <Button size="sm" disabled={loading} onClick={() => void load(items.length)}>
                {loading ? 'Loading…' : `Load more (${total - items.length} left)`}
              </Button>
            </div>
          )}
        </div>
      </div>
      {open !== null && items[open] && <LibraryViewer item={items[open]} inGallery={!!galleryIds?.has(items[open].id)} onFullscreen={() => openLightbox(items.map((it) => api.libraryFile(it.id)), open, setOpen)} onClose={() => setOpen(null)} onStep={(d) => setOpen((o) => (o === null ? o : Math.max(0, Math.min(items.length - 1, o + d))))} onSearch={(t) => setQ(t)} />}
      {help && <SearchHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

function LibraryViewer({ item, inGallery, onClose, onStep, onSearch, onFullscreen }: { item: LibraryItem; inGallery: boolean; onClose: () => void; onStep: (d: number) => void; onSearch: (text: string) => void; onFullscreen: () => void }) {
  const hasProject = useProjectStore((s) => !!s.project);
  const blob = async () => (await fetch(api.libraryFile(item.id))).blob();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'ArrowLeft') onStep(-1);
      if (e.key === 'ArrowRight') onStep(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStep]);
  const tags = useMemo(() => (item.info.prompt ?? '').split(',').map((t) => t.trim()).filter(Boolean), [item]);
  const copy = (text: string) => copyText(text).then(() => toast('Copied.', 'success'));
  return (
    <Modal
      open
      onClose={onClose}
      title={item.name}
      size="xl"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => onStep(-1)}>
            ← Prev
          </Button>
          <Button variant="ghost" onClick={() => onStep(1)}>
            Next →
          </Button>
          {hasProject && item.info.source && (
            <>
              <Button onClick={async () => { await reusePrompt(await blob()); onClose(); }}>Reuse prompt</Button>
              <Button onClick={async () => { await reusePrompt(await blob(), { settings: true }); onClose(); }}>Reuse all</Button>
            </>
          )}
          {hasProject && <Button onClick={async () => { sendToImg2Img(await blob()); onClose(); }}>Img2Img base</Button>}
          {hasProject && <Button onClick={async () => openVisionWrite(await blob())} title="A physical description, a greeting, or ask about it (vision model)">✨ Write from image</Button>}
          {hasProject && (
            <Button disabled={inGallery} onClick={() => void keepLibraryImages([item.id])} title={inGallery ? "Already in this card's gallery" : "Keep it with the card (a copy is saved in the project, shown in Gallery)"}>
              {inGallery ? '★ In gallery' : '☆ Add to gallery'}
            </Button>
          )}
          <ExtensionImageActions image={{ name: item.name, source: 'library', blob, projectId: useProjectStore.getState().project?.id }} />
          <Button onClick={async () => void saveToFolder(await blob(), item.name)}>Copy to output</Button>
          {hasProject ? (
            <Button variant="primary" onClick={async () => { await setAsAvatar(await blob()); onClose(); }}>
              Set as avatar
            </Button>
          ) : (
            <Button variant="primary" title="A new card with this as its picture, and its prompt in the art settings" onClick={async () => { const b = await blob(); onClose(); await newCardFromImage(b); }}>
              New card from this image
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="checker flex flex-1 items-center justify-center rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={api.libraryFile(item.id)} alt="" title="Tap for full screen" onClick={onFullscreen} className="max-h-[65vh] cursor-zoom-in object-contain" />
        </div>
        <div className="flex w-full flex-col gap-2 overflow-y-auto md:max-h-[65vh] md:w-80">
          <div className="text-xs text-slate-500">
            {item.width}×{item.height} · {item.info.model ?? 'no metadata'}
            {item.info.seed !== undefined && ` · seed ${item.info.seed}`}
            <br />
            {item.folder || '(top folder)'} · {new Date(item.mtime).toLocaleString()}
          </div>
          {tags.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                Prompt
                <button type="button" className="text-violet-300 hover:underline" onClick={() => void copy(item.info.prompt ?? '')}>
                  copy
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {tags.map((t, i) => (
                  <button key={i} type="button" onClick={() => { onSearch(t); onClose(); }} title="Search for this" className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-violet-500/20">
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {item.info.characters?.map((c, i) => (
            <div key={i}>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                Character {i + 1}
                <button type="button" className="text-violet-300 hover:underline" onClick={() => void copy(c.prompt)}>
                  copy
                </button>
              </div>
              <div className="rounded bg-slate-950 p-2 font-mono text-[11px] text-slate-300">{c.prompt}</div>
            </div>
          ))}
          {item.info.negative && (
            <div>
              <div className="mb-1 text-xs text-slate-400">Negative</div>
              <div className="rounded bg-slate-950 p-2 font-mono text-[11px] text-slate-500">{item.info.negative}</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SearchHelp({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['white hair', 'prompt or a character prompt contains it'],
    ['white hair, smile', 'both (every term must match)'],
    ['-nsfw', 'leave these out'],
    ['blonde hair | red hair', 'either one'],
    ['char:elf', 'only in character prompts'],
    ['neg:blurry', 'in the negative prompts'],
    ['chars:2, chars:2+, chars:1-3, chars:<=1', 'number of character prompts (V4+)'],
    ['model:v4.5, -model:v3', 'model by short code, or part of its name'],
    ['seed:123456', 'exact seed'],
    ['file:…, folder:…, sampler:…, type:img2img', 'field contains'],
  ];
  return (
    <Modal open onClose={onClose} title="Library search" size="md">
      <p className="mb-3 text-sm text-slate-400">Comma separated, like a prompt. Images without the field (stray gens with no metadata) count as not matching, so a negated term keeps them.</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-t border-slate-800">
              <td className="py-1.5 pr-3 font-mono text-xs text-violet-300">{a}</td>
              <td className="py-1.5 text-slate-400">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
