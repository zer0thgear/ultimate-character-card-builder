'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { CardVersion, CardVersionInfo } from '@/types/project';
import { api } from '@/lib/api';
import { useProjectStore } from '@/store/projectStore';
import { toast, useConfigStore } from '@/store/uiStore';
import { cardChanges, diffText } from '@/lib/textDiff';
import { versionTitle } from '@/lib/versionHistory';
import { Button, Empty, IconButton, Modal, NumberInput, Toggle, confirmDialog, cx, textDialog } from '@/components/ui';

// 🕘 The open card's earlier versions (lib/versionHistory.ts says when
// they're kept): what changed since each, restore one (undo takes it
// back), name or delete one, or keep the card as it is now.

const useVersionsDialog = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

export const openVersions = () => useVersionsDialog.getState().set(true);

/** On or off, and how many to keep: Settings → General, and the dialog. */
export function VersionHistorySettings() {
  const { config, update } = useConfigStore();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Toggle checked={config.versionHistory} onChange={(versionHistory) => void update({ versionHistory })} label={<span className="text-sm">Keep earlier versions of each card</span>} />
      {config.versionHistory && (
        <label className="flex items-center gap-2 text-sm text-slate-300" title="Past this, the oldest versions without a name are deleted; named ones are kept">
          Keep
          <NumberInput value={config.versionsToKeep} onChange={(v) => v && void update({ versionsToKeep: v })} min={1} max={500} step={5} className="w-20" />
          per card
        </label>
      )}
    </div>
  );
}

