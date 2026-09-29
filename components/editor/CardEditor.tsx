'use client';

import { useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore, toast, type EditorTab } from '@/store/uiStore';
import { api } from '@/lib/api';
import { Tabs, IconButton, cx, pickFiles } from '@/components/ui';
import { BasicsPanel } from '@/components/editor/BasicsPanel';
import { GreetingsPanel } from '@/components/editor/GreetingsPanel';
import { LorebookPanel } from '@/components/editor/LorebookPanel';
import { CreatorPanel, NotesPanel, PromptsPanel, ToolsPanel } from '@/components/editor/OtherPanels';
import { openVisionWrite } from '@/components/VisionWriteDialog';
import { ExtensionImageActions } from '@/components/ExtensionSlots';
import { FullPaneButton } from '@/components/FullPaneButton';

export function CardEditor() {
  const { editorTab, setEditorTab, showAvatar } = useUiStore();
  const card = useProjectStore((s) => s.project?.card.data);
  if (!card) return null;
  const tabs: { value: EditorTab; label: string; badge?: number }[] = [
    { value: 'basics', label: 'Character' },
    { value: 'greetings', label: 'Greetings', badge: 1 + card.alternate_greetings.length },
    { value: 'lorebook', label: 'Lorebook', badge: card.character_book?.entries.length },
    { value: 'prompts', label: 'Prompts' },
    { value: 'creator', label: 'Creator' },
    { value: 'notes', label: 'Notes' },
    { value: 'tools', label: 'Tools' },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      {showAvatar && <AvatarStrip />}
      <div className="flex items-center border-b border-slate-800 pr-1">
        <Tabs value={editorTab} onChange={setEditorTab} tabs={tabs} className="min-w-0 flex-1 border-b-0 px-3" />
        <FullPaneButton pane="card" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 phone:px-3">
        <div className="mx-auto max-w-4xl">
          {editorTab === 'basics' && <BasicsPanel />}
          {editorTab === 'greetings' && <GreetingsPanel />}
          {editorTab === 'lorebook' && <LorebookPanel />}
          {editorTab === 'prompts' && <PromptsPanel />}
          {editorTab === 'creator' && <CreatorPanel />}
          {editorTab === 'notes' && <NotesPanel />}
          {editorTab === 'tools' && <ToolsPanel />}
        </div>
      </div>
    </div>
  );
}

/** The card's picture, name and tags; drop or pick an image to change it.
 *  Gens and library images get a "Set as avatar" button of their own. */
function AvatarStrip() {
  const project = useProjectStore((s) => s.project);
  const setAvatar = useProjectStore((s) => s.setAvatar);
  const clearAvatar = useProjectStore((s) => s.clearAvatar);
  const setDockTab = useUiStore((s) => s.setDockTab);
  const [over, setOver] = useState(false);
  if (!project) return null;
  const url = api.avatarUrl(project.id, project.avatar);

  const set = async (file: Blob) => {
    try {
      await setAvatar(file);
      toast('Avatar updated.', 'success');
    } catch (err) {
      toast(`Couldn't set the avatar: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <div
      className={cx('flex items-center gap-4 border-b border-slate-800 px-4 py-3 phone:gap-3 phone:px-3 phone:py-2', over && 'bg-violet-500/10')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
        if (file) {
          e.preventDefault();
          e.stopPropagation();
          void set(file);
        }
      }}
    >
      <button
        type="button"
        onClick={async () => {
          const [file] = await pickFiles('image/*');
          if (file) void set(file);
        }}
        title="Change the avatar (or drop an image here)"
        className="checker group relative h-28 w-20 flex-shrink-0 overflow-hidden rounded-md border border-slate-700 phone:h-20 phone:w-14"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Avatar" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-2xl text-slate-600">＋</span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100">Change</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-lg font-semibold text-slate-100">{project.card.data.name || <span className="text-slate-500">Unnamed character</span>}</div>
        <div className="mt-0.5 truncate text-xs text-slate-500">{project.card.data.tags.join(', ') || 'No tags'}</div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <button type="button" className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700" onClick={() => setDockTab('image')}>
            🎨 Generate art
          </button>
          <button type="button" className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700" onClick={() => setDockTab('gallery')}>
            🖼 Pick from gens
          </button>
          <button type="button" className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700" onClick={() => setDockTab('library')}>
            📚 Pick from library
          </button>
          {url && (
            <button
              type="button"
              className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700"
              title="A physical description, a greeting, or ask about the picture (vision model)"
              onClick={async () => openVisionWrite(await (await fetch(url)).blob())}
            >
              ✍ Write from picture
            </button>
          )}
          {url && <ExtensionImageActions variant="chip" image={{ name: `${project.card.data.name || 'avatar'}.png`, source: 'avatar', blob: async () => (await fetch(url)).blob(), projectId: project.id }} />}
          {project.avatar && (
            <span className="self-center text-slate-500">
              {project.avatar.width}×{project.avatar.height}
            </span>
          )}
        </div>
      </div>
      {project.avatar && (
        <IconButton title="Remove the avatar" tone="danger" onClick={() => void clearAvatar()}>
          ✕
        </IconButton>
      )}
    </div>
  );
}
