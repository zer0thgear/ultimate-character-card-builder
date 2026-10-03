'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ProjectSummary, TrashedProject } from '@/types/project';
import { api } from '@/lib/api';
import { useProjectStore } from '@/store/projectStore';
import { toast } from '@/store/uiStore';
import { Button, Empty, IconButton, Modal, choiceDialog, confirmDialog } from '@/components/ui';

// Deleted cards wait in data/trash until they're restored or the trash is
// emptied; and a card can be copied to try a variant on.

const useTrashDialog = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

export const openTrash = () => useTrashDialog.getState().set(true);

/** Asks what to copy, then copies the card and opens the copy. */
export async function duplicateCard(s: Pick<ProjectSummary, 'id' | 'name' | 'chats'>) {
  const name = s.name || 'Unnamed';
  const which = s.chats
    ? await choiceDialog({
        title: `Duplicate "${name}"?`,
        body: 'The copy gets the card, its picture, notes, art prompts and kept gens. Its version history stays with this one.',
        choices: [
          { value: 'card', label: 'Without its chats' },
          { value: 'chats', label: `With its ${s.chats} chat${s.chats === 1 ? '' : 's'}` },
        ],
      })
    : (await confirmDialog({ title: `Duplicate "${name}"?`, body: 'The copy gets the card, its picture, notes, art prompts and kept gens.', confirmLabel: 'Duplicate' }))
      ? 'card'
      : null;
  if (!which) return;
  try {
    const p = await useProjectStore.getState().duplicate(s.id, which === 'chats');
    toast(`Opened the copy: "${p.card.data.name || 'Unnamed'}".`, 'success');
  } catch (err) {
    toast(`Couldn't duplicate it: ${(err as Error).message}`, 'error');
  }
}

const ago = (t: number) => {
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString([], { dateStyle: 'medium' });
};

export function TrashDialog() {
  const { open, set } = useTrashDialog();
  const [items, setItems] = useState<TrashedProject[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api.listTrash().then(
      (list) => live && setItems(list),
      (err: Error) => live && (toast(`Couldn't read the trash: ${err.message}`, 'error'), setItems([])),
    );
    return () => {
      live = false;
      setItems(null);
    };
  }, [open]);
  if (!open) return null;
  const close = () => set(false);
  const restore = async (t: TrashedProject) => {
    setBusy(true);
    try {
      const p = await useProjectStore.getState().restore(t.entry);
      toast(`Restored "${p.card.data.name || 'Unnamed'}".`, 'success');
      close();
    } catch (err) {
      toast(`Couldn't restore it: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const forget = async (t: TrashedProject) => {
    if (!(await confirmDialog({ title: `Delete "${t.name || 'Unnamed'}" for good?`, body: 'Its card, kept gens and chats are deleted. This can’t be undone.', confirmLabel: 'Delete for good', danger: true }))) return;
    await api.deleteFromTrash(t.entry);
    setItems((list) => list?.filter((x) => x.entry !== t.entry) ?? null);
  };
  const emptyAll = async () => {
    if (!items?.length) return;
    if (!(await confirmDialog({ title: `Empty the trash?`, body: `${items.length} card${items.length === 1 ? '' : 's'}, with their kept gens and chats, are deleted for good. This can’t be undone.`, confirmLabel: 'Empty the trash', danger: true }))) return;
    await api.emptyTrash();
    setItems([]);
  };
  return (
    <Modal
      open
      onClose={close}
      title="🗑 Trash"
      size="lg"
      footer={
        <>
          {!!items?.length && (
            <Button variant="danger" className="mr-auto" onClick={() => void emptyAll()}>
              Empty the trash
            </Button>
          )}
          <Button onClick={close}>Close</Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-slate-500">Deleted cards stay here, with their kept gens and chats, until you restore them or empty the trash.</p>
      {items === null ? (
        <p className="text-sm text-slate-500">Looking…</p>
      ) : items.length === 0 ? (
        <Empty>The trash is empty.</Empty>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((t) => (
            <div key={t.entry} className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1.5">
              <span className="h-12 w-8 flex-shrink-0 overflow-hidden rounded bg-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.hasAvatar && <img src={api.trashAvatarUrl(t.entry)} alt="" className="h-full w-full object-cover" loading="lazy" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-200">{t.name || <em className="text-slate-500">Unnamed</em>}</span>
                <span className="block text-xs text-slate-500">
                  Deleted {ago(t.deletedAt)}
                  {t.chats ? ` · ${t.chats} chat${t.chats === 1 ? '' : 's'}` : ''}
                </span>
              </span>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void restore(t)}>
                Restore
              </Button>
              <IconButton title="Delete for good" tone="danger" disabled={busy} onClick={() => void forget(t)}>
                ✕
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
