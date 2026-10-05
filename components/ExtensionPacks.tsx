'use client';

import { useState } from 'react';
import { usePackStore } from '@/store/packStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { PackError, describeContributions, describeUi, hasCode, newPermissions, packConflicts, packFileName, packFromEdits, packIdFrom, packJson, parsePack, type ExtensionPack, type InstalledPack } from '@/lib/extensionPack';
import { PERMISSIONS } from '@/lib/extensionSandbox';
import { SandboxFrame } from '@/components/extensions/SandboxFrame';
import { AutoTextarea, Button, Toggle, choiceDialog, confirmDialog, cx, downloadBlob, inputClass, pickFiles } from '@/components/ui';

// Settings → Extensions: extension packs (lib/extensionPack.ts). Install
// one from a file or pasted JSON, turn it on or off, share it, uninstall it;
// and turn your own prompt edits into a pack to share.

export function ExtensionPacks() {
  const { packs, install, setEnabled, setCodeApproved, remove } = usePackStore();
  const layerUi = usePackStore((s) => s.layer.ui);
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
    // Code, or more permissions than you approved before, is asked about.
    let code: boolean | undefined;
    const asks = newPermissions(pack, before);
    if (asks.newCode || (before?.codeApproved && (asks.permissions.length || asks.network.length))) {
      const choice = await choiceDialog({
        title: asks.newCode ? `${pack.name} runs code of its own` : `${pack.name} asks for more`,
        body: <CodeApproval pack={pack} />,
        choices: [
          { value: 'code', label: asks.newCode ? 'Install with its code' : 'Allow' },
          { value: 'nocode', label: asks.newCode ? 'Without its code' : "Don't run its code" },
        ],
      });
      if (choice === null) return false;
      code = choice === 'code';
    }
    try {
      await install(pack, code);
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
        Extension packs change what the writing assistant, the lorebook wizard and Adventure mode ask the model, add choices to them, and can add tabs, buttons and dialogs of their own (their code runs sandboxed, away from your API keys), without changing UCCB itself. A pack is one <code>.uccb.json</code> file: share it, install it here, and uninstall it to take everything it added away. Your own prompt edits always win over a pack&apos;s. How to write one: <code>docs/EXTENSIONS.md</code> in the UCCB folder.
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
                {(adds.length > 0 || !hasCode(pack)) && <p className="text-slate-500">Adds: {adds.length ? adds.join(', ') : 'nothing this version understands'}</p>}
                {hasCode(pack) && <CodeStatus installed={packs.find((p) => p.pack.id === pack.id)!} onApprove={(on) => void setCodeApproved(pack.id, on).catch((err: Error) => toast(err.message, 'error'))} />}
                {enabled &&
                  layerUi
                    .filter((u) => u.packId === pack.id && u.slot === 'settings')
                    .map((u) => (
                      <div key={u.id} className="mt-1 rounded border border-slate-800">
                        <SandboxFrame ui={u} />
                      </div>
                    ))}
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

/** What a pack's code may do, for approving it. */
function CodeApproval({ pack }: { pack: ExtensionPack }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        It runs in a sandbox: it can&apos;t see your API keys, your other cards or anything else in UCCB, except through what&apos;s listed here. Only install code from people you trust.
      </p>
      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase">It adds</div>
        <ul className="list-disc pl-5">
          {describeUi(pack).map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase">It may</div>
        <ul className="list-disc pl-5">
          {(pack.permissions ?? []).map((p) => (
            <li key={p}>{PERMISSIONS[p]}</li>
          ))}
          {!!pack.network?.length && <li>Connect to {pack.network.join(', ')} (and send them what it can read)</li>}
          {!pack.permissions?.length && !pack.network?.length && <li>Nothing beyond showing its own UI and keeping its own data</li>}
        </ul>
      </div>
    </div>
  );
}

/** An installed pack's code: what it may do, and turning it on or off. */
function CodeStatus({ installed, onApprove }: { installed: InstalledPack; onApprove: (on: boolean) => void }) {
  const { pack, codeApproved } = installed;
  return (
    <div className="flex flex-col gap-1 rounded bg-slate-900/60 p-2">
      <p className="text-slate-400">
        <span className="text-slate-300">Runs code</span> (sandboxed): {describeUi(pack).join(', ')}
      </p>
      <p className="text-slate-500">
        May: {[...(pack.permissions ?? []).map((p) => PERMISSIONS[p].split(' (')[0].toLowerCase()), ...(pack.network?.length ? [`connect to ${pack.network.join(', ')}`] : [])].join('; ') || 'only show its own UI and keep its own data'}
      </p>
      <div className="flex items-center gap-2">
        {codeApproved ? (
          <Button size="sm" variant="ghost" onClick={() => onApprove(false)}>
            Stop its code
          </Button>
        ) : (
          <>
            <span className="text-amber-300/90">Its code is off.</span>
            <Button size="sm" variant="ghost" onClick={async () => (await confirmDialog({ title: `Run ${pack.name}'s code?`, body: <CodeApproval pack={pack} />, confirmLabel: 'Run its code' })) && onApprove(true)}>
              Run its code…
            </Button>
          </>
        )}
      </div>
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
