'use client';

import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore, useConfigStore, useToastStore, toast } from '@/store/uiStore';
import { useSessionStore } from '@/store/sessionStore';
import { api } from '@/lib/api';
import { exportCharx, exportJson, exportPng, importAsProject } from '@/lib/cardExport';
import { importCardFile, CardImportError } from '@/lib/cardFile';
import { Button, ConfirmHost, IconButton, confirmDialog, cx, inputClass, pickFiles } from '@/components/ui';
import { SettingsDialog, openSettings } from '@/components/SettingsDialog';
import { FieldToolsHost } from '@/components/editor/fieldTools';
import { CardEditor } from '@/components/editor/CardEditor';
import { Dock } from '@/components/dock/Dock';

export function Shell() {
  const project = useProjectStore((s) => s.project);
  const loading = useProjectStore((s) => s.loading);
  const { sidebarOpen, dockWidth, setDockWidth } = useUiStore();
  const workspace = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // layout.tsx applies the saved theme before paint; hydration can drop
    // the attribute again, so it's set from the store once more here.
    document.documentElement.dataset.theme = useUiStore.getState().theme;
    void useConfigStore.getState().load();
    const store = useProjectStore.getState();
    void store.refreshList().then(() => {
      let last: string | null = null;
      try {
        last = localStorage.getItem('uccb-last-project');
      } catch {
        /* private mode */
      }
      if (last && useProjectStore.getState().summaries.some((s) => s.id === last)) void store.open(last);
    });
  }, []);

  // Card-level undo/redo when focus isn't in a text box (which has its own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        useProjectStore.getState().undo();
      } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        useProjectStore.getState().redo();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void useProjectStore.getState().flush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dropping a card file anywhere imports it.
  const [dropping, setDropping] = useState(false);
  const onDrop = async (e: React.DragEvent) => {
    setDropping(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    const { create, setAvatar } = useProjectStore.getState();
    try {
      const imported = await importAsProject(file, create, setAvatar);
      toast(`Imported ${imported.card.data.name || 'the card'}.`, 'success');
    } catch (err) {
      toast(err instanceof CardImportError ? err.message : `Couldn't import: ${(err as Error).message}`, 'error');
    }
  };

  const startResize = (e: React.PointerEvent) => {
    const el = workspace.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => setDockWidth(1 - (ev.clientX - rect.left) / rect.width);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      onDragOver={(e) => {
        // Image drops onto specific targets (avatar, img2img) handle themselves.
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <Header />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <ProjectSidebar />}
        <div ref={workspace} className="flex min-w-0 flex-1">
          {project ? (
            <>
              <main className="min-w-0 border-r border-slate-800" style={{ width: `${(1 - dockWidth) * 100}%` }}>
                <CardEditor />
              </main>
              <div onPointerDown={startResize} className="w-1 flex-shrink-0 cursor-col-resize bg-slate-900 hover:bg-violet-500/50" title="Drag to resize" />
              <aside className="min-w-0 flex-1">
                <Dock />
              </aside>
            </>
          ) : (
            <Welcome loading={loading} />
          )}
        </div>
      </div>
      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-4 border-dashed border-violet-500/60 bg-violet-950/30 text-lg text-violet-200">
          Drop a card (PNG, JSON, CHARX) to import it as a new card
        </div>
      )}
      <SettingsDialog />
      <FieldToolsHost />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}

function SaveStatus() {
  const status = useProjectStore((s) => s.status);
  const error = useProjectStore((s) => s.error);
  const label = { saved: 'Saved', dirty: 'Unsaved', saving: 'Saving…', error: 'Save failed' }[status];
  return (
    <span className={cx('text-xs', status === 'error' ? 'text-red-400' : status === 'saved' ? 'text-slate-500' : 'text-amber-300')} title={error ?? 'Saved to data/projects on this machine'}>
      {label}
    </span>
  );
}

