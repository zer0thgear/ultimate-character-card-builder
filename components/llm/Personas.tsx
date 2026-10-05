'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { sortPersonas, usePersonaStore } from '@/store/personaStore';
import { toast, useUiStore, type PersonaSort } from '@/store/uiStore';
import { useLlmStore } from '@/store/llmStore';
import { useChatStore } from '@/store/chatStore';
import { api } from '@/lib/api';
import type { Persona } from '@/types/project';
import type { AvatarShape } from '@/lib/chatPrompt';
import { AutoTextarea, Button, IconButton, TokenBadge, confirmDialog, cx, inputClass, pickFiles } from '@/components/ui';
import { parseStPersonas, samePersona, PersonaImportError } from '@/lib/stPersonas';
import { LorebookSelect } from '@/components/LorebookBank';

/** SillyTavern personas from a settings.json or persona backup, with any
 *  avatar images picked alongside it matched by file name. */
async function importFromFiles() {
  const files = await pickFiles('.json,image/*', true);
  const jsons = files.filter((f) => f.name.toLowerCase().endsWith('.json'));
  if (!jsons.length) {
    if (files.length) toast('Pick SillyTavern’s settings.json or a persona backup (.json), plus any avatar images.', 'error');
    return;
  }
  const images = new Map(files.filter((f) => f.type.startsWith('image/')).map((f) => [f.name.toLowerCase(), f]));
  const store = usePersonaStore.getState();
  let added = 0;
  let skipped = 0;
  let pictures = 0;
  for (const file of jsons) {
    let found;
    try {
      found = parseStPersonas(JSON.parse(await file.text()));
    } catch (err) {
      toast(err instanceof PersonaImportError ? `${file.name}: ${err.message}` : `Couldn't read ${file.name}.`, 'error');
      continue;
    }
    for (const st of found) {
      if (usePersonaStore.getState().personas.some((p) => samePersona(p, st))) {
        skipped++;
        continue;
      }
      const p = store.add({ name: st.name, description: st.description });
      added++;
      const image = images.get(st.file.toLowerCase());
      if (image) {
        await store.setAvatar(p.id, image).then(() => pictures++, () => {});
      }
    }
  }
  if (added || skipped) toast(`Imported ${added} persona${added === 1 ? '' : 's'}${pictures ? ` (${pictures} with pictures)` : ''}${skipped ? `; ${skipped} already here` : ''}.`, 'success');
}

/** Everything from a SillyTavern install, pictures included. */
async function importFromFolder() {
  const picked = await api.pickFolder('', 'Your SillyTavern folder (or its data\default-user)');
  if (picked.unsupported) return toast('No folder picker on this system; use Import file instead.', 'error');
  if (!picked.path) return;
  try {
    const r = await api.importStPersonas(picked.path);
    await usePersonaStore.getState().load();
    toast(`Imported ${r.added} persona${r.added === 1 ? '' : 's'} (${r.pictures} with pictures)${r.skipped ? `; ${r.skipped} already here` : ''}.`, 'success');
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

// Personas for test chats: who {{user}} is, with a picture. Managed in
// Settings → Personas; picked (and optionally pinned to a chat) from the
// chat itself.

/** A persona just made, for Settings → Personas to bring into view with its
 *  name ready to type over. */
const useNewPersona = create<{ id: string | null }>(() => ({ id: null }));

/** A new persona, in use at once: the active one, or this chat's if the
 *  chat has one pinned. */
function createPersona(pinned: boolean) {
  const p = usePersonaStore.getState().add();
  if (pinned) useChatStore.getState().setPersonaLock(p.id);
  else useLlmStore.getState().setChatSettings({ personaId: p.id });
  useNewPersona.setState({ id: p.id });
  return p;
}

/** An avatar's frame: a circle, a rounded square, or a 2:3 portrait. */
export function avatarFrame(shape: Exclude<AvatarShape, 'none'>, size: number): { className: string; style: React.CSSProperties } {
  return {
    className: shape === 'circle' ? 'rounded-full' : 'rounded-md',
    style: { width: size, height: shape === 'rectangle' ? Math.round(size * 1.5) : size },
  };
}

export function PersonaAvatar({ persona, size = 36, shape = 'circle' }: { persona?: Persona | null; size?: number; shape?: Exclude<AvatarShape, 'none'> }) {
  const url = persona ? api.personaAvatarUrl(persona) : null;
  const frame = avatarFrame(shape, size);
  return (
    <div className={cx('flex flex-shrink-0 items-center justify-center overflow-hidden bg-sky-500/20 text-xs text-sky-300', frame.className)} style={frame.style}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover object-top" />
      ) : (
        (persona?.name.trim()[0] ?? 'You').toUpperCase().slice(0, 3)
      )}
    </div>
  );
}

