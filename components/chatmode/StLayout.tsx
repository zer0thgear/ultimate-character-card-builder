'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { useLookStore } from '@/store/lookStore';
import { useUiStore } from '@/store/uiStore';
import { useProjectStore } from '@/store/projectStore';
import { useGroupStore } from '@/store/groupStore';
import { ChatCardActions, ChatCardList, ChatHeaderAvatar } from '@/components/chatmode/ChatMode';
import { GroupHeader } from '@/components/chatmode/GroupChat';
import { ChatSettings } from '@/components/dock/ChatPanel';
import { ChatPresetTab } from '@/components/llm/PresetManager';
import { PersonaManager } from '@/components/llm/Personas';
import { AppearanceTab } from '@/components/Appearance';
import { ExtensionsTab, LlmTab, openSettings } from '@/components/SettingsDialog';
import { openLorebooks } from '@/components/LorebookBank';
import { Button, IconButton, cx } from '@/components/ui';

// Chat mode laid out as SillyTavern's (Settings → Appearance → Layout): a
// top bar of icons, each opening a drawer under it (the first and the last
// at the sides, as its navigation panels are), and the chat as a column in
// the middle. The drawers hold UCCB's own settings, where SillyTavern
// keeps its own. Builder stays as it is.

type DrawerId = 'preset' | 'api' | 'chat' | 'look' | 'ext' | 'personas' | 'chars';

/** Which drawer is open, and whether UCCB's own bar shows under the icons. */
export const useStLayout = create<{ drawer: DrawerId | null; uccbBar: boolean; open: (d: DrawerId | null) => void; setUccbBar: (on: boolean) => void }>((set) => ({
  drawer: null,
  uccbBar: false,
  open: (drawer) => set({ drawer }),
  setUccbBar: (uccbBar) => set({ uccbBar }),
}));

/** Whether Chat mode is laid out as SillyTavern's. */
export function useStChat() {
  const st = useLookStore((s) => s.look.layout === 'st');
  const chat = useUiStore((s) => s.appMode === 'chat');
  return st && chat;
}

const ICONS: { id: DrawerId | 'lore'; icon: string; title: string; side?: 'left' | 'right' }[] = [
  { id: 'preset', icon: '🎚', title: 'AI response configuration: the chat preset, its prompts and samplers', side: 'left' },
  { id: 'api', icon: '🔌', title: 'API connections' },
  { id: 'chat', icon: '🔧', title: "Chat settings: your name, the prompt, lorebooks in play, what's shown" },
  { id: 'lore', icon: '📖', title: 'World info: your lorebooks' },
  { id: 'look', icon: '🎨', title: 'User settings: appearance' },
  { id: 'ext', icon: '🧩', title: 'Extensions' },
  { id: 'personas', icon: '🎭', title: 'Persona management' },
  { id: 'chars', icon: '👥', title: 'Character management: your cards and groups', side: 'right' },
];

export function StTopBar({ phone }: { phone: boolean }) {
  const { drawer, open, uccbBar, setUccbBar } = useStLayout();
  const project = useProjectStore((s) => s.project);
  const group = useGroupStore((s) => s.group);
  const close = () => open(null);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role="dialog"]') && useStLayout.getState().open(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  const side = ICONS.find((i) => i.id === drawer)?.side;

  return (
    <div id="top-bar" className="relative z-30 flex-shrink-0">
      <div id="top-settings-holder" className="ui-panel flex h-11 items-center gap-1 overflow-x-auto border-b border-slate-800 bg-slate-950 px-2">
        {/* What's open, at the start; SillyTavern's icons in the middle; this card's (or group's) own buttons at the end. */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <IconButton title={uccbBar ? "Hide UCCB's bar" : "UCCB's bar: Builder, undo, export, all settings"} onClick={() => setUccbBar(!uccbBar)} className={cx(uccbBar && 'bg-slate-800')}>
            ☰
          </IconButton>
          {project && !phone && (
            <>
              <ChatHeaderAvatar />
              <span className="max-w-48 min-w-0 truncate text-sm text-slate-200">{project.card.data.name || 'Unnamed character'}</span>
            </>
          )}
          {group && !project && !phone && <GroupHeader phone={false} />}
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5" role="toolbar" aria-label="SillyTavern's bar">
          {ICONS.map((i) => (
            <button
              key={i.id}
              type="button"
              title={i.title}
              aria-label={i.title}
              aria-expanded={i.id === 'lore' ? undefined : drawer === i.id}
              onClick={() => (i.id === 'lore' ? (close(), openLorebooks()) : open(drawer === i.id ? null : i.id))}
              className={cx('drawer-icon flex h-8 w-9 items-center justify-center rounded-md text-lg transition-opacity', drawer === i.id ? 'bg-slate-800 opacity-100' : 'opacity-60 hover:opacity-100')}
            >
              {i.icon}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">{project && !phone && <ChatCardActions phone />}</div>
      </div>
      {/* A phone's bar has room for the icons only: what's open gets a row of its own (UCCB's bar, when it's showing, has the same). */}
      {phone && !uccbBar && (project || group) && (
        <div className="ui-panel flex h-10 items-center gap-1.5 border-b border-slate-800 bg-slate-950 px-2">
          {project ? (
            <>
              <ChatHeaderAvatar />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{project.card.data.name || 'Unnamed character'}</span>
              <ChatCardActions phone />
            </>
          ) : (
            <GroupHeader phone />
          )}
        </div>
      )}
      {drawer && (
        <>
          {/* A click anywhere else closes it. */}
          <div className="fixed inset-0 -z-10" onClick={close} />
          <div
            className={cx(
              // Under the icons (over the phone's second row).
              'drawer-content ui-panel absolute top-11 flex flex-col overflow-y-auto border border-t-0 border-slate-700 bg-slate-950 shadow-2xl',
              side
                ? cx('h-[calc(100dvh-2.75rem)] w-[min(100vw,26rem)]', side === 'left' ? 'left-0' : 'right-0')
                : 'left-1/2 max-h-[min(85dvh,calc(100dvh-3.5rem))] w-[min(100vw,52rem)] -translate-x-1/2 rounded-b-lg',
            )}
          >
            {drawer === 'chars' ? (
              <ChatCardList className="w-full border-r-0" onPicked={close} />
            ) : drawer === 'chat' ? (
              <ChatSettings phone={phone} onClose={close} />
            ) : (
              <div className="flex flex-col gap-4 p-3">
                {drawer === 'preset' && <ChatPresetTab />}
                {drawer === 'api' && <LlmTab />}
                {drawer === 'look' && (
                  <>
                    <AppearanceTab />
                    <div>
                      <Button size="sm" variant="ghost" onClick={() => (close(), openSettings('general'))}>
                        All settings…
                      </Button>
                    </div>
                  </>
                )}
                {drawer === 'ext' && <ExtensionsTab />}
                {drawer === 'personas' && <PersonaManager />}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