const when = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export function VersionsDialog() {
  const { open, set } = useVersionsDialog();
  const project = useProjectStore((s) => s.project);
  const historyOn = useConfigStore((s) => s.config.versionHistory);
  const [list, setList] = useState<CardVersionInfo[] | null>(null);
  const [picked, setPicked] = useState<CardVersion | null>(null);
  const id = project?.id;
  // Bumped to read the list again after a change.
  const [reads, setReads] = useState(0);
  const load = () => setReads((n) => n + 1);
  useEffect(() => {
    if (!open || !id) return;
    let live = true;
    api.listVersions(id).then(
      (l) => live && setList(l),
      (err: Error) => {
        if (!live) return;
        toast(`Couldn't read the card's versions: ${err.message}`, 'error');
        setList([]);
      },
    );
    return () => {
      live = false;
    };
  }, [open, id, reads]);
  useEffect(() => {
    if (open) return;
    return () => {
      setList(null);
      setPicked(null);
    };
  }, [open]);
  if (!open || !project) return null;
  const close = () => set(false);

  const saveNow = async () => {
    const label = await textDialog({ title: 'Save this version', label: 'Name (named versions are never deleted to make room)', placeholder: 'e.g. before the rewrite', confirmLabel: 'Save' });
    if (label === null) return;
    const v = await useProjectStore.getState().keepVersion('manual', label.trim() || 'Saved by hand');
    if (v) toast('Saved this version.', 'success');
    load();
  };
  const pick = async (v: CardVersionInfo) => {
    try {
      setPicked(await api.getVersion(project.id, v.id));
    } catch (err) {
      toast(`Couldn't open it: ${(err as Error).message}`, 'error');
    }
  };
  const restore = async (v: CardVersion) => {
    const ok = await confirmDialog({
      title: `Restore "${versionTitle(v)}"?`,
      body: `The card's text goes back to how it was on ${when(v.createdAt)}. The card as it is now is kept as a version first, and undo (↶) brings it straight back. Its picture, gens and chats aren't touched.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    useProjectStore.getState().replaceCard(structuredClone(v.card), 'restore');
    toast('Restored. ↶ Undo takes it back.', 'success');
    close();
  };
  const rename = async (v: CardVersionInfo) => {
    const label = await textDialog({ title: 'Name this version', label: 'Name (empty: no name)', initial: v.label ?? '', confirmLabel: 'Save' });
    if (label === null) return;
    await api.renameVersion(project.id, v.id, label);
    load();
  };
  const remove = async (v: CardVersionInfo) => {
    if (!(await confirmDialog({ title: `Delete "${versionTitle(v)}"?`, confirmLabel: 'Delete', danger: true }))) return;
    await api.deleteVersion(project.id, v.id);
    if (picked?.id === v.id) setPicked(null);
    load();
  };

  return (
    <Modal
      open
      onClose={close}
      title="🕘 Versions of this card"
      size="xl"
      footer={
        <>
          <div className="mr-auto">
            <VersionHistorySettings />
          </div>
          <Button onClick={close}>Close</Button>
        </>
      }
    >
      <div className="flex min-h-0 gap-4 phone:flex-col">
        <div className="flex w-72 flex-shrink-0 flex-col gap-2 phone:w-full">
          <Button variant="primary" onClick={() => void saveNow()}>
            Save this version…
          </Button>
          <p className="text-xs text-slate-500">
            {historyOn ? 'Kept automatically at the start of each editing session (after 30 minutes without an edit) and before changes to many fields at once: an overwrite, a macro, the assistant’s Replace.' : 'Automatic versions are off; ones you save by hand are still kept.'}
          </p>
          {list === null ? (
            <p className="text-sm text-slate-500">Looking…</p>
          ) : list.length === 0 ? (
            <Empty>No earlier versions yet.</Empty>
          ) : (
            <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
              {list.map((v) => (
                <div key={v.id} className={cx('group flex items-center gap-1 rounded-md border px-2 py-1.5', picked?.id === v.id ? 'border-violet-500 bg-violet-500/10' : 'border-slate-800 bg-slate-900/60 hover:border-slate-600')}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void pick(v)}>
                    <span className={cx('block truncate text-sm', v.label ? 'text-slate-100' : 'text-slate-300')}>
                      {v.label ? '★ ' : ''}
                      {versionTitle(v)}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {when(v.createdAt)}
                      {v.name && v.name !== project.card.data.name ? ` · "${v.name}"` : ''}
                    </span>
                  </button>
                  <IconButton title="Name it" className="opacity-0 group-hover:opacity-100 touch:opacity-100" onClick={() => void rename(v)}>
                    ✎
                  </IconButton>
                  <IconButton title="Delete it" tone="danger" className="opacity-0 group-hover:opacity-100 touch:opacity-100" onClick={() => void remove(v)}>
                    🗑
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">{picked ? <VersionDiff version={picked} onRestore={() => void restore(picked)} /> : <p className="text-sm text-slate-500">Pick a version to see what&apos;s changed since.</p>}</div>
      </div>
    </Modal>
  );
}

function VersionDiff({ version, onRestore }: { version: CardVersion; onRestore: () => void }) {
  const current = useProjectStore((s) => s.project?.card.data);
  if (!current) return null;
  const changes = cardChanges(version.card.data, current);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-slate-300">
          From {when(version.createdAt)} to now: {changes.length ? `${changes.length} field${changes.length === 1 ? '' : 's'} changed` : 'nothing has changed'}
        </span>
        <Button variant="primary" size="sm" disabled={!changes.length} onClick={onRestore}>
          Restore this version
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        <span className="rounded bg-red-500/20 px-1 text-red-200 line-through">Struck out</span> is in that version and not now; <span className="rounded bg-emerald-500/20 px-1 text-emerald-200">highlighted</span> was added since.
      </p>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
        {changes.map((c) => (
          <div key={c.label} className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
            <div className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">{c.label}</div>
            {c.before || c.after ? (
              <div className="text-sm leading-relaxed whitespace-pre-wrap text-slate-300">
                {diffText(c.before, c.after).map((p, i) =>
                  p.kind === 'same' ? (
                    <span key={i}>{p.text}</span>
                  ) : p.kind === 'removed' ? (
                    <span key={i} className="rounded bg-red-500/20 text-red-200 line-through">
                      {p.text}
                    </span>
                  ) : (
                    <span key={i} className="rounded bg-emerald-500/20 text-emerald-200">
                      {p.text}
                    </span>
                  ),
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Changed (restoring brings them back as they were).</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
