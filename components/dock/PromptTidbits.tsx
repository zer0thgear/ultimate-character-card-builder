'use client';

import { useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useSessionStore } from '@/store/sessionStore';
import { toast } from '@/store/uiStore';
import { createLibraryEntry, createLinkedTidbit, createTidbit, entryUses, linkedEntry, tidbitToLibrary, uniqueLabel, unlinkTidbit } from '@/lib/promptTidbits';
import { analyzeWildcards, isRandomEntry, randomOptions } from '@/lib/wildcards';
import { TagAutocompleteField } from '@/components/TagAutocompleteField';
import { IconButton, Toggle, confirmDialog, cx, inputClass } from '@/components/ui';
import type { LibraryTidbit, NovelAIModel, PromptTidbit } from '@/types/novelai';

// Prompt tidbits: small switchable pieces under a prompt (an outfit, a
// location, an artist) added to its end when on; see lib/promptTidbits.ts.
// The Tidbit Library holds the ones shared between prompts and cards, and
// the wildcards (random entries) that `__Label__` rolls.

const fieldClass = cx(inputClass, 'py-1 font-mono text-[12px]');
const linkClass = 'text-[11px] text-slate-500 hover:text-slate-300';

/** The tidbits under one prompt field. */
export function TidbitList({
  tidbits,
  onChange,
  model,
  apiKey,
  placeholder = 'tags added when on',
}: {
  tidbits: PromptTidbit[] | undefined;
  onChange: (tidbits: PromptTidbit[]) => void;
  model: NovelAIModel;
  apiKey: string;
  placeholder?: string;
}) {
  const library = useSettingsStore((s) => s.tidbitLibrary);
  const setForm = useSettingsStore((s) => s.set);
  const list = tidbits ?? [];
  const update = (id: string, patch: Partial<PromptTidbit>) => onChange(list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const replace = (id: string, next: PromptTidbit) => onChange(list.map((t) => (t.id === id ? next : t)));

  const save = (t: PromptTidbit) => {
    const lib = useSettingsStore.getState().tidbitLibrary;
    const made = tidbitToLibrary({ ...t, label: uniqueLabel(t.label, lib) });
    setForm('tidbitLibrary', [...lib, made.entry]);
    replace(t.id, made.tidbit);
    toast(`Saved "${made.entry.label}" to the Tidbit Library. Link it under any prompt, or write __${made.entry.label}__ in one.`, 'success');
  };

  return (
    <div className="flex flex-col gap-1">
      {list.map((t) => {
        const entry = linkedEntry(t, library);
        return (
          <div key={t.id} className={cx('flex items-center gap-1.5', !t.enabled && 'opacity-50')}>
            <Toggle checked={t.enabled} onChange={(enabled) => update(t.id, { enabled })} title={t.enabled ? 'On: added to the prompt' : 'Off: left out'} />
            {entry ? (
              <>
                <span className="w-24 shrink-0 truncate text-xs text-violet-300" title="Linked to the Tidbit Library: edit it there and every prompt using it follows">
                  🔗 {entry.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-400" title={entry.text}>
                  {isRandomEntry(entry) ? `⚄ one of ${randomOptions(entry).length}: ${randomOptions(entry).join(' | ')}` : entry.text || '(empty)'}
                </span>
                <IconButton title="Unlink: make it this prompt's own copy, to edit here" onClick={() => replace(t.id, unlinkTidbit(t, library))}>
                  ⛓
                </IconButton>
              </>
            ) : (
              <>
                <input value={t.label} onChange={(e) => update(t.id, { label: e.target.value })} className="w-24 shrink-0 bg-transparent text-xs text-slate-300 outline-none placeholder:text-slate-600" placeholder="Name" />
                <TagAutocompleteField as="input" value={t.text} onChange={(text) => update(t.id, { text })} model={model} apiKey={apiKey} className={fieldClass} wrapperClassName="relative min-w-0 flex-1" placeholder={placeholder} />
                <IconButton title="Save to the Tidbit Library, to use it in other prompts and cards" disabled={!t.text.trim()} onClick={() => save(t)}>
                  ⇪
                </IconButton>
              </>
            )}
            <IconButton title="Remove tidbit" tone="danger" onClick={() => onChange(list.filter((x) => x.id !== t.id))}>
              ✕
            </IconButton>
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <button type="button" className={linkClass} onClick={() => onChange([...list, createTidbit('')])} title="A piece you can switch on and off, added to the end of this prompt">
          + Tidbit
        </button>
        {library.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const entry = library.find((l) => l.id === e.target.value);
              if (entry) onChange([...list, createLinkedTidbit(entry)]);
            }}
            className="cursor-pointer bg-transparent text-[11px] text-slate-500 outline-none hover:text-slate-300"
            title="Link a Tidbit Library entry under this prompt"
          >
            <option value="">🔗 From library…</option>
            {library.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label || 'Untitled'}
                {isRandomEntry(l) ? ' (random)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

/** Library references the prompts name that match no entry (`__typo__`),
 *  which would go to the image model as written. */
export function UnknownReferences() {
  const form = useSettingsStore();
  const selected = form.basePrompts.find((p) => p.selected) ?? form.basePrompts[0];
  const { unknown } = analyzeWildcards(selected ? [selected] : [], form.characters, { text: form.negativePrompt, tidbits: form.negativeTidbits }, form.tidbitLibrary);
  if (!unknown.length) return null;
  return (
    <p className="text-[11px] text-amber-400">
      No Tidbit Library entry called {unknown.join(', ')}: {unknown.length === 1 ? 'it goes' : 'they go'} to the image model as written. Check the spelling, or add {unknown.length === 1 ? 'it' : 'them'} to the library below.
    </p>
  );
}

/** The shared library: fixed entries (the same text every time) and random
 *  ones (one line rolled per picture). Global, like the negative. */
export function TidbitLibrarySection() {
  const form = useSettingsStore();
  const { tidbitLibrary: library, set, model } = form;
  const apiKey = useSessionStore((s) => s.apiKey);
  const [open, setOpen] = useState(false);
  const update = (id: string, patch: Partial<LibraryTidbit>) => set('tidbitLibrary', library.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const add = () => {
    setOpen(true);
    set('tidbitLibrary', [...library, createLibraryEntry(uniqueLabel('Tidbit', library))]);
  };
  const remove = async (entry: LibraryTidbit) => {
    const texts = [...form.basePrompts.map((p) => p.text), ...form.characters.flatMap((c) => [c.prompt, c.uc]), form.negativePrompt, ...library.filter((l) => l.id !== entry.id).map((l) => l.text)];
    const lists = [...form.basePrompts.map((p) => p.tidbits), ...form.characters.flatMap((c) => [c.tidbits, c.ucTidbits]), form.negativeTidbits];
    const uses = entryUses(entry, texts, lists);
    if (
      uses &&
      !(await confirmDialog({
        title: `Delete "${entry.label}"?`,
        body: `This card's prompts use it ${uses === 1 ? 'once' : `${uses} times`}. Linked tidbits keep a copy of its text; __${entry.label}__ in a prompt stops working.`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    set('tidbitLibrary', useSettingsStore.getState().tidbitLibrary.filter((l) => l.id !== entry.id));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-left text-xs font-semibold tracking-wide text-slate-300 uppercase">
          {open ? '▾' : '▸'} Tidbit Library <span className="font-normal text-slate-500 normal-case">({library.length}; shared by every card)</span>
        </button>
        <button type="button" className={linkClass} onClick={add}>
          + Entry
        </button>
      </div>
      {open && (
        <>
          <p className="text-[11px] text-slate-500">
            Link an entry under any prompt with 🔗 From library, or write <code>__Name__</code> in a prompt. A random entry puts one of its lines in each picture, rolled fresh every time (the picture remembers its rolls, so Enhance and inpaint keep them).
          </p>
          {library.length === 0 && <p className="text-xs text-slate-500">Nothing saved yet. ⇪ on a tidbit saves it here.</p>}
          {library.map((l) => (
            <div key={l.id} className="flex flex-col gap-1 rounded-md border border-slate-800 bg-slate-900/60 p-2">
              <div className="flex items-center gap-2">
                <input
                  value={l.label}
                  onChange={(e) => update(l.id, { label: e.target.value })}
                  onBlur={(e) => update(l.id, { label: uniqueLabel(e.target.value, useSettingsStore.getState().tidbitLibrary, l.id) })}
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none"
                  placeholder="Name"
                  title={`Write __${l.label.trim() || 'Name'}__ in a prompt to use it`}
                />
                <select
                  value={l.kind ?? 'fixed'}
                  onChange={(e) => update(l.id, { kind: e.target.value as 'fixed' | 'random' })}
                  className="bg-transparent text-xs text-slate-400 outline-none"
                  title="Fixed: the same text every time. Random: one line per picture."
                >
                  <option value="fixed">Fixed</option>
                  <option value="random">Random</option>
                </select>
                <IconButton title="Delete entry" tone="danger" onClick={() => void remove(l)}>
                  ✕
                </IconButton>
              </div>
              <TagAutocompleteField
                value={l.text}
                onChange={(text) => update(l.id, { text })}
                model={model}
                apiKey={apiKey}
                className={cx(inputClass, 'min-h-10 resize-y font-mono text-[12px]')}
                rows={isRandomEntry(l) ? 3 : 1}
                placeholder={isRandomEntry(l) ? 'one option per line\nblonde hair\nsilver hair' : 'red dress, black boots'}
              />
              {isRandomEntry(l) && <span className="text-[10px] text-slate-500">{randomOptions(l).length} options</span>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