export function PersonaManager() {
  const { personas, loaded, load, update, remove, setAvatar, clearAvatar } = usePersonaStore();
  const { chatSettings, setChatSettings } = useLlmStore();
  const { personaSort, setPersonaSort } = useUiStore();
  const [filter, setFilter] = useState('');
  const newId = useNewPersona((s) => s.id);
  const chat = useChatStore((s) => s.chat);
  const pinned = chat?.personaId ? personas.find((p) => p.id === chat.personaId) : undefined;
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  const q = filter.trim().toLowerCase();
  const shown = sortPersonas(personas, personaSort).filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));

  const pickAvatar = async (p: Persona) => {
    const [file] = await pickFiles('image/*');
    if (!file) return;
    try {
      await setAvatar(p.id, file);
    } catch (err) {
      toast(`Couldn't set the picture: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        Who you are in test chats: the name {'{{user}}'} becomes, a description sent as your persona, and a picture for your messages. The active one is used by every chat unless a chat has its own pinned (📌 in the chat toolbar), and by the writing assistant.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => {
            setFilter('');
            createPersona(false);
          }}
          title="A new persona, made the active one"
        >
          + New persona
        </Button>
        <Button onClick={() => void importFromFolder()} title="Browse to your SillyTavern folder: its personas and their pictures come across">
          Import from SillyTavern folder…
        </Button>
        <Button onClick={() => void importFromFiles()} title="SillyTavern's settings.json or a persona backup, plus any avatar images (select them together)">
          Import file…
        </Button>
      </div>
      {pinned && (
        <p className="rounded-md bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          The chat that&apos;s open has &quot;{pinned.name || 'Unnamed'}&quot; pinned (📌 in its toolbar), so it keeps that one. <b>Use</b> here sets the persona for every other chat.
        </p>
      )}
      {personas.length > 1 && (
        <div className="flex items-center gap-2">
          {personas.length > 6 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search personas…" className={cx(inputClass, 'py-1 text-xs')} />}
          <PersonaSortSelect value={personaSort} onChange={setPersonaSort} className={personas.length > 6 ? 'w-40' : 'ml-auto w-40'} />
        </div>
      )}
      {q && shown.length === 0 && <p className="text-xs text-slate-500">No persona matches “{filter}”.</p>}
      {shown.map((p) => {
        const active = chatSettings.personaId === p.id;
        return (
          <div key={p.id} className={cx('flex gap-3 rounded-md border p-3', active ? 'border-violet-500/50 bg-violet-500/5' : 'border-slate-800')}>
            <div className="flex flex-col items-center gap-1">
              <button type="button" onClick={() => void pickAvatar(p)} title="Choose a picture" className="rounded-full ring-violet-500 hover:ring-2">
                <PersonaAvatar persona={p} size={64} />
              </button>
              {p.avatar && (
                <button type="button" className="text-[10px] text-slate-500 hover:text-red-400" onClick={() => void clearAvatar(p.id)}>
                  remove
                </button>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  value={p.name}
                  onChange={(e) => update(p.id, { name: e.target.value })}
                  placeholder="Name ({{user}})"
                  className={cx(inputClass, 'font-medium')}
                  ref={(el) => {
                    // A persona just made: in view, its name selected to type over.
                    if (el && p.id === newId) {
                      el.scrollIntoView({ block: 'center' });
                      el.focus();
                      el.select();
                      useNewPersona.setState({ id: null });
                    }
                  }}
                />
                <Button size="sm" variant={active ? 'primary' : 'secondary'} onClick={() => setChatSettings({ personaId: active ? null : p.id })} title={active ? 'Stop using it' : 'Use this persona in chats'}>
                  {active ? '✓ Active' : 'Use'}
                </Button>
                <IconButton
                  title="Delete persona"
                  tone="danger"
                  onClick={async () => {
                    if (await confirmDialog({ title: `Delete "${p.name || 'this persona'}"?`, body: 'Chats that had it locked go back to the active persona.', confirmLabel: 'Delete', danger: true })) await remove(p.id);
                  }}
                >
                  🗑
                </IconButton>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                Description <TokenBadge text={p.description} />
              </div>
              <AutoTextarea value={p.description} onChange={(e) => update(p.id, { description: e.target.value })} minRows={2} maxRows={12} placeholder="Who you are: appearance, role, relationship to the character… ({{char}} works here)" />
              <label className="flex items-center gap-2 text-xs text-slate-400" title="A lorebook from 📖 Lorebooks that comes along with this persona in every chat, as SillyTavern's persona lorebook">
                Lorebook
                <LorebookSelect value={p.lorebookId} onChange={(id) => update(p.id, { lorebookId: id })} className="w-56" />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SORTS: { value: PersonaSort; label: string }[] = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'newest', label: 'Newest added' },
  { value: 'oldest', label: 'Oldest added' },
];

function PersonaSortSelect({ value, onChange, className }: { value: PersonaSort; onChange: (s: PersonaSort) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as PersonaSort)} title="Sort personas" className={cx(inputClass, 'py-1 text-xs', className)}>
      {SORTS.map((s) => (
        <option key={s.value} value={s.value}>
          Sort: {s.label}
        </option>
      ))}
    </select>
  );
}

/** The chat toolbar's persona picker, with the per-chat lock. */
export function PersonaPicker({ onManage }: { onManage: () => void }) {
  const { personas, loaded, load } = usePersonaStore();
  const { chatSettings, setChatSettings } = useLlmStore();
  const chat = useChatStore((s) => s.chat);
  const setPersonaLock = useChatStore((s) => s.setPersonaLock);
  const personaSort = useUiStore((s) => s.personaSort);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const locked = !!chat?.personaId && personas.some((p) => p.id === chat.personaId);
  const current = locked ? chat!.personaId! : (chatSettings.personaId ?? '');
  const choose = (id: string) => {
    if (locked) setPersonaLock(id || undefined);
    else setChatSettings({ personaId: id || null });
  };
  const persona = personas.find((p) => p.id === current) ?? null;

  return (
    <div className="flex items-center gap-1">
      <PersonaAvatar persona={persona} size={22} />
      <select
        value={current}
        onChange={(e) => {
          if (e.target.value === '__manage') onManage();
          else if (e.target.value === '__new') {
            createPersona(locked);
            onManage();
          } else choose(e.target.value);
        }}
        title={locked ? 'Your persona in this chat only (pinned)' : 'Your persona in every chat'}
        className={cx(inputClass, 'max-w-32 py-0.5 text-xs', locked && 'border-sky-500/50')}
      >
        <option value="">{chatSettings.userName || 'User'} (no persona)</option>
        {sortPersonas(personas, personaSort).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name || 'Unnamed'}
          </option>
        ))}
        <option value="__new">+ New persona…</option>
        <option value="__manage">Manage personas…</option>
      </select>
      {chat && (
        <IconButton
          title={locked ? 'Pinned to this chat: it keeps this persona whatever the active one is. Click to unpin.' : 'Pin this persona to this chat (it keeps it when you change the active one)'}
          tone={locked ? 'accent' : 'default'}
          disabled={!locked && !current}
          onClick={() => setPersonaLock(locked ? undefined : current || undefined)}
          className={locked ? undefined : 'opacity-60'}
        >
          📌
        </IconButton>
      )}
    </div>
  );
}
