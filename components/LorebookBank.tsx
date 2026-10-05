'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { BankLorebook } from '@/types/project';
import type { CardData } from '@/types/card';
import { ensureLorebooks, useLorebookStore } from '@/store/lorebookStore';
import { useLlmStore } from '@/store/llmStore';
import { usePersonaStore } from '@/store/personaStore';
import { useChatStore } from '@/store/chatStore';
import { toast } from '@/store/uiStore';
import { bankName, copyFromCard, hasCardLore } from '@/lib/lorebookBank';
import { lorebookFile, newLorebook } from '@/lib/cardSpec';
import { importLorebookFile } from '@/lib/cardFile';
import { LorebookEditor } from '@/components/editor/LorebookPanel';
import { WizardButton } from '@/components/loreWizard/LoreWizard';
import { Button, Empty, IconButton, Modal, Toggle, choiceDialog, confirmDialog, cx, downloadBlob, fileBytes, inputClass, pickFiles, textDialog } from '@/components/ui';

// 📖 Lorebooks: the bank of lorebooks, as SillyTavern's World Info list
// (lib/lorebookBank.ts). Books are made here, imported from files, or added
// from a card (asked on import, as SillyTavern asks); each can be global
// (every chat), a chat's own, or a persona's.

const useLorebookDialog = create<{ open: boolean; editing: string | null; set: (s: { open: boolean; editing?: string | null }) => void }>((set) => ({
  open: false,
  editing: null,
  set: ({ open, editing = null }) => set({ open, editing }),
}));

/** Opens 📖 Lorebooks, on one book's editor if `id` is given. */
export const openLorebooks = (id?: string) => {
  ensureLorebooks();
  useLorebookDialog.getState().set({ open: true, editing: id ?? null });
};

async function loaded() {
  const s = useLorebookStore.getState();
  if (!s.loaded) await s.load().catch((err: Error) => toast(`Couldn't read your lorebooks: ${err.message}`, 'error'));
  return useLorebookStore.getState().books;
}

/** Asks which bank lorebook to use; null if there are none or none is picked. */
export async function pickBankLorebook(title: string): Promise<BankLorebook | null> {
  const books = await loaded();
  if (!books.length) {
    toast('No lorebooks yet: 📖 Lorebooks (on the home screen) makes or imports them.', 'info');
    return null;
  }
  const id = await choiceDialog({ title, choices: books.map((b) => ({ value: b.id, label: `${bankName(b)} (${b.book.entries.length})` })) });
  return books.find((b) => b.id === id) ?? null;
}

/** A new, empty bank lorebook, named by you; null if you cancel. */
async function createLorebook(): Promise<BankLorebook | null> {
  const name = await textDialog({ title: 'New lorebook', label: 'Name', placeholder: 'e.g. The Northern Kingdoms', confirmLabel: 'Create' });
  if (name === null) return null;
  try {
    return await useLorebookStore.getState().add({ ...newLorebook(), name: name.trim() || 'New lorebook' });
  } catch (err) {
    toast(`Couldn't create it: ${(err as Error).message}`, 'error');
    return null;
  }
}

/** Lorebook files (JSON, SillyTavern world files, cards) into the bank. */
async function importFiles() {
  const files = await pickFiles('.json,.png,.charx', true);
  const added: string[] = [];
  for (const file of files) {
    try {
      const book = await importLorebookFile(file.name, await fileBytes(file));
      const name = book.name?.trim() || file.name.replace(/\.(json|png|charx)$/i, '');
      const b = await useLorebookStore.getState().add({ ...book, name });
      added.push(bankName(b));
    } catch (err) {
      toast(`${file.name}: ${(err as Error).message}`, 'error');
    }
  }
  if (added.length) toast(added.length === 1 ? `Imported "${added[0]}".` : `Imported ${added.length} lorebooks.`, 'success');
}

/**
 * After cards are imported: offers to add their lorebooks to the bank, as
 * SillyTavern asks "This character has an embedded World/Lorebook. Would you
 * like to import it now?". Off with Chat settings' askLorebookImport, or
 * "Don't ask again" here.
 */
