'use client';

import { useState } from 'react';
import { lastCardKey, useProjectStore } from '@/store/projectStore';
import { toast, useUiStore, type AppMode } from '@/store/uiStore';
import { api } from '@/lib/api';
import { importAsProject } from '@/lib/cardExport';
import { Button, IconButton, Tabs, confirmDialog, cx, inputClass, pickFiles } from '@/components/ui';
import { ChatPanel } from '@/components/dock/ChatPanel';
import { BasicsPanel } from '@/components/editor/BasicsPanel';
import { GreetingsPanel } from '@/components/editor/GreetingsPanel';
import { LorebookPanel } from '@/components/editor/LorebookPanel';
import { PromptsPanel } from '@/components/editor/OtherPanels';
import { WritingToolsContext } from '@/components/editor/fieldTools';
import { openLightbox } from '@/components/Lightbox';
import { CardListMeta } from '@/components/CardListMeta';
import { importFromUrl } from '@/components/ImportUrl';
import type { ProjectSummary } from '@/types/project';

// Chat mode: the app as a chat frontend. Your cards and the ones imported
// here, a full-width chat, and the card's definitions a click away, with
// the building tools (art, gallery, the writing assistant) out of sight.
// Builder cards show here too, sharing their chats; cards imported here
// stay out of Builder until they're added to it.

/** Switches between Builder and Chat, keeping the open card where it
 *  belongs in both, or reopening the card that mode had last. */
export async function switchAppMode(mode: AppMode) {
  const ui = useUiStore.getState();
  if (ui.appMode === mode) return;
  const store = useProjectStore.getState();
  await store.flush();
  ui.setAppMode(mode);
  const open = store.project;
  const fits = (s: Pick<ProjectSummary, 'chatOnly'>) => mode === 'chat' || !s.chatOnly;
  const remember = (id: string) => {
    try {
      localStorage.setItem(lastCardKey(mode), id);
    } catch {
      /* private mode */
    }
  };
  if (open && fits(open)) return remember(open.id);
  let last: string | null = null;
  try {
    last = localStorage.getItem(lastCardKey(mode));
  } catch {
    /* private mode */
  }
  const lastCard = last ? store.summaries.find((s) => s.id === last) : undefined;
  if (lastCard && fits(lastCard)) await store.open(lastCard.id);
  else if (open) await store.close();
}

/** Imports a card as a Chat-mode card (a file dropped, or one picked). */
export async function importChatCard(file?: File) {
  const picked = file ?? (await pickFiles('.png,.json,.charx'))[0];
  if (!picked) return;
  const { create, setAvatar } = useProjectStore.getState();
  try {
    const imported = await importAsProject(picked, create, setAvatar, { chatOnly: true });
    toast(`Imported ${imported.card.data.name || 'the card'}. It's in Chat mode only; "Add to Builder" puts it in Builder too.`, 'success');
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

const avatarOf = (s: ProjectSummary) => api.avatarUrl(s.id, s.avatar);

/** Chat mode's card list (the sidebar, or the phone's drawer). */
export function ChatCardList({ onPicked, className }: { onPicked?: () => void; className?: string }) {
  const { summaries, project, open, remove } = useProjectStore();
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const shown = summaries.filter((s) => !q || s.name.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q)));
  return (
    <nav className={cx('flex h-full w-60 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-950', className)}>
      <div className="flex gap-1.5 p-2">
        <Button size="sm" variant="primary" className="flex-1" onClick={() => void importChatCard().then(() => onPicked?.())} title="Import a PNG, JSON or CHARX card to chat with (or drop one anywhere)">
          Import a card
        </Button>
        <Button size="sm" onClick={() => void importFromUrl({ chatOnly: true }).then(() => onPicked?.())} title="Import from a URL (a Chub character link)" aria-label="Import from a URL">
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
          const url = avatarOf(s);
          return (
            <div key={s.id} className={cx('group flex items-center gap-2 rounded-md px-1.5 py-1.5', project?.id === s.id ? 'bg-violet-500/15' : 'hover:bg-slate-900')}>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={async () => {
                  await open(s.id);
                  onPicked?.();
                }}
              >
                <span className="h-10 w-7 flex-shrink-0 overflow-hidden rounded bg-slate-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url && <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-200">{s.name || <em className="text-slate-500">Unnamed</em>}</span>
                  <CardListMeta summary={s} />
                  <span className="block truncate text-[10px] text-slate-500">
                    {!s.chatOnly && <span title="Your card from Builder (edits and chats are shared with it)">🛠 Builder · </span>}
                    {new Date(s.updatedAt).toLocaleDateString()}
                  </span>
                </span>
              </button>
              {s.chatOnly && (
                <IconButton
                  title="Delete card"
                  tone="danger"
                  className="opacity-0 group-hover:opacity-100 touch:opacity-100"
                  onClick={async () => {
                    if (await confirmDialog({ title: `Delete "${s.name || 'Unnamed'}"?`, body: 'The card and its chats move to data/trash, where you can recover them by hand.', confirmLabel: 'Delete', danger: true })) await remove(s.id);
                  }}
                >
                  🗑
                </IconButton>
              )}
            </div>
          );
        })}
        {summaries.length === 0 && <p className="px-2 py-4 text-xs text-slate-500">No cards yet. Import one, or drop a card file anywhere.</p>}
      </div>
    </nav>
  );
}

