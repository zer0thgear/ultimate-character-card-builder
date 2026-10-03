'use client';

import type { LlmConnection } from '@/types/llm';
import { allContext, allInstruct, useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { BUILTIN_CONTEXT, BUILTIN_INSTRUCT, exportContext, exportInstruct, parseTemplateFile } from '@/lib/textCompletion';
import { Button, IconButton, Toggle, confirmDialog, cx, downloadBlob, inputClass, pickFiles } from '@/components/ui';

// A connection's text completion: on or off, and the instruct and context
// templates it lays the prompt out with (SillyTavern's Advanced Formatting).

export function TextCompletionSettings({ connection: c }: { connection: LlmConnection }) {
  const { updateConnection, instructTemplates, contextTemplates, addTemplates, removeTemplate } = useLlmStore();
  if (c.kind === 'anthropic') return null;
  const instructs = allInstruct({ instructTemplates });
  const contexts = allContext({ contextTemplates });
  const instruct = instructs.find((t) => t.id === c.instructId) ?? BUILTIN_INSTRUCT[0];
  const context = contexts.find((t) => t.id === c.contextId) ?? BUILTIN_CONTEXT[0];
  const builtin = (id: string) => id.startsWith('builtin-');

  const importFiles = async () => {
    const files = await pickFiles('.json,application/json', true);
    let added = 0;
    for (const f of files) {
      try {
        const t = parseTemplateFile(JSON.parse(await f.text()));
        if (!t.instruct && !t.context) {
          toast(`"${f.name}" isn't an instruct or context template.`, 'error');
          continue;
        }
        addTemplates(t);
        updateConnection(c.id, { ...(t.instruct ? { instructId: t.instruct.id } : {}), ...(t.context ? { contextId: t.context.id } : {}) });
        added += (t.instruct ? 1 : 0) + (t.context ? 1 : 0);
      } catch (err) {
        toast(`Couldn't read "${f.name}": ${(err as Error).message}`, 'error');
      }
    }
    if (added) toast(`Imported ${added} template${added === 1 ? '' : 's'} and picked ${added === 1 ? 'it' : 'them'} for this connection.`, 'success');
  };
  const remove = async (kind: 'instruct' | 'context', id: string, name: string) => {
    if (!(await confirmDialog({ title: `Delete the template "${name}"?`, body: 'Connections using it go back to the built-in default.', confirmLabel: 'Delete', danger: true }))) return;
    removeTemplate(kind, id);
  };
  const save = (data: unknown, name: string) => downloadBlob(JSON.stringify(data, null, 4), `${name.replace(/[\\/:*?"<>|]+/g, '_')}.json`, 'application/json');

  const picker = (kind: 'instruct' | 'context') => {
    const list = kind === 'instruct' ? instructs : contexts;
    const current = kind === 'instruct' ? instruct : context;
    return (
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        {kind === 'instruct' ? 'Instruct template (turn markers)' : 'Context template (story string)'}
        <div className="flex gap-1">
          <select value={current.id} onChange={(e) => updateConnection(c.id, kind === 'instruct' ? { instructId: e.target.value } : { contextId: e.target.value })} className={cx(inputClass, 'py-1')}>
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {builtin(t.id) ? ' (built in)' : ''}
              </option>
            ))}
          </select>
          <IconButton title="Export it as SillyTavern's JSON" onClick={() => save(kind === 'instruct' ? exportInstruct(instruct) : exportContext(context), current.name)}>
            ⬇
          </IconButton>
          {!builtin(current.id) && (
            <IconButton title="Delete this imported template" tone="danger" onClick={() => void remove(kind, current.id, current.name)}>
              🗑
            </IconButton>
          )}
        </div>
      </label>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <Toggle
        checked={!!c.textCompletion}
        onChange={(textCompletion) => updateConnection(c.id, { textCompletion })}
        label={<span className="text-sm">Text completion (instruct template)</span>}
        title="For local models (KoboldCpp, llama.cpp, text-generation-webui, vLLM…): one text prompt sent to /completions, in the turn markers the model was trained on"
      />
      {c.textCompletion && (
        <>
          <p className="text-xs text-slate-500">
            The test chat and the assistant send one text prompt to <code>/completions</code>, laid out like SillyTavern&apos;s Advanced Formatting. A chat-completion preset&apos;s prompts aren&apos;t used with it (its samplers still are).
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {picker('instruct')}
            {picker('context')}
          </div>
          <div>
            <Button size="sm" onClick={() => void importFiles()} title="An instruct or context template, or a master export holding both">
              Import from SillyTavern…
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