export async function offerCardLore(imported: { projectId: string; card: CardData }[]) {
  const withLore = imported.filter((i) => hasCardLore(i.card));
  if (!withLore.length || useLlmStore.getState().chatSettings.askLorebookImport === false) return;
  const one = withLore.length === 1;
  const names = withLore.map((i) => i.card.name || 'Unnamed');
  const answer = await choiceDialog({
    title: one ? `${names[0]} has a lorebook. Add it to your Lorebooks?` : `${withLore.length} of these cards have lorebooks. Add them to your Lorebooks?`,
    body: `${one ? 'It stays in the card either way.' : `${names.join(', ')}. They stay in their cards either way.`} In 📖 Lorebooks a lorebook can be used in every chat, a chat of its own or with a persona. You can add it later with 📖 To Lorebooks on the card's Lorebook tab.`,
    choices: [
      { value: 'yes', label: one ? 'Add it' : 'Add them' },
      { value: 'no', label: 'Not now' },
      { value: 'never', label: "Don't ask again" },
    ],
  });
  if (answer === 'never') {
    useLlmStore.getState().setChatSettings({ askLorebookImport: false });
    toast('Card lorebooks won\'t be offered on import. 📖 Lorebooks can turn it back on.', 'info');
    return;
  }
  if (answer !== 'yes') return;
  await loaded();
  const done: string[] = [];
  for (const i of withLore) {
    try {
      const b = await useLorebookStore.getState().importFromCard(i.projectId, i.card);
      if (b) done.push(bankName(b));
    } catch (err) {
      toast(`Couldn't add ${i.card.name || 'a card'}'s lorebook: ${(err as Error).message}`, 'error');
    }
  }
  if (done.length) toast(done.length === 1 ? `Added "${done[0]}" to Lorebooks.` : `Added ${done.length} lorebooks to Lorebooks.`, 'success');
}

/** A bank lorebook picker for a chat or a persona (one each, as in
 *  SillyTavern). */
export function LorebookSelect({ value, onChange, title, className }: { value: string | undefined; onChange: (id: string | undefined) => void; title?: string; className?: string }) {
  const books = useLorebookStore((s) => s.books);
  useEffect(ensureLorebooks, []);
  const missing = !!value && !books.some((b) => b.id === value);
  return (
    <select
      value={missing ? '' : (value ?? '')}
      title={title}
      onChange={async (e) => {
        const v = e.target.value;
        if (v === '__new') {
          const b = await createLorebook();
          if (b) {
            onChange(b.id);
            openLorebooks(b.id);
          }
        } else if (v === '__manage') openLorebooks(value);
        else onChange(v || undefined);
      }}
      className={cx(inputClass, 'py-1 text-xs', className)}
    >
      <option value="">None</option>
      {books.map((b) => (
        <option key={b.id} value={b.id}>
          {bankName(b)} ({b.book.entries.length})
        </option>
      ))}
      <option value="__new">+ New lorebook…</option>
      <option value="__manage">Manage lorebooks…</option>
    </select>
  );
}

/** Switches bank lorebooks on and off for every chat (SillyTavern's global
 *  World Info, any number of books). */
export function GlobalLorebooks() {
  const books = useLorebookStore((s) => s.books);
  const global = useLlmStore((s) => s.chatSettings.globalLorebooks) ?? [];
  const setChatSettings = useLlmStore((s) => s.setChatSettings);
  useEffect(ensureLorebooks, []);
  const toggle = (id: string) => setChatSettings({ globalLorebooks: global.includes(id) ? global.filter((g) => g !== id) : [...global, id] });
  if (!books.length)
    return (
      <span className="text-xs text-slate-500">
        No lorebooks yet.{' '}
        <button type="button" className="text-violet-300 hover:underline" onClick={() => openLorebooks()}>
          📖 Lorebooks
        </button>{' '}
        makes or imports them.
      </span>
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      {books.map((b) => {
        const on = global.includes(b.id);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => toggle(b.id)}
            title={on ? 'Used in every chat. Click to stop.' : 'Use it in every chat'}
            className={cx('rounded-full border px-2 py-0.5 text-xs', on ? 'border-violet-500/60 bg-violet-500/15 text-violet-200' : 'border-slate-700 text-slate-400 hover:text-slate-200')}
          >
            {on ? '🌐 ' : ''}
            {bankName(b)}
          </button>
        );
      })}
    </div>
  );
}

