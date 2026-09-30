'use client';

import { useEffect, useRef, useState } from 'react';
import { lastCardKey, useProjectStore } from '@/store/projectStore';
import { useUiStore, useConfigStore, useToastStore, toast } from '@/store/uiStore';
import { useSessionStore } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePersonaStore } from '@/store/personaStore';
import { api } from '@/lib/api';
import { exportCharx, exportJson, exportPng} from '@/lib/cardExport';
import { importCardFile } from '@/lib/cardFile';
import { Button, ConfirmHost, IconButton, confirmDialog, cx, inputClass, pickFiles } from '@/components/ui';
import { SettingsDialog, openSettings } from '@/components/SettingsDialog';
import { FieldToolsHost } from '@/components/editor/fieldTools';
import { CardEditor } from '@/components/editor/CardEditor';
import { Dock } from '@/components/dock/Dock';
import { Lightbox } from '@/components/Lightbox';
import { TouchTips } from '@/components/TouchTips';
import { AssistInspectorHost } from '@/components/llm/AssistTrace';
import { LibraryPanel } from '@/components/dock/LibraryPanel';
import { Tabs } from '@/components/ui';
import { useMediaQuery, PHONE_QUERY } from '@/hooks/useMediaQuery';
import { useKeyboard, watchKeyboard } from '@/hooks/useKeyboard';
import { useSessionStore as useGenSession } from '@/store/sessionStore';
import { VisionWriteHost } from '@/components/VisionWriteDialog';
import { ExtensionHosts } from '@/components/ExtensionSlots';
import { ChatCardActions, ChatCardList, ChatHeaderAvatar, ChatHome, ChatScreen, switchAppMode } from '@/components/chatmode/ChatMode';
import { CardListMeta } from '@/components/CardListMeta';
import { importFromUrl } from '@/components/ImportUrl';
import { importCards } from '@/components/ImportCards';