/** No card open in Chat mode: every card to pick from. */
export function ChatHome({ loading }: { loading: boolean }) {
  const { summaries, open } = useProjectStore();
  if (loading) return <div className="flex flex-1 items-center justify-center text-slate-500">Opening…</div>;
  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto p-4 phone:p-3">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Chat</h1>
          <p className="mt-1 text-sm text-slate-400">Pick a card to chat with, or import one. Cards imported here stay out of Builder until you add them to it; your Builder cards are here too.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void importChatCard()}>
            Import a card…
          </Button>
          <Button onClick={() => void importFromUrl({ chatOnly: true })} title="A Chub character link">
            🔗 Import from a URL…
          </Button>
          <Button variant="ghost" onClick={() => void switchAppMode('builder')}>
            🛠 Switch to Builder
          </Button>
        </div>
        {summaries.length === 0 ? (
          <p className="text-sm text-slate-500">No cards yet. Import a PNG, JSON or CHARX card, or drop one anywhere.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 phone:grid-cols-[repeat(auto-fill,minmax(104px,1fr))] phone:gap-2">
            {summaries.map((s) => {
              const url = avatarOf(s);
              return (
                <button key={s.id} type="button" onClick={() => void open(s.id)} className="group flex flex-col overflow-hidden rounded-md border border-slate-800 bg-slate-900 text-left hover:border-violet-500">
                  <div className="checker aspect-[2/3] w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {url ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center text-3xl text-slate-600">{(s.name.trim()[0] ?? '?').toUpperCase()}</div>}
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="truncate text-sm text-slate-200">{s.name || <em className="text-slate-500">Unnamed</em>}</div>
                    <CardListMeta summary={s} />
                    <div className="truncate text-[10px] text-slate-500">{s.chatOnly ? new Date(s.updatedAt).toLocaleDateString() : '🛠 Builder'}</div>
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

/** The open card's picture, in the header (full size on a tap). */
export function ChatHeaderAvatar() {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const url = api.avatarUrl(project.id, project.avatar);
  const name = project.card.data.name || 'Unnamed';
  return url ? (
    <button type="button" onClick={() => openLightbox(url)} title="Show full size" className="h-7 w-7 flex-shrink-0 cursor-zoom-in overflow-hidden rounded-full bg-slate-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover object-top" />
    </button>
  ) : (
    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs text-slate-400">{name[0]?.toUpperCase()}</span>
  );
}

/** A Chat-mode card joining Builder, with word of it. */
function addToBuilderNow(id: string, name: string) {
  void useProjectStore
    .getState()
    .addToBuilder(id)
    .then(
      () => toast(`${name} is in Builder now, too.`, 'success'),
      (err: Error) => toast(err.message, 'error'),
    );
}

/** The header's buttons for the open card in Chat mode: its definitions,
 *  and Builder (on a phone, "Add to Builder" is in the card drawer). */
export function ChatCardActions({ phone }: { phone: boolean }) {
  const project = useProjectStore((s) => s.project);
  const { chatCardOpen, setChatCardOpen } = useUiStore();
  if (!project) return null;
  const name = project.card.data.name || 'Unnamed';
  return (
    <>
      {!phone &&
        (project.chatOnly ? (
          <Button size="sm" variant="ghost" title="Put this card in Builder too, to work on it there (its chats come along)" onClick={() => addToBuilderNow(project.id, name)}>
            + Add to Builder
          </Button>
        ) : (
          <Button size="sm" variant="ghost" title="Work on this card in Builder" onClick={() => void switchAppMode('builder')}>
            🛠 Open in Builder
          </Button>
        ))}
      <Button size="sm" variant={chatCardOpen ? 'primary' : 'secondary'} onClick={() => setChatCardOpen(!chatCardOpen)} title="The card's definitions and lorebook, to read or change">
        📝{!phone && ' Card'}
      </Button>
    </>
  );
}

/** A card open in Chat mode: the chat, and its definitions. The card's
 *  picture, name and buttons are in the header, leaving the chat the room. */
export function ChatScreen({ phone }: { phone: boolean }) {
  const project = useProjectStore((s) => s.project);
  const { chatCardOpen, setChatCardOpen } = useUiStore();
  if (!project) return null;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1">
        <ChatPanel wide />
      </div>
      {chatCardOpen &&
        (phone ? (
          <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <CardDrawer onClose={() => setChatCardOpen(false)} />
          </div>
        ) : (
          <aside className="flex w-[440px] max-w-[45%] flex-shrink-0 flex-col border-l border-slate-800">
            <CardDrawer onClose={() => setChatCardOpen(false)} />
          </aside>
        ))}
    </div>
  );
}

type DrawerTab = 'basics' | 'greetings' | 'lorebook' | 'prompts';

/** The card's definitions and lorebook, editable, without the writing
 *  tools (Builder has those). Edits save to the card, with undo. */
function CardDrawer({ onClose }: { onClose: () => void }) {
  const card = useProjectStore((s) => s.project?.card.data);
  const project = useProjectStore((s) => s.project);
  const [tab, setTab] = useState<DrawerTab>('basics');
  if (!card || !project) return null;
  return (
    <WritingToolsContext.Provider value={false}>
      {project.chatOnly && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 px-3 py-1.5 text-xs text-slate-400">
          <span className="flex-1">Imported for chatting: it&apos;s in Chat mode only.</span>
          <Button size="sm" variant="ghost" title="Put this card in Builder too, to work on it there (its chats come along)" onClick={() => addToBuilderNow(project.id, card.name || 'Unnamed')}>
            + Add to Builder
          </Button>
        </div>
      )}
      <div className="flex flex-shrink-0 items-center border-b border-slate-800 pr-1">
        <Tabs
          value={tab}
          onChange={setTab}
          className="min-w-0 flex-1 border-b-0 px-2"
          tabs={[
            { value: 'basics', label: 'Character' },
            { value: 'greetings', label: 'Greetings', badge: 1 + card.alternate_greetings.length },
            { value: 'lorebook', label: 'Lorebook', badge: card.character_book?.entries.length },
            { value: 'prompts', label: 'Prompts' },
          ]}
        />
        <IconButton title="Close" onClick={onClose}>
          ✕
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tab === 'basics' && <BasicsPanel />}
        {tab === 'greetings' && <GreetingsPanel />}
        {tab === 'lorebook' && <LorebookPanel />}
        {tab === 'prompts' && <PromptsPanel />}
      </div>
    </WritingToolsContext.Provider>
  );
}