export function LorebooksDialog() {
  const { open, editing, set } = useLorebookDialog();
  const { books, flush } = useLorebookStore();
  const close = () => {
    void flush();
    set({ open: false });
  };
  const book = editing ? books.find((b) => b.id === editing) : undefined;
  return (
    <Modal
      open={open}
      onClose={close}
      size="xl"
      fixedHeight
      title={
        book ? (
          <span className="flex items-center gap-2">
            <button type="button" className="text-sm text-slate-400 hover:text-slate-200" onClick={() => (void flush(book.id), set({ open: true }))}>
              ← Lorebooks
            </button>
            <span className="truncate">/ {bankName(book)}</span>
          </span>
        ) : (
          '📖 Lorebooks'
        )
      }
    >
      {book ? <BookPage book={book} onDeleted={() => set({ open: true })} /> : <BankList onEdit={(id) => set({ open: true, editing: id })} />}
    </Modal>
  );
}

async function removeBook(b: BankLorebook) {
  const personas = usePersonaStore.getState().personas.filter((p) => p.lorebookId === b.id);
  const global = (useLlmStore.getState().chatSettings.globalLorebooks ?? []).includes(b.id);
  const uses = [global ? 'it\'s on for every chat' : '', personas.length ? `${personas.map((p) => p.name || 'Unnamed').join(', ')} use${personas.length === 1 ? 's' : ''} it` : ''].filter(Boolean).join(', and ');
  const ok = await confirmDialog({
    title: `Delete "${bankName(b)}"?`,
    body: `Its ${b.book.entries.length} entries go with it, for good.${uses ? ` Right now ${uses}.` : ''} Chats that use it simply stop. Cards keep their own lorebooks.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return false;
  try {
    await useLorebookStore.getState().remove(b.id);
    return true;
  } catch (err) {
    toast(`Couldn't delete it: ${(err as Error).message}`, 'error');
    return false;
  }
}

const exportBook = (b: BankLorebook) => downloadBlob(JSON.stringify(lorebookFile(b.book), null, 2), `${bankName(b)} lorebook.json`, 'application/json');

function BankList({ onEdit }: { onEdit: (id: string) => void }) {
  const { books, loaded, add } = useLorebookStore();
  const { chatSettings, setChatSettings } = useLlmStore();
  const personas = usePersonaStore((s) => s.personas);
  const chat = useChatStore((s) => s.chat);
  const [filter, setFilter] = useState('');
  const global = chatSettings.globalLorebooks ?? [];
  const q = filter.trim().toLowerCase();
  const shown = books.filter((b) => !q || bankName(b).toLowerCase().includes(q) || (b.book.description ?? '').toLowerCase().includes(q));
  const toggleGlobal = (id: string) => setChatSettings({ globalLorebooks: global.includes(id) ? global.filter((g) => g !== id) : [...global, id] });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        Lorebooks of their own, as SillyTavern&apos;s World Info list. Switch one on with 🌐 to use it in every chat, give a chat one of its own (🔧 Chat settings), or tie one to a persona (Settings → Personas). They&apos;re scanned together with the card&apos;s lorebook: the chat&apos;s entries first, then the persona&apos;s, the card&apos;s and the global ones, as SillyTavern orders them.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={async () => {
            const b = await createLorebook();
            if (b) onEdit(b.id);
          }}
        >
          + New lorebook
        </Button>
        <Button onClick={() => void importFiles()} title="Lorebook JSON (SillyTavern world files too) or the lorebook inside a card (PNG, JSON, CHARX); several at once">
          Import…
        </Button>
        {books.length > 6 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search lorebooks…" className={cx(inputClass, 'w-48 py-1 text-xs')} />}
        <span className="ml-auto">
          <Toggle
            checked={chatSettings.askLorebookImport !== false}
            onChange={(v) => setChatSettings({ askLorebookImport: v })}
            label={<span className="text-xs">Offer a card&apos;s lorebook when importing it</span>}
            title="As SillyTavern does: importing a card with a lorebook asks whether to add the lorebook here too"
          />
        </span>
      </div>
      {!loaded ? (
        <p className="text-sm text-slate-500">Reading…</p>
      ) : books.length === 0 ? (
        <Empty>No lorebooks yet. Make one, import a file, or add a card&apos;s with 📖 To Lorebooks on its Lorebook tab.</Empty>
      ) : (
        <div className="flex flex-col gap-1.5">
          {q && shown.length === 0 && <p className="text-xs text-slate-500">No lorebook matches “{filter}”.</p>}
          {shown.map((b) => {
            const on = global.includes(b.id);
            const users = personas.filter((p) => p.lorebookId === b.id);
            return (
              <div key={b.id} className={cx('flex items-center gap-2 rounded-md border px-3 py-2', on ? 'border-violet-500/50 bg-violet-500/5' : 'border-slate-800')}>
                <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => onEdit(b.id)}>
                  <span className="truncate text-sm text-slate-200">{bankName(b)}</span>
                  <span className="flex flex-wrap gap-x-2 text-[11px] text-slate-500">
                    <span>
                      {b.book.entries.length} entr{b.book.entries.length === 1 ? 'y' : 'ies'}
                    </span>
                    {b.fromCard && <span title="Its card's own chats skip this copy: they have the card's lorebook already">from {b.fromCard.name}</span>}
                    {users.length > 0 && <span className="text-sky-300/80">persona: {users.map((p) => p.name || 'Unnamed').join(', ')}</span>}
                    {chat?.lorebookId === b.id && <span className="text-emerald-300/80">this chat</span>}
                  </span>
                </button>
                <Button size="sm" variant={on ? 'primary' : 'secondary'} onClick={() => toggleGlobal(b.id)} title={on ? 'Used in every chat. Click to stop.' : 'Use it in every chat (global)'}>
                  {on ? '🌐 Global' : 'Global'}
                </Button>
                <IconButton title="Export (lorebook JSON)" onClick={() => exportBook(b)}>
                  ⬇
                </IconButton>
                <IconButton
                  title="Duplicate"
                  onClick={async () => {
                    const copy = await add(structuredClone({ ...b.book, name: `${bankName(b)} (copy)` }));
                    toast(`Made "${bankName(copy)}".`, 'success');
                  }}
                >
                  ⧉
                </IconButton>
                <IconButton title="Delete" tone="danger" onClick={() => void removeBook(b)}>
                  🗑
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BookPage({ book: b, onDeleted }: { book: BankLorebook; onDeleted: () => void }) {
  const setBook = useLorebookStore((s) => s.setBook);
  const books = useLorebookStore((s) => s.books);
  const fromCardStill = b.fromCard && copyFromCard(books, b.fromCard.projectId)?.id === b.id;
  return (
    <div className="flex flex-col gap-3">
      {fromCardStill && (
        <p className="rounded-md bg-slate-800/60 px-3 py-2 text-xs text-slate-400">
          A copy of {b.fromCard!.name}&apos;s lorebook. Changes here don&apos;t touch the card, and that card&apos;s own chats use the card&apos;s lorebook instead of this copy.
        </p>
      )}
      <LorebookEditor
        standalone
        book={b.book}
        setBook={(book) => setBook(b.id, book)}
        actions={
          <>
            <WizardButton size="sm" bankId={b.id} />
            <Button size="sm" onClick={() => exportBook(b)}>
              Export
            </Button>
            <IconButton
              title="Delete this lorebook"
              tone="danger"
              onClick={async () => {
                if (await removeBook(b)) onDeleted();
              }}
            >
              🗑
            </IconButton>
          </>
        }
      />
    </div>
  );
}
