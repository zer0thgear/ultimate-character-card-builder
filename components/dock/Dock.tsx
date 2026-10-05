'use client';

import { useUiStore, type DockTab } from '@/store/uiStore';
import { useSessionStore } from '@/store/sessionStore';
import { useProjectStore } from '@/store/projectStore';
import { Tabs } from '@/components/ui';
import { FullPaneButton } from '@/components/FullPaneButton';
import { ImagePanel } from '@/components/dock/ImagePanel';
import { GalleryPanel } from '@/components/dock/GalleryPanel';
import { LibraryPanel } from '@/components/dock/LibraryPanel';
import { ChatPanel } from '@/components/dock/ChatPanel';
import { BrainstormPanel } from '@/components/dock/BrainstormPanel';
import { SandboxFrame } from '@/components/extensions/SandboxFrame';
import { usePackStore } from '@/store/packStore';

// The right-hand side: everything that works alongside the card text.
// Panels other than the open one stay mounted (hidden), so a generation or
// a chat reply carries on while you look at something else.

export function Dock({ phone = false }: { phone?: boolean }) {
  const { dockTab: chosen, setDockTab } = useUiStore();
  // Extensions' tabs (lib/extensionSandbox.ts); one that's gone falls back to Image.
  const extTabs = usePackStore((s) => s.layer.ui).filter((u) => u.slot === 'dockTab');
  const dockTab: DockTab = chosen.startsWith('ext:') && !extTabs.some((u) => `ext:${u.packId}.${u.id}` === chosen) ? 'image' : chosen;
  const generating = useSessionStore((s) => s.generating);
  const projectId = useProjectStore((s) => s.project?.id);
  const sessionCount = useSessionStore((s) => s.images.filter((i) => i.projectId === projectId).length);
  const keptCount = useProjectStore((s) => s.project?.kept.length ?? 0);
  const tabs: { value: DockTab; label: React.ReactNode; badge?: React.ReactNode }[] = [
    { value: 'image', label: generating ? '🎨 Image ⏳' : '🎨 Image' },
    { value: 'gallery', label: '🖼 Gallery', badge: sessionCount + keptCount || undefined },
    { value: 'library', label: '📚 Library' },
    { value: 'chat', label: '💬 Test chat' },
    { value: 'assist', label: '✨ Brainstorm' },
    ...extTabs.map((u) => ({ value: `ext:${u.packId}.${u.id}` as const, label: `${u.icon ?? '🧩'} ${u.label}` })),
  ];
  const panel = (tab: DockTab, node: React.ReactNode) => (
    <div className="h-full min-h-0" hidden={dockTab !== tab}>
      {node}
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!phone && (
        <div className="flex flex-shrink-0 items-center border-b border-slate-800 pr-1">
          <Tabs value={dockTab} onChange={setDockTab} tabs={tabs} className="min-w-0 flex-1 border-b-0 px-2" />
          <FullPaneButton pane="dock" />
        </div>
      )}
      <div className="min-h-0 flex-1">
        {panel('image', <ImagePanel />)}
        {panel('gallery', <GalleryPanel />)}
        {dockTab === 'library' && <LibraryPanel />}
        {panel('chat', <ChatPanel />)}
        {panel('assist', <BrainstormPanel />)}
        {extTabs.map((u) => (
          <div key={`${u.packId}.${u.id}`} className="h-full min-h-0" hidden={dockTab !== `ext:${u.packId}.${u.id}`}>
            <SandboxFrame ui={u} fill />
          </div>
        ))}
      </div>
    </div>
  );
}
