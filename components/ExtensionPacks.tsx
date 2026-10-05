'use client';

import { useState } from 'react';
import { usePackStore } from '@/store/packStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { PackError, describeContributions, packConflicts, packFileName, packFromEdits, packIdFrom, packJson, parsePack, type ExtensionPack } from '@/lib/extensionPack';
import { AutoTextarea, Button, Toggle, confirmDialog, cx, downloadBlob, inputClass, pickFiles } from '@/components/ui';

// Settings → Extensions: extension packs (lib/extensionPack.ts). Install
// one from a file or pasted JSON, turn it on or off, share it, uninstall it;
// and turn your own prompt edits into a pack to share.

export function ExtensionPacks() {
  const { packs, install, setEnabled, remove } = usePackStore();
  const [paste, setPaste] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const conflicts = packConflicts(packs);
  const nameOf = (id: string) => packs.find((p) => p.pack.id === id)?.pack.name ?? id;

  const installText = async (text: string, source: string) => {
    let read: { pack: ExtensionPack; warnings: string[] };
    try {
      read = parsePack(text);
    } catch (err) {
      toast(`${source}: ${err instanceof PackError ? err.message : (err as Error).message}`, 'error');
      return false;
    }
    const { pack, warnings } = read;
    const before = packs.find((p) => p.pack.id === pack.id);
    if (before) {
      const ok = await confirmDialog({
        title: `Update ${before.pack.name}?`,
        body: `It's installed already (version ${before.pack.version}); this is version ${pack.version}. Its place in the order and whether it's on stay as they are.`,
        confirmLabel: 'Update',
      });
      if (!ok) return false;
    }
    try {
      await install(pack);
    } catch (err) {
      toast((err as Error).message, 'error');
      return false;
    }
    toast(`${before ? 'Updated' : 'Installed'} ${pack.name}${warnings.length ? ` (${warnings.length} note${warnings.length === 1 ? '' : 's'}: ${warnings.join(' ')})` : ''}`, warnings.length ? 'info' : 'success');
    return true;
  };

  const importFiles = async () => {
    for (const f of await pickFiles('.json,application/json', true)) await installText(await f.text(), f.name);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400">
        Extension packs change what the writing assistant, the lorebook wizard and Adventure mode ask the model, and add choices to them, without changing UCCB itself. A pack is one <code>.uccb.json</code> file: share it, install it here, and uninstall it to take everything it added away. Your own prompt edits always win over a pack&apos;s. How to write one: <code>docs/EXTENSIONS.md</code> in the UCCB folder.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => void importFiles()}>
          📂 Install from file…
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPaste(paste === null ? '' : null)}>
          📋 Paste a pack
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSharing((v) => !v)}>
          🧩 Share my prompt edits as a pack…
        </Button>
      </div>
      {paste !== null && (
        <div className="flex flex-col gap-1.5">
          <AutoTextarea aria-label="Pack JSON" value={paste} onChange={(e) => setPaste(e.target.value)} minRows={4} maxRows={14} placeholder='{ "uccb": 1, "id": "…", "name": "…", "contributes": { … } }' className={cx(inputClass, 'font-mono text-xs')} />
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" disabled={!paste.trim()} onClick={async () => (await installText(paste, 'Pasted pack')) && setPaste(null)}>
              Install
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPaste(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {sharing && <SharePack onDone={() => setSharing(false)} />}

      {packs.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500">No extension packs installed.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {packs.map(({ pack, enabled }) => {
            const adds = describeContributions(pack.contributes);
            const clash = conflicts[pack.id];
            return (
              <li key={pack.id} className={cx('flex flex-col gap-1 rounded-md border border-slate-800 p-2.5 text-xs', !enabled && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">🧩 {pack.name}</span>
                  <span className="text-slate-500">
                    v{pack.version}
                    {pack.author && ` · by ${pack.author}`}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <Toggle checked={enabled} onChange={(on) => void setEnabled(pack.id, on).catch((err: Error) => toast(err.message, 'error'))} label="On" />
                    <Button size="sm" variant="ghost" title="Save it as a file to share" onClick={() => downloadBlob(packJson(pack), packFileName(pack), 'application/json')}>
                      ⬇ Export
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-300"
                      onClick={async () => {
                        if (!(await confirmDialog({ title: `Uninstall ${pack.name}?`, body: 'Everything it added goes away: its prompts go back to yours or the built-in ones, and its choices leave the wizards. Actors or rules you already added from it stay.', confirmLabel: 'Uninstall', danger: true }))) return;
                        try {
                          await remove(pack.id);
                          toast(`Uninstalled ${pack.name}`, 'success');
                        } catch (err) {
                          toast((err as Error).message, 'error');
                        }
                      }}
                    >
                      Uninstall
                    </Button>
                  </span>
                </div>
                {pack.description && <p className="text-slate-400">{pack.description}</p>}
                <p className="text-slate-500">Adds: {adds.length ? adds.join(', ') : 'nothing this version understands'}</p>
                {clash && <p className="text-amber-300/90">Changes some of the same prompts as {clash.map(nameOf).join(', ')}; the one installed last wins.</p>}
                {pack.homepage && (
                  <a href={pack.homepage} target="_blank" rel="noreferrer noopener" className="self-start text-sky-400 hover:underline">
                    More about it ↗
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Your prompt edits and Adventure actors, saved as a pack file. */
function SharePack({ onDone }: { onDone: () => void }) {
  const templates = useLlmStore((s) => s.assistSettings.templates ?? {});
  const adventure = useLlmStore((s) => s.adventureSettings);
  const actors = (adventure.customActors ?? []).filter((a) => a.name.trim() && a.prompt.trim());
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [use, setUse] = useState({ templates: true, adventure: true, actors: true });
  const counts = { templates: Object.keys(templates).length, adventure: Object.keys(adventure.prompts ?? {}).length, actors: actors.length };
  const pack = packFromEdits(
    { name: name || 'My pack', author, description },
    { templates: use.templates ? templates : undefined, adventurePrompts: use.adventure ? adventure.prompts : undefined, actors: use.actors ? actors : undefined },
  );
  const empty = !describeContributions(pack.contributes).length;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-2.5 text-xs">
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-slate-400">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My prompts" className={inputClass} />
        </label>
        <label className="flex min-w-36 flex-col gap-1 text-slate-400">
          Author (optional)
          <input value={author} onChange={(e) => setAuthor(e.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-slate-400">
        What it does (optional)
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
      </label>
      <Toggle checked={use.templates} disabled={!counts.templates} onChange={(templates) => setUse({ ...use, templates })} label={`My edited assistant prompts (${counts.templates})`} />
      <Toggle checked={use.adventure} disabled={!counts.adventure} onChange={(a) => setUse({ ...use, adventure: a })} label={`My edited Adventure prompts (${counts.adventure})`} />
      <Toggle checked={use.actors} disabled={!counts.actors} onChange={(a) => setUse({ ...use, actors: a })} label={`My Adventure actors (${counts.actors})`} />
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="primary"
          disabled={empty}
          onClick={() => {
            downloadBlob(packJson(pack), packFileName(pack), 'application/json');
            onDone();
          }}
        >
          ⬇ Save {packIdFrom(name || 'My pack')}.uccb.json
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {empty && <span className="text-slate-500">Nothing to share yet: edit a prompt or add an actor first.</span>}
      </div>
    </div>
  );
}