export function Shell() {
  const project = useProjectStore((s) => s.project);
  const loading = useProjectStore((s) => s.loading);
  const { sidebarOpen, setSidebarOpen, dockWidth, setDockWidth, phoneView } = useUiStore();
  const fullPane = useUiStore((s) => s.fullPane);
  const chatMode = useUiStore((s) => s.appMode === 'chat');
  const workspace = useRef<HTMLDivElement>(null);
  // Phones get one screen at a time with a bottom bar, and the card list
  // as a drawer.
  const phone = useMediaQuery(PHONE_QUERY);
  const [drawer, setDrawer] = useState(false);
  const keyboard = useKeyboard((s) => s.open);

  useEffect(() => {
    // layout.tsx applies the saved theme before paint; hydration can drop
    // the attribute again, so it's set from the store once more here.
    document.documentElement.dataset.theme = useUiStore.getState().theme;
    watchKeyboard();
    void useConfigStore.getState().load();
    void usePersonaStore.getState().load();
    const store = useProjectStore.getState();
    void store.refreshList().then(() => {
      // The card this mode had open last time (a Chat-mode card only in Chat).
      const chat = useUiStore.getState().appMode === 'chat';
      let last: string | null = null;
      try {
        last = localStorage.getItem(lastCardKey());
      } catch {
        /* private mode */
      }
      if (last && useProjectStore.getState().summaries.some((s) => s.id === last && (chat || !s.chatOnly))) void store.open(last);
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

  // Dropping card files anywhere imports them (Chat-mode cards in Chat mode).
  const [dropping, setDropping] = useState(false);
  const onDrop = async (e: React.DragEvent) => {
    setDropping(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    e.preventDefault();
    await importCards(useUiStore.getState().appMode === 'chat' ? { chatOnly: true } : {}, files);
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
      className="flex h-[100dvh] flex-col overflow-hidden"
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
      {/* Typing on a phone, the header and bottom bar make way for the text. */}
      {!(phone && keyboard) && <Header phone={phone} onMenu={() => (phone ? setDrawer(true) : setSidebarOpen(!sidebarOpen))} />}
      <div className="flex min-h-0 flex-1">
        {chatMode ? (
          <>
            {!phone && sidebarOpen && <ChatCardList />}
            <div className="flex min-w-0 flex-1">{project ? <ChatScreen phone={phone} /> : <ChatHome loading={loading} />}</div>
          </>
        ) : (
          <>
            {!phone && sidebarOpen && !(fullPane && project) && <ProjectSidebar />}
            <div ref={workspace} className="flex min-w-0 flex-1">
              {project && phone ? (
                // Both stay mounted, so a generation or a reply carries on
                // while the other screen is showing.
                <>
                  <main className="min-w-0 flex-1" hidden={phoneView !== 'card'}>
                    <CardEditor />
                  </main>
                  <aside className="min-w-0 flex-1" hidden={phoneView !== 'dock'}>
                    <Dock phone />
                  </aside>
                </>
              ) : project ? (
                <>
                  {/* One side can fill the window; the other stays mounted
                      (hidden), so it comes back as it was and a gen or a reply
                      carries on. */}
                  <main className={cx('min-w-0 border-slate-800', fullPane === 'card' ? 'flex-1' : 'border-r')} style={fullPane === 'card' ? undefined : { width: `${(1 - dockWidth) * 100}%` }} hidden={fullPane === 'dock'}>
                    <CardEditor />
                  </main>
                  {!fullPane && <div onPointerDown={startResize} className="w-1 flex-shrink-0 cursor-col-resize bg-slate-900 hover:bg-violet-500/50" title="Drag to resize" />}
                  <aside className="min-w-0 flex-1" hidden={fullPane === 'card'}>
                    <Dock />
                  </aside>
                </>
              ) : (
                <Home loading={loading} />
              )}
            </div>
          </>
        )}
      </div>
      {phone && project && !keyboard && !chatMode && <PhoneNav />}
      {phone && drawer && <PhoneDrawer onClose={() => setDrawer(false)} />}
      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-4 border-dashed border-violet-500/60 bg-violet-950/30 text-lg text-violet-200">
          {chatMode ? 'Drop a card (PNG, JSON, CHARX) to import it for chatting' : 'Drop a card (PNG, JSON, CHARX) to import it as a new card'}
        </div>
      )}
      <SettingsDialog />
      <FieldToolsHost />
      <ConfirmHost />
      <VisionWriteHost />
      <ExtensionHosts />
      <AssistInspectorHost />
      <Lightbox />
      <TouchTips />
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

function Header({ phone, onMenu }: { phone: boolean; onMenu: () => void }) {
  const project = useProjectStore((s) => s.project);
  const { past, future, undo, redo, replaceCard } = useProjectStore();
  const { sidebarOpen, theme, setTheme, showAvatar, setShowAvatar, exportKeepsMetadata, exportMaxSize, exportCompression } = useUiStore();
  const imageOpts = { keepMetadata: exportKeepsMetadata, maxSize: exportMaxSize, compression: exportCompression };
  const apiKey = useSessionStore((s) => s.apiKey);
  const imageSetUp = useSettingsStore((s) => s.imageConnections.length > 0);
  const needsNaiKey = useSettingsStore((s) => s.imageConnections.some((c) => c.kind === 'novelai')) && !apiKey;
  const [exportOpen, setExportOpen] = useState(false);
  const appMode = useUiStore((s) => s.appMode);
  const chatMode = appMode === 'chat';

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
      <IconButton title={phone ? 'Cards' : sidebarOpen ? 'Hide the card list' : 'Show the card list'} onClick={onMenu}>
        ☰
      </IconButton>
      {project && (
        <IconButton title="Close this card (back to the home screen)" onClick={() => void useProjectStore.getState().close()}>
          ⌂
        </IconButton>
      )}
      {!(phone && project) && <span className="text-sm font-semibold tracking-tight text-violet-300">UCCB</span>}
      {/* On a phone, it's at the top of the ☰ drawer instead. */}
      {!phone && <ModeSwitch />}
      {project && (
        <>
          {!phone && <span className="text-slate-700">/</span>}
          {/* Chat mode has no card bar of its own: the picture is here. */}
          {chatMode && <ChatHeaderAvatar />}
          <span className={cx('max-w-64 min-w-0 truncate text-sm text-slate-200', chatMode ? 'phone:max-w-[44vw]' : 'phone:max-w-[34vw]')}>{project.card.data.name || 'Unnamed character'}</span>
          {/* A phone's chat keeps the header to the card and its buttons. */}
          {!(phone && chatMode) && (
            <>
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
        </>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {/* A nudge while images can't be made: no connection yet, or a
            NovelAI one without its key. */}
        {!imageSetUp ? (
          <button type="button" onClick={() => openSettings('image')} className="rounded bg-amber-500/15 px-2 py-1 text-xs whitespace-nowrap text-amber-300">
            {phone ? 'Images' : 'Set up image generation'}
          </button>
        ) : (
          needsNaiKey && (
            <button type="button" onClick={() => openSettings('general')} className="rounded bg-amber-500/15 px-2 py-1 text-xs whitespace-nowrap text-amber-300">
              {phone ? 'NAI key' : 'Add your NovelAI key'}
            </button>
          )
        )}
        {project && (
          <>
            {!phone && !chatMode && (
              <>
                <IconButton title={showAvatar ? 'Hide the avatar strip' : 'Show the avatar strip'} onClick={() => setShowAvatar(!showAvatar)}>
                  {showAvatar ? '▣' : '□'}
                </IconButton>
                <Button size="sm" variant="ghost" onClick={() => void overwrite()} title="Replace this card's text with a card or JSON file, keeping the picture">
                  Overwrite…
                </Button>
              </>
            )}
            {chatMode && <ChatCardActions phone={phone} />}
            <div className="relative">
              <Button size="sm" variant={chatMode ? 'secondary' : 'primary'} onClick={() => setExportOpen(!exportOpen)} title="Export the card (PNG, JSON or CHARX)">
                {phone && chatMode ? '⬇' : 'Export ▾'}
              </Button>
              {exportOpen && (
                <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl" onMouseLeave={() => setExportOpen(false)}>
                  {[
                    { label: 'PNG card (V3 + V2)', run: async () => toast(`Exported the PNG card (${await exportPng(project, imageOpts)}).`, 'success') },
                    { label: 'JSON (V3)', run: async () => exportJson(project) },
                    { label: 'CHARX', run: () => exportCharx(project, imageOpts) },
                    // The header has no room for it on a phone.
                    ...(phone && !chatMode ? [{ label: 'Overwrite from a file…', run: overwrite }] : []),
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
        {!phone && (
          <IconButton title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '☀' : '☾'}
          </IconButton>
        )}
        <IconButton title="Settings" onClick={() => openSettings()}>
          ⚙
        </IconButton>
      </div>
    </header>
  );
}

/** Builder or Chat: the same cards, for writing them or for chatting. */
function ModeSwitch({ className }: { className?: string }) {
  const appMode = useUiStore((s) => s.appMode);
  const modes = [
    { mode: 'builder' as const, icon: '🛠', label: 'Builder', title: 'Builder: write, draw and test cards' },
    { mode: 'chat' as const, icon: '💬', label: 'Chat', title: 'Chat: chat with your cards, the building tools out of the way' },
  ];
  return (
    <div className={cx('flex flex-shrink-0 overflow-hidden rounded-md border border-slate-700 text-xs', className)} role="tablist" aria-label="Mode">
      {modes.map((m) => (
        <button
          key={m.mode}
          type="button"
          role="tab"
          aria-selected={appMode === m.mode}
          title={m.title}
          onClick={() => void switchAppMode(m.mode)}
          className={cx('flex-1 px-2 py-0.5 whitespace-nowrap', appMode === m.mode ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-slate-800')}
        >
          {m.icon} {m.label}
        </button>
      ))}
    </div>
  );
}

function ProjectSidebar({ onPicked, className }: { onPicked?: () => void; className?: string }) {
  const { summaries: all, project, open: openProject, create: createProject, remove } = useProjectStore();
  // Cards imported in Chat mode stay there until they're added to Builder.
  const summaries = all.filter((s) => !s.chatOnly);
  // In the phone's drawer, picking a card closes it.
  const open = async (id: string) => {
    await openProject(id);
    onPicked?.();
  };
  const create = async (init?: Parameters<typeof createProject>[0]) => {
    const p = await createProject(init);
    onPicked?.();
    return p;
  };
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const shown = summaries.filter((s) => !q || s.name.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q)));
  const importFile = async () => {
    if (await importCards()) onPicked?.();
  };
  return (
    <nav className={cx('flex h-full w-60 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-950', className)}>
      {onPicked && project && (
        <button
          type="button"
          className="mx-2 mt-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-900"
          onClick={async () => {
            await useProjectStore.getState().close();
            onPicked();
          }}
        >
          ⌂ Home
        </button>
      )}
      <div className="flex gap-1.5 p-2">
        <Button size="sm" variant="primary" className="flex-1" onClick={() => void create()}>
          + New card
        </Button>
        <Button size="sm" onClick={() => void importFile()} title="Import a PNG, JSON or CHARX card (or drop one anywhere)">
          Import
        </Button>
        <Button size="sm" onClick={() => void importFromUrl().then(() => onPicked?.())} title="Import from a URL (a Chub or Cardbox character link)" aria-label="Import from a URL">
          🔗
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
                  <CardListMeta summary={s} />
                  <span className="block truncate text-[10px] text-slate-500">{new Date(s.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                </span>
              </button>
              <IconButton
                title="Delete card"
                tone="danger"
                className="opacity-0 group-hover:opacity-100 touch:opacity-100"
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

/** No card open: your cards, and the gen library. */
function Home({ loading }: { loading: boolean }) {
  const { homeTab, setHomeTab } = useUiStore();
  if (loading) return <div className="flex flex-1 items-center justify-center text-slate-500">Opening…</div>;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Tabs
        value={homeTab}
        onChange={setHomeTab}
        className="flex-shrink-0 px-2"
        tabs={[
          { value: 'cards', label: '🗂 Cards' },
          { value: 'library', label: '📚 Gen library' },
        ]}
      />
      <div className="min-h-0 flex-1">{homeTab === 'library' ? <LibraryPanel /> : <CardsHome />}</div>
    </div>
  );
}

function CardsHome() {
  const { summaries: all, open, create } = useProjectStore();
  const summaries = all.filter((s) => !s.chatOnly);
  const setHomeTab = useUiStore((s) => s.setHomeTab);
  const importFile = () => importCards();
  return (
    <div className="h-full overflow-y-auto p-4 phone:p-3">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Ultimate Character Card Builder</h1>
          <p className="mt-1 text-sm text-slate-400">Write the card, draw it with NovelAI, A1111 or ComfyUI, and chat with it to test, all side by side.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void create()}>
            + New card
          </Button>
          <Button onClick={() => void importFile()}>Import a card…</Button>
          <Button onClick={() => void importFromUrl()} title="A Chub or Cardbox character link">
            🔗 Import from a URL…
          </Button>
          <Button onClick={() => setHomeTab('library')}>📚 Browse the gen library</Button>
          <Button variant="ghost" onClick={() => void switchAppMode('chat')} title="Chat with your cards, the building tools out of the way">
            💬 Switch to Chat
          </Button>
          <Button variant="ghost" onClick={() => openSettings()}>
            Settings
          </Button>
        </div>
        {summaries.length === 0 ? (
          <p className="text-sm text-slate-500">No cards yet. Start one, import one, or drop a PNG, JSON or CHARX card anywhere. You can also start one from a picture in the gen library.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 phone:grid-cols-[repeat(auto-fill,minmax(104px,1fr))] phone:gap-2">
            {summaries.map((s) => {
              const url = api.avatarUrl(s.id, s.avatar);
              return (
                <button key={s.id} type="button" onClick={() => void open(s.id)} className="group flex flex-col overflow-hidden rounded-md border border-slate-800 bg-slate-900 text-left hover:border-violet-500">
                  <div className="checker aspect-[2/3] w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {url ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center text-3xl text-slate-600">{(s.name.trim()[0] ?? '?').toUpperCase()}</div>}
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="truncate text-sm text-slate-200">{s.name || <em className="text-slate-500">Unnamed</em>}</div>
                    <CardListMeta summary={s} />
                    <div className="truncate text-[10px] text-slate-500">{new Date(s.updatedAt).toLocaleDateString()}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** The card list on a phone: slides over from the left, and swipes back. */
function PhoneDrawer({ onClose }: { onClose: () => void }) {
  const chatMode = useUiStore((s) => s.appMode === 'chat');
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; t: number; horizontal: boolean | null } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, t: Date.now(), horizontal: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    const t = e.touches[0];
    const x = t.clientX - s.x;
    const y = t.clientY - s.y;
    // Decide once whether this is a swipe or the list scrolling.
    if (s.horizontal === null && Math.hypot(x, y) > 8) s.horizontal = Math.abs(x) > Math.abs(y);
    if (s.horizontal) setDx(Math.min(0, x));
  };
  const onTouchEnd = () => {
    const s = start.current;
    start.current = null;
    // Far enough, or a quick flick.
    if (s?.horizontal && (dx < -80 || (dx < -30 && Date.now() - s.t < 250))) onClose();
    else setDx(0);
  };
  return (
    <div className="fixed inset-0 z-40 flex" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div className={cx('flex h-full w-72 max-w-[85vw] flex-col bg-slate-950 pt-[env(safe-area-inset-top)] shadow-2xl', dx === 0 && 'transition-transform duration-150')} style={{ transform: `translateX(${dx}px)` }}>
        <ModeSwitch className="mx-2 mt-2 text-sm [&>button]:py-1.5" />
        <div className="min-h-0 flex-1">{chatMode ? <ChatCardList onPicked={onClose} className="w-full" /> : <ProjectSidebar onPicked={onClose} className="w-full" />}</div>
      </div>
      <button type="button" aria-label="Close the card list" className="flex-1 bg-black/50" style={{ opacity: Math.max(0, 1 + dx / 288) }} onClick={onClose} />
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2 phone:inset-x-3 phone:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] phone:w-auto">
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

/** The phone's bottom bar: the card, and each dock tab. */
function PhoneNav() {
  const { phoneView, setPhoneView, dockTab, setDockTab } = useUiStore();
  const generating = useGenSession((s) => s.generating);
  const items: { key: string; icon: string; label: string; active: boolean; go: () => void }[] = [
    { key: 'card', icon: '📝', label: 'Card', active: phoneView === 'card', go: () => setPhoneView('card') },
    ...(
      [
        ['image', '🎨', 'Image'],
        ['gallery', '🖼', 'Gallery'],
        ['library', '📚', 'Library'],
        ['chat', '💬', 'Chat'],
        ['assist', '✨', 'Ideas'],
      ] as const
    ).map(([tab, icon, label]) => ({ key: tab, icon, label, active: phoneView === 'dock' && dockTab === tab, go: () => setDockTab(tab) })),
  ];
  return (
    <nav className="flex flex-shrink-0 border-t border-slate-800 bg-slate-950 pb-[env(safe-area-inset-bottom)]">
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          onClick={i.go}
          className={cx('relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px]', i.active ? 'text-violet-300' : 'text-slate-500')}
        >
          <span className="text-lg leading-none">{i.icon}</span>
          {i.label}
          {i.key === 'image' && generating > 0 && <span className="absolute top-1 right-[30%] h-2 w-2 animate-pulse rounded-full bg-violet-400" />}
        </button>
      ))}
    </nav>
  );
}
