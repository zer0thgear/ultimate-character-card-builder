'use client';

import { useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { CardTextField, useCardField, useWritingTools } from '@/components/editor/fieldTools';
import { SourceList } from '@/components/CardSource';
import { AppTagEditor } from '@/components/AppTags';
import { RegexScriptsPanel } from '@/components/editor/RegexScripts';
import { AutoTextarea, Button, ChipInput, NumberInput, Section, TokenBadge, Toggle, confirmDialog, cx, inputClass } from '@/components/ui';
import { ConnectionPicker } from '@/components/llm/ConnectionPicker';
import { useLlmStream } from '@/hooks/useLlmStream';
import { cardTagsMessages, critiqueMessages } from '@/lib/assist';
import { findPattern, findReplace, nameToMacro, purgeAsterisks, straightenQuotes, tidyWhitespace, type ToolResult } from '@/lib/textTools';
import { CHARACTER_NOTE_PATH, fieldLabel, listTextFields, type FieldGroup } from '@/lib/cardPath';
import { useTextTokens, formatTokens } from '@/lib/textTokens';
import { buildChatPrompt } from '@/lib/chatPrompt';
import { AssistReasoning, AssistTraceButton } from '@/components/llm/AssistTrace';

// ─── Prompts ─────────────────────────────────────────────────────────────────

export function PromptsPanel() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-slate-500">
        Both replace the frontend&apos;s own defaults when the user allows it. Write <code className="text-slate-300">{'{{original}}'}</code> to include the default where you want it.
      </p>
      <CardTextField path="system_prompt" label="System prompt" hint="Replaces the main prompt" minRows={5} />
      <CardTextField path="post_history_instructions" label="Post-history instructions" hint="Sent after the chat (UJB)" minRows={4} />
      <CharacterNote />
      <RegexScriptsPanel />
    </div>
  );
}

/** SillyTavern's Character's Note: kept in the card (extensions.depth_prompt)
 *  and sent in the chat at its depth with every reply. Unlike a chat's
 *  author's note, it goes wherever the card goes. */
function CharacterNote() {
  const note = useProjectStore((s) => (s.project?.card.data.extensions as { depth_prompt?: { depth?: unknown; role?: unknown } } | undefined)?.depth_prompt);
  const updateCard = useProjectStore((s) => s.updateCard);
  const depth = typeof note?.depth === 'number' ? note.depth : 4;
  const role = note?.role === 'user' || note?.role === 'assistant' ? note.role : 'system';
  const set = (patch: { depth?: number; role?: string }, key: string) =>
    updateCard((d) => {
      const ext = d.extensions as { depth_prompt?: Record<string, unknown> };
      return { ...d, extensions: { ...d.extensions, depth_prompt: { prompt: '', depth: 4, role: 'system', ...ext.depth_prompt, ...patch } } };
    }, `depth_prompt.${key}`);
  return (
    <div className="flex flex-col gap-2">
      <CardTextField path={CHARACTER_NOTE_PATH} label="Character's note" hint="Sent at a specified depth" minRows={3} />
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex w-28 flex-col gap-0.5 text-xs text-slate-400" title="Messages from the end of the chat: 0 goes after the last one">
          Depth
          <NumberInput value={depth} onChange={(v) => set({ depth: v ?? 4 }, 'depth')} min={0} step={1} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
          Role
          <select value={role} onChange={(e) => set({ role: e.target.value }, 'role')} className={cx(inputClass, 'py-1')}>
            <option value="system">System</option>
            <option value="user">User</option>
            <option value="assistant">Assistant</option>
          </select>
        </label>
      </div>
    </div>
  );
}

// ─── Creator metadata ────────────────────────────────────────────────────────

