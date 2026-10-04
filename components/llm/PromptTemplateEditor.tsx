'use client';

import type { ReactNode } from 'react';
import type { AssistTemplate } from '@/lib/assist';
import { AutoTextarea, Button, confirmDialog } from '@/components/ui';

/**
 * Built-in prompts, editable, each with its default a click away: the
 * assistant's (Settings → Assistant) and Adventure mode's actors (⚙ Actors).
 * `edits` holds only the changed ones; back to the default word for word
 * counts as not edited.
 */
export function PromptTemplateEditor({ templates, edits, onChange, intro }: { templates: AssistTemplate[]; edits: Record<string, string>; onChange: (next: Record<string, string>) => void; intro?: ReactNode }) {
  const defaults = Object.fromEntries(templates.map((t) => [t.key, t.text]));
  const setTemplate = (key: string, text: string) => {
    const next = { ...edits };
    if (text === defaults[key]) delete next[key];
    else next[key] = text;
    onChange(next);
  };
  const restore = (key: string) => {
    const next = { ...edits };
    delete next[key];
    onChange(next);
  };
  const groups = [...new Set(templates.map((t) => t.group))];
  const edited = Object.keys(edits).filter((k) => k in defaults).length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Prompts {edited > 0 && <span className="font-normal normal-case text-violet-300">· {edited} edited</span>}</span>
        {edited > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (await confirmDialog({ title: 'Restore every prompt to its default?', body: `Your ${edited} edited prompt${edited === 1 ? '' : 's'} go back to the built-in wording.`, confirmLabel: 'Restore all', danger: true })) onChange({});
            }}
          >
            ↺ Restore all
          </Button>
        )}
      </div>
      {intro && <p className="text-xs text-slate-500">{intro}</p>}
      {groups.map((group) => {
        const inGroup = templates.filter((t) => t.group === group);
        const changed = inGroup.filter((t) => t.key in edits).length;
        return (
          <details key={group} className="rounded-md border border-slate-800">
            <summary className="cursor-pointer px-2.5 py-1.5 text-sm text-slate-200">
              {group}
              {changed > 0 && <span className="ml-2 text-xs text-violet-300">{changed} edited</span>}
            </summary>
            <div className="flex flex-col gap-3 border-t border-slate-800 p-2.5">
              {inGroup.map((t) => {
                const isEdited = t.key in edits;
                return (
                  <div key={t.key} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-slate-300">{t.label}</span>
                      {isEdited && <span className="rounded bg-violet-500/15 px-1.5 text-[10px] text-violet-300">edited</span>}
                      {t.vars.length > 0 && <span className="text-[10px] text-slate-500">{t.vars.map((v) => `{{${v}}}`).join(' ')}</span>}
                      <Button size="sm" variant="ghost" className="ml-auto" disabled={!isEdited} onClick={() => restore(t.key)} title="Back to the built-in wording">
                        ↺ Default
                      </Button>
                    </div>
                    {t.note && <p className="text-[11px] text-slate-500">{t.note}</p>}
                    <AutoTextarea aria-label={`${group}: ${t.label}`} value={edits[t.key] ?? t.text} onChange={(e) => setTemplate(t.key, e.target.value)} minRows={2} maxRows={16} className="font-mono text-xs" />
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