function Header() {
  const project = useProjectStore((s) => s.project);
  const { past, future, undo, redo, replaceCard } = useProjectStore();
  const { sidebarOpen, setSidebarOpen, theme, setTheme, showAvatar, setShowAvatar, exportKeepsMetadata, exportMaxSize, exportCompression } = useUiStore();
  const imageOpts = { keepMetadata: exportKeepsMetadata, maxSize: exportMaxSize, compression: exportCompression };
  const apiKey = useSessionStore((s) => s.apiKey);
  const [exportOpen, setExportOpen] = useState(false);

  const overwrite = async () => {
    const [file] = await pickFiles('.json,.png,.charx');
    if (!file || !project) return;
    try {
      const { card } = await importCardFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!(await confirmDialog({ title: `Overwrite "${project.card.data.name || 'this card'}" with ${file.name}?`, body: 'The text is replaced; the picture, gens and chats stay. Undo brings the old text back.', confirmLabel: 'Overwrite' }))) return;
      replaceCard(card);
      toast('Card text replaced.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <header className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-950 px-2">
      <IconButton title={sidebarOpen ? 'Hide the card list' : 'Show the card list'} onClick={() => setSidebarOpen(!sidebarOpen)}>
        ☰
      </IconButton>
      <span className="text-sm font-semibold tracking-tight text-violet-300">UCCB</span>
      {project && (
        <>
          <span className="text-slate-700">/</span>
          <span className="max-w-64 truncate text-sm text-slate-200">{project.card.data.name || 'Unnamed character'}</span>
          <SaveStatus />
          <div className="ml-2 flex items-center">
            <IconButton title="Undo (Ctrl+Z outside a text box)" disabled={!past.length} onClick={undo}>
              ↶
            </IconButton>
            <IconButton title="Redo (Ctrl+Y)" disabled={!future.length} onClick={redo}>
              ↷
            </IconButton>
          </div>
        </>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {!apiKey && (
          <button type="button" onClick={() => openSettings('general')} className="rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300">
            Add your NovelAI key
          </button>
        )}
        {project && (
          <>
            <IconButton title={showAvatar ? 'Hide the avatar strip' : 'Show the avatar strip'} onClick={() => setShowAvatar(!showAvatar)}>
              {showAvatar ? '▣' : '□'}
            </IconButton>
            <Button size="sm" variant="ghost" onClick={() => void overwrite()} title="Replace this card's text with a card or JSON file, keeping the picture">
              Overwrite…
            </Button>
            <div className="relative">
              <Button size="sm" variant="primary" onClick={() => setExportOpen(!exportOpen)}>
                Export ▾
              </Button>
              {exportOpen && (
                <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl" onMouseLeave={() => setExportOpen(false)}>
                  {[
                    { label: 'PNG card (V3 + V2)', run: async () => toast(`Exported the PNG card (${await exportPng(project, imageOpts)}).`, 'success') },
                    { label: 'JSON (V3)', run: async () => exportJson(project) },
                    { label: 'CHARX', run: () => exportCharx(project, imageOpts) },
                  ].map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      className="block w-full rounded px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                      onClick={async () => {
                        setExportOpen(false);
                        await useProjectStore.getState().flush();
                        await o.run().catch((err: Error) => toast(err.message, 'error'));
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <IconButton title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀' : '☾'}
        </IconButton>
        <IconButton title="Settings" onClick={() => openSettings()}>
          ⚙
        </IconButton>
      </div>
    </header>
  );
}

function ProjectSidebar() {
  const { summaries, project, open, create, remove, setAvatar } = useProjectStore();
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const shown = summaries.filter((s) => !q || s.name.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q)));
  const importFile = async () => {
    const [file] = await pickFiles('.png,.json,.charx');
    if (!file) return;
    try {
      const imported = await importAsProject(file, create, setAvatar);
      toast(`Imported ${imported.card.data.name || 'the card'}${imported.source === 'chara' ? ' (V2 card)' : ''}.`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <nav className="flex w-60 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-950">
      <div className="flex gap-1.5 p-2">
        <Button size="sm" variant="primary" className="flex-1" onClick={() => void create()}>
          + New card
        </Button>
        <Button size="sm" onClick={() => void importFile()} title="Import a PNG, JSON or CHARX card (or drop one anywhere)">
          Import
        </Button>
      </div>
      {summaries.length > 6 && (
        <div className="px-2 pb-2">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search cards…" className={cx(inputClass, 'py-1 text-xs')} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {shown.map((s) => {
          const url = api.avatarUrl(s.id, s.avatar);
          return (
            <div key={s.id} className={cx('group flex items-center gap-2 rounded-md px-1.5 py-1.5', project?.id === s.id ? 'bg-violet-500/15' : 'hover:bg-slate-900')}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void open(s.id)}>
                <span className="h-10 w-7 flex-shrink-0 overflow-hidden rounded bg-slate-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url && <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-200">{s.name || <em className="text-slate-500">Unnamed</em>}</span>
                  <span className="block truncate text-[10px] text-slate-500">{new Date(s.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                </span>
              </button>
              <IconButton
                title="Delete card"
                tone="danger"
                className="opacity-0 group-hover:opacity-100"
                onClick={async () => {
                  if (await confirmDialog({ title: `Delete "${s.name || 'Unnamed'}"?`, body: 'The project (card, gens kept with it, chats) moves to data/trash, where you can recover it by hand.', confirmLabel: 'Delete', danger: true })) {
                    await remove(s.id);
                  }
                }}
              >
                🗑
              </IconButton>
            </div>
          );
        })}
        {summaries.length === 0 && <p className="px-2 py-4 text-xs text-slate-500">No cards yet. Make a new one, or drop a card file anywhere.</p>}
      </div>
    </nav>
  );
}

function Welcome({ loading }: { loading: boolean }) {
  const create = useProjectStore((s) => s.create);
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      {loading ? (
        <span className="text-slate-500">Opening…</span>
      ) : (
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-slate-100">Ultimate Character Card Builder</h1>
          <p className="mt-2 text-sm text-slate-400">Write the card, draw it with NovelAI, and chat with it to test, all side by side.</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="primary" onClick={() => void create()}>
              Start a new card
            </Button>
            <Button onClick={() => openSettings()}>Settings</Button>
          </div>
          <p className="mt-4 text-xs text-slate-500">Or drop a PNG, JSON or CHARX card anywhere to import it.</p>
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg',
            t.tone === 'error' ? 'border-red-500/40 bg-red-950 text-red-200' : t.tone === 'success' ? 'border-emerald-500/40 bg-emerald-950 text-emerald-200' : 'border-slate-700 bg-slate-900 text-slate-200',
          )}
        >
          <span className="flex-1">{t.text}</span>
          {t.action && (
            <button type="button" className="font-medium underline" onClick={() => (t.action!.run(), dismiss(t.id))}>
              {t.action.label}
            </button>
          )}
          <button type="button" className="opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
