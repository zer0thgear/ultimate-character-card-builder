'use client';

import { useUiStore, type DockTab } from '@/store/uiStore';
import { useSessionStore } from '@/store/sessionStore';
import { useProjectStore } from '@/store/projectStore';
import { Tabs } from '@/components/ui';
import { ImagePanel } from '@/components/dock/ImagePanel';
import { GalleryPanel } from '@/components/dock/GalleryPanel';
import { LibraryPanel } from '@/components/dock/LibraryPanel';
import { ChatPanel } from '@/components/dock/ChatPanel';
import { BrainstormPanel } from '@/components/dock/BrainstormPanel';

// The right-hand side: everything that works alongside the card text.
// Panels other than the open one stay mounted (hidden), so a generation or
// a chat reply carries on while you look at something else.

export function Dock({ phone = false }: { phone?: boolean }) {
  const { dockTab, setDockTab } = useUiStore();
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
  ];
  const panel = (tab: DockTab, node: React.ReactNode) => (
    <div className="h-full min-h-0" hidden={dockTab !== tab}>
      {node}
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!phone && <Tabs value={dockTab} onChange={setDockTab} tabs={tabs} className="flex-shrink-0 px-2" />}
      <div className="min-h-0 flex-1">
        {panel('image', <ImagePanel />)}
        {panel('gallery', <GalleryPanel />)}
        {dockTab === 'library' && <LibraryPanel />}
        {panel('chat', <ChatPanel />)}
        {panel('assist', <BrainstormPanel />)}
      </div>
    </div>
  );
}
