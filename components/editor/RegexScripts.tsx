'use client';

import { useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { REGEX_PLACEMENT, cardRegexScripts, regexFromString, runRegexScripts, type RegexScript } from '@/lib/regexScripts';
import { expandMacros } from '@/lib/macros';
import { uuid } from '@/lib/uuid';
import { AutoTextarea, Button, ChipInput, Empty, IconButton, NumberInput, Section, Toggle, confirmDialog, cx, downloadBlob, inputClass, pickFiles } from '@/components/ui';

// The card's regex scripts (extensions.regex_scripts), as SillyTavern's
// Regex extension stores and runs them; see lib/regexScripts.ts.

type RawScript = Record<string, unknown>;

/** A new script, with SillyTavern's defaults: on the character's replies,
 *  for display and the prompt. */
const newScript = (): RawScript => ({
  id: uuid(),
  scriptName: '',
  findRegex: '',
  replaceString: '',
  trimStrings: [],
  placement: [REGEX_PLACEMENT.aiOutput],
  disabled: false,
  markdownOnly: false,
  promptOnly: false,
  runOnEdit: true,
  substituteRegex: 0,
  minDepth: null,
  maxDepth: null,
});

const PLACES: { value: number; label: string }[] = [
  { value: REGEX_PLACEMENT.userInput, label: 'Your messages' },
  { value: REGEX_PLACEMENT.aiOutput, label: "The character's messages" },
  { value: REGEX_PLACEMENT.worldInfo, label: 'Lorebook entries' },
];

export function RegexScriptsPanel() {
  const raw = useProjectStore((s) => (s.project?.card.data.extensions as { regex_scripts?: unknown } | undefined)?.regex_scripts);
  const card = useProjectStore((s) => s.project?.card.data);
  const updateCard = useProjectStore((s) => s.updateCard);
  const enabled = useLlmStore((s) => s.chatSettings.useCardRegex ?? true);
  const list = useMemo(() => (Array.isArray(raw) ? (raw.filter((s) => typeof s === 'object' && s !== null) as RawScript[]) : []), [raw]);
  const scripts = useMemo(() => cardRegexScripts({ extensions: { regex_scripts: list } }), [list]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (!card) return null;

  const setList = (next: RawScript[], key?: string) =>
    updateCard((d) => {
      const ext = { ...d.extensions } as Record<string, unknown>;
      if (next.length) ext.regex_scripts = next;
      else delete ext.regex_scripts;
      return { ...d, extensions: ext };
    }, key && `regex.${key}`);
  const setScript = (i: number, patch: RawScript, key?: string) => setList(list.map((s, j) => (j === i ? { ...s, ...patch } : s)), key && `${i}.${key}`);
  const toggle = (i: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const add = (more: RawScript[] = [newScript()]) => {
    setList([...list, ...more]);
    if (more.length === 1) setOpen((o) => new Set(o).add(list.length));
  };
  const remove = async (i: number) => {
    if (await confirmDialog({ title: `Delete "${scripts[i].scriptName || 'this script'}"?`, confirmLabel: 'Delete', danger: true })) setList(list.filter((_, j) => j !== i));
  };
  const importFile = async () => {
    const [file] = await pickFiles('.json');
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const found = (Array.isArray(parsed) ? parsed : [parsed]).filter((s): s is RawScript => typeof s === 'object' && s !== null && typeof (s as RawScript).findRegex === 'string');
      if (!found.length) return toast("That file has no regex scripts in it (SillyTavern's Regex → Export).", 'error');
      add(found.map((s) => ({ ...s, id: uuid() })));
      toast(`Added ${found.length} script${found.length === 1 ? '' : 's'}.`, 'success');
    } catch {
      toast("Couldn't read that file as JSON.", 'error');
    }
  };

  return (
    <Section
      title={`Regex scripts${list.length ? ` (${list.length})` : ''}`}
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => void importFile()} title="Import scripts exported from SillyTavern's Regex extension">
            Import
          </Button>
          {list.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => downloadBlob(JSON.stringify(list, null, 2), `${card.name || 'card'} regex.json`, 'application/json')} title="Save them as a file SillyTavern's Regex extension imports">
              Export
            </Button>
          )}
          <Button size="sm" onClick={() => add()}>
            + Script
          </Button>
        </>
      }
    >
      <p className="text-xs text-slate-500">
        Find-and-replace rules that travel with the card, as SillyTavern&apos;s Regex extension runs them: to hide a stat block, restyle replies, or tidy what the model is sent. The test chat runs them on what it shows and sends; the messages themselves stay as written.
        {!enabled && <span className="text-amber-300"> They&apos;re switched off in the chat&apos;s settings (🔧).</span>}
      </p>
      {list.length === 0 ? (
        <Empty>No scripts.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {scripts.map((s, i) => (
            <div key={i} className={cx('rounded-md border border-slate-800 bg-slate-900/60', s.disabled && 'opacity-60')}>
              <div className="flex items-center gap-1 px-2 py-1">
                <Toggle checked={!s.disabled} onChange={(v) => setScript(i, { disabled: !v })} title={s.disabled ? 'Off' : 'On'} />
                <button type="button" className="ml-1 flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggle(i)}>
                  <span className="text-xs text-slate-500">{open.has(i) ? '▾' : '▸'}</span>
                  <span className="truncate text-sm text-slate-200">{s.scriptName || <em className="text-slate-500">unnamed</em>}</span>
                  <span className="min-w-0 truncate font-mono text-xs text-slate-500">{s.findRegex}</span>
                  {s.findRegex && !regexFromString(s.findRegex) && <span className="text-xs text-red-300">bad pattern</span>}
                </button>
                <IconButton title="Delete script" tone="danger" onClick={() => void remove(i)}>
                  🗑
                </IconButton>
              </div>
              {open.has(i) && <ScriptEditor script={s} set={(patch, key) => setScript(i, patch, key)} />}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function ScriptEditor({ script: s, set }: { script: RegexScript; set: (patch: RawScript, key?: string) => void }) {
  const card = useProjectStore((st) => st.project?.card.data);
  const [sample, setSample] = useState('');
  const char = card?.nickname || card?.name || 'Character';
  const macros = (t: string) => expandMacros(t, { char, user: 'User' });
  const target = s.promptOnly ? 'prompt' : 'display';
  const result = sample ? runRegexScripts([{ ...s, disabled: false, placement: [REGEX_PLACEMENT.aiOutput] }], sample, { placement: REGEX_PLACEMENT.aiOutput, target, macros }) : '';
  const scope = s.markdownOnly ? 'display' : s.promptOnly ? 'prompt' : 'both';
  const togglePlace = (value: number, on: boolean) => set({ placement: on ? [...new Set([...s.placement, value])] : s.placement.filter((p) => p !== value) });
  return (
    <div className="flex flex-col gap-3 border-t border-slate-800 p-3">
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Name
        <input value={s.scriptName} onChange={(e) => set({ scriptName: e.target.value }, 'name')} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Find <span className="text-slate-500">(/pattern/flags; add g to replace every match)</span>
        <input value={s.findRegex} onChange={(e) => set({ findRegex: e.target.value }, 'find')} className={cx(inputClass, 'font-mono')} placeholder="/\[stats\][\s\S]*?\[\/stats\]/g" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Replace with <span className="text-slate-500">({'{{match}}'} is what was found, $1 its first group; macros work)</span>
        <AutoTextarea value={s.replaceString} onChange={(e) => set({ replaceString: e.target.value }, 'replace')} minRows={1} maxRows={8} className="font-mono" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Trim out <span className="text-slate-500">(taken out of the match before it&apos;s used)</span>
        <ChipInput values={s.trimStrings} onChange={(trimStrings) => set({ trimStrings })} placeholder="text to remove" />
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-slate-400">Runs on</span>
        {PLACES.map((p) => (
          <Toggle key={p.value} checked={s.placement.includes(p.value)} onChange={(v) => togglePlace(p.value, v)} label={<span className="text-xs">{p.label}</span>} />
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
          Changes
          <select value={scope} onChange={(e) => set({ markdownOnly: e.target.value === 'display', promptOnly: e.target.value === 'prompt' })} className={cx(inputClass, 'py-1')}>
            <option value="both">What&apos;s shown and what&apos;s sent</option>
            <option value="display">Only what&apos;s shown</option>
            <option value="prompt">Only what the model is sent</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-400" title="Whether {{char}} and other macros in the pattern are filled in first">
          Macros in Find
          <select value={s.substituteRegex} onChange={(e) => set({ substituteRegex: Number(e.target.value) })} className={cx(inputClass, 'py-1')}>
            <option value={0}>Left as written</option>
            <option value={1}>Filled in</option>
            <option value={2}>Filled in, escaped</option>
          </select>
        </label>
        <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="Only on messages at least this far from the end (0: the last)">
          Min depth
          <NumberInput value={s.minDepth ?? undefined} onChange={(v) => set({ minDepth: v ?? null })} min={-1} step={1} allowEmpty placeholder="—" />
        </label>
        <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="Only on messages at most this far from the end (0: the last)">
          Max depth
          <NumberInput value={s.maxDepth ?? undefined} onChange={(v) => set({ maxDepth: v ?? null })} min={0} step={1} allowEmpty placeholder="—" />
        </label>
      </div>
      <div className="flex flex-col gap-1 text-xs text-slate-400">
        Try it
        <AutoTextarea value={sample} onChange={(e) => setSample(e.target.value)} minRows={2} maxRows={8} placeholder="Paste a reply to see what this script makes of it…" />
        {sample && <div className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1.5 whitespace-pre-wrap text-slate-300">{result || <em className="text-slate-500">(nothing left)</em>}</div>}
      </div>
    </div>
  );
}