export function CreatorPanel() {
  const card = useProjectStore((s) => s.project?.card.data);
  const projectId = useProjectStore((s) => s.project?.id);
  const updateCard = useProjectStore((s) => s.updateCard);
  const [creator, setCreator] = useCardField('creator');
  const [version, setVersion] = useCardField('character_version');
  const { assistConnectionId, setAssistConnection } = useLlmStore();
  const { runAssist, runId, running } = useLlmStream();
  // The ✨ tag writer is Builder's (Chat mode's card drawer shows this too).
  const writing = useWritingTools();
  if (!card) return null;
  const suggestTags = async () => {
    const r = await runAssist(cardTagsMessages(card), undefined, '✨ Card tags');
    if (r.error) return toast(r.error, 'error');
    const tags = r.text.split(',').map((t) => t.trim().replace(/^["'#]|["'.]$/g, '').toLowerCase()).filter(Boolean);
    updateCard((d) => ({ ...d, tags: [...new Set([...d.tags, ...tags])] }));
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-semibold tracking-wide text-slate-300 uppercase">
          Creator
          <input value={creator} onChange={(e) => setCreator(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold tracking-wide text-slate-300 uppercase">
          Character version
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 1.0" className={inputClass} />
        </label>
      </div>
      <Section
        title="Tags"
        actions={
          writing && (
            <>
              <AssistTraceButton runId={runId} />
              <Button size="sm" disabled={running} onClick={() => void suggestTags()} title="Ask the assistant for tags">
                {running ? 'Thinking…' : '✨ Suggest'}
              </Button>
            </>
          )
        }
      >
        <ChipInput values={card.tags} onChange={(tags) => updateCard((d) => ({ ...d, tags }))} placeholder="Type a tag and press Enter" />
        {writing && <ConnectionPicker value={assistConnectionId} onChange={setAssistConnection} label="Assistant connection" />}
      </Section>
      {projectId && (
        <Section title="My tags" actions={<span className="text-[11px] text-slate-500 normal-case">yours, not written into the card</span>}>
          <AppTagEditor cardId={projectId} cardTags={card.tags} />
        </Section>
      )}
      <CardTextField path="creator_notes" label="Creator's notes" hint="Shown to people, not the model" minRows={5} />
      {/* Read-only: the V3 spec leaves recording it to the app (Import from
          URL adds the link it came from). */}
      <Section title="Source (V3)" actions={<span className="text-[11px] text-slate-500 normal-case">recorded on import, not edited</span>}>
        <SourceList source={card.source} />
      </Section>
      <Stats />
    </div>
  );
}

function Stats() {
  const card = useProjectStore((s) => s.project?.card.data);
  const settings = useLlmStore((s) => s.chatSettings);
  // What a chat sends before the first reply: the permanent part of the card.
  const permanent = useMemo(() => (card ? buildChatPrompt({ ...card, first_mes: '' }, [], { ...settings, useLorebook: false }).parts.map((p) => p.content).join('\n\n') : ''), [card, settings]);
  const tokens = useTextTokens(permanent, 500);
  if (!card) return null;
  return (
    <Section title="Size">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Permanent tokens" value={formatTokens(tokens)} hint="Main prompt, description, personality, scenario and examples: what every message carries" />
        <Stat label="Greetings" value={String(1 + card.alternate_greetings.length)} />
        <Stat label="Lorebook entries" value={String(card.character_book?.entries.length ?? 0)} />
        <Stat label="Group greetings" value={String(card.group_only_greetings.length)} />
      </div>
    </Section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md bg-slate-900 px-3 py-2" title={hint}>
      <div className="text-lg font-semibold text-slate-100 tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export function NotesPanel() {
  const notes = useProjectStore((s) => s.project?.notes ?? '');
  const setNotes = useProjectStore((s) => s.setNotes);
  const card = useProjectStore((s) => s.project?.card.data);
  const { assistConnectionId, setAssistConnection } = useLlmStore();
  const { runAssist, runId, stop, text, running, error } = useLlmStream();
  return (
    <div className="flex flex-col gap-5">
      <Section title="Notes" actions={<TokenBadge text={notes} />}>
        <p className="text-xs text-slate-500">Yours alone: ideas, todo, what the art should show. Saved with the project, never exported.</p>
        <AutoTextarea value={notes} onChange={(e) => setNotes(e.target.value)} minRows={10} maxRows={40} />
      </Section>
      <Section
        title="Card review"
        actions={
          running ? (
            <Button size="sm" variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" disabled={!card} onClick={() => card && void runAssist(critiqueMessages(card), undefined, '✨ Card review')}>
              ✨ Review the card
            </Button>
          )
        }
      >
        <ConnectionPicker value={assistConnectionId} onChange={setAssistConnection} label="Assistant connection" />
        {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
        <AssistReasoning runId={runId} />
        {text && (
          <>
            <div className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm whitespace-pre-wrap text-slate-300">{text}</div>
            {!running && (
              <Button size="sm" className="self-start" onClick={() => setNotes(`${notes.trim()}\n\n--- Review ---\n${text.trim()}`.trim())}>
                Add to notes
              </Button>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

// ─── Tools (macros) ──────────────────────────────────────────────────────────

const GROUPS: { value: FieldGroup; label: string }[] = [
  { value: 'character', label: 'Character fields' },
  { value: 'greetings', label: 'Greetings' },
  { value: 'prompts', label: 'Prompts' },
  { value: 'lorebook', label: 'Lorebook' },
  { value: 'creator', label: "Creator's notes" },
];

export function ToolsPanel() {
  const card = useProjectStore((s) => s.project?.card.data);
  const updateCard = useProjectStore((s) => s.updateCard);
  const [groups, setGroups] = useState<FieldGroup[]>(['character', 'greetings', 'lorebook']);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  const preview = useMemo(() => {
    if (!card || !find) return null;
    return findReplace(card, { find, replace, regex, caseSensitive, wholeWord, groups });
  }, [card, find, replace, regex, caseSensitive, wholeWord, groups]);
  const patternError = find ? findPattern({ find, regex, caseSensitive, wholeWord }) : null;

  if (!card) return null;

  const applyTool = async (name: string, result: ToolResult) => {
    if (result.total === 0) return toast(`${name}: nothing to change.`);
    const where = Object.entries(result.changes).map(([p, n]) => `${fieldLabel(card, p)} (${n})`);
    const ok = await confirmDialog({
      title: `${name}?`,
      body: (
        <>
          {result.total} change{result.total === 1 ? '' : 's'} in {where.length} field{where.length === 1 ? '' : 's'}:
          <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-5 text-xs text-slate-400">
            {where.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Undo reverses it.</p>
        </>
      ),
      confirmLabel: 'Apply',
    });
    if (ok) {
      void useProjectStore.getState().keepVersion('macro');
      updateCard(() => result.data);
      toast(`${name}: ${result.total} change${result.total === 1 ? '' : 's'}.`, 'success');
    }
  };

  const toggleGroup = (g: FieldGroup) => setGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]);
  const fields = listTextFields(card).filter((f) => groups.includes(f.group));

  return (
    <div className="flex flex-col gap-6">
      <Section title="Work on">
        <div className="flex flex-wrap gap-2">
          {GROUPS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => toggleGroup(g.value)}
              className={cx('rounded-md px-2.5 py-1 text-xs', groups.includes(g.value) ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700')}
            >
              {g.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">{fields.length} fields.</p>
      </Section>

      <Section title="Find and replace">
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find" className={cx(inputClass, typeof patternError === 'string' && find && 'border-red-500')} />
          <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder={regex ? 'Replace ($1 for groups)' : 'Replace with'} className={inputClass} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Toggle checked={caseSensitive} onChange={setCaseSensitive} label={<span className="text-xs">Match case</span>} />
          <Toggle checked={wholeWord} onChange={setWholeWord} label={<span className="text-xs">Whole words</span>} />
          <Toggle checked={regex} onChange={setRegex} label={<span className="text-xs">Regex</span>} />
          <span className="ml-auto text-xs text-slate-400">
            {typeof preview === 'string' ? <span className="text-red-400">{preview}</span> : preview ? `${preview.total} match${preview.total === 1 ? '' : 'es'}` : ''}
          </span>
          <Button size="sm" variant="primary" disabled={!preview || typeof preview === 'string' || preview.total === 0} onClick={() => preview && typeof preview !== 'string' && void applyTool('Replace all', preview)}>
            Replace all
          </Button>
        </div>
        {preview && typeof preview !== 'string' && preview.total > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(preview.changes).map(([p, n]) => (
              <span key={p} className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
                {fieldLabel(card, p)} · {n}
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="Clean-up">
        <div className="grid gap-2 sm:grid-cols-2">
          <ToolButton title="Name → {{char}}" hint={`Replace “${card.name || 'the name'}” with {{char}}, so renames and nicknames just work`} onClick={() => void applyTool('Name → {{char}}', nameToMacro(card, groups))} />
          <ToolButton title="Purge asterisks" hint="*action* → action. Only paired asterisks on one line" onClick={() => void applyTool('Purge asterisks', purgeAsterisks(card, groups))} />
          <ToolButton title="Straighten quotes" hint="“curly” quotes and apostrophes → straight ones" onClick={() => void applyTool('Straighten quotes', straightenQuotes(card, groups))} />
          <ToolButton title="Tidy whitespace" hint="Trailing spaces and runs of blank lines" onClick={() => void applyTool('Tidy whitespace', tidyWhitespace(card, groups))} />
        </div>
      </Section>
    </div>
  );
}

function ToolButton({ title, hint, onClick }: { title: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-left hover:border-violet-500/50 hover:bg-slate-800">
      <div className="text-sm text-slate-200">{title}</div>
      <div className="text-xs text-slate-500">{hint}</div>
    </button>
  );
}
