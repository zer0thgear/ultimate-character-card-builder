'use client';

import { useState } from 'react';
import type { AdventureWorld, WorldEntry } from '@/types/adventure';
import { useProjectStore } from '@/store/projectStore';
import { useLlmStore } from '@/store/llmStore';
import { useAdventureStore } from '@/store/adventureStore';
import { toast } from '@/store/uiStore';
import { RULE_EXAMPLES, emptyWorld, mergeWorld, overlayList, parseScout, scoutMessages, tallyUsage, withOverride, type ShownEntry, type WorldList } from '@/lib/adventure';
import { AutoTextarea, Button, IconButton, Tabs, choiceDialog, cx, inputClass } from '@/components/ui';
import { uuid } from '@/lib/uuid';
import { callActor } from '@/components/adventure/actorCall';
import { usageLine } from '@/components/adventure/usageLine';

// 🌍 World: the card's Cast, settings and rules, which every
// adventure with it plays in, and the open adventure's own changes to them.

type Tab = WorldList | 'rules';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Scans the card with the Scout and adds what it found to the card's world. */
export async function scanCard(): Promise<boolean> {
  const project = useProjectStore.getState().project;
  if (!project) return false;
  const r = await callActor('scout', '🔍 Scout', scoutMessages(project.card.data, useLlmStore.getState().adventureSettings.prompts));
  if (r.error) {
    toast(`The Scout couldn't read the card: ${r.error}`, 'error');
    return false;
  }
  const found = parseScout(r.text);
  if (!found) {
    toast("The Scout's reply wasn't the list asked for. Try again, or another model (⚙ Actors).", 'error');
    return false;
  }
  const have = project.adventure;
  let world: AdventureWorld;
  if (have && (have.settings.length || have.personae.length || have.rules.trim())) {
    const how = await choiceDialog({
      title: 'Add what the Scout found?',
      body: `It found ${plural(found.settings.length, 'setting')} and ${plural(found.personae.length, 'character')}${found.rules ? ', and some rules' : ''}. Add the new ones and keep yours as they are, or replace the card's world with them?`,
      choices: [
        { value: 'merge', label: 'Add the new ones' },
        { value: 'replace', label: 'Replace', danger: true },
      ],
    });
    if (!how) return false;
    world = how === 'replace' ? { ...found, scannedAt: Date.now() } : mergeWorld(have, found);
  } else world = { ...found, scannedAt: Date.now() };
  useProjectStore.getState().setAdventureWorld(world);
  toast(`The Scout listed ${plural(found.settings.length, 'setting')} and ${plural(found.personae.length, 'character')} (${usageLine(tallyUsage([r.usage]))}).`, 'success');
  return true;
}

export function WorldDrawer({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const adventure = useAdventureStore((s) => s.adventure);
  const update = useAdventureStore((s) => s.update);
  const [tab, setTab] = useState<Tab>('personae');
  // Changes go to the card (every adventure) or this adventure only.
  const [scope, setScope] = useState<'card' | 'adventure'>('card');
  const [scanning, setScanning] = useState(false);
  if (!project) return null;
  const world = project.adventure ?? emptyWorld();
  const here = scope === 'adventure' && !!adventure;
  const setWorld = (w: AdventureWorld) => useProjectStore.getState().setAdventureWorld(w);
  const over = adventure?.overrides;

  const listFor = (list: WorldList): ShownEntry[] => (here ? overlayList(world[list], over?.[list]) : world[list].map((e) => ({ ...e, origin: 'card' as const })));
  const save = (list: WorldList, e: WorldEntry) => {
    if (here) update((a) => ({ ...a, overrides: withOverride(a.overrides, list, e.id, e) }));
    else setWorld({ ...world, [list]: world[list].map((x) => (x.id === e.id ? e : x)) });
  };
  const add = (list: WorldList) => {
    const e: WorldEntry = { id: uuid(), name: '', text: '' };
    if (here) update((a) => ({ ...a, overrides: withOverride(a.overrides, list, e.id, e) }));
    else setWorld({ ...world, [list]: [...world[list], e] });
  };
  const remove = (list: WorldList, e: ShownEntry) => {
    if (!here) return setWorld({ ...world, [list]: world[list].filter((x) => x.id !== e.id) });
    // An entry added here goes; a card's entry is left out of this adventure.
    update((a) => ({ ...a, overrides: withOverride(a.overrides, list, e.id, e.origin === 'added' ? undefined : null) }));
  };
  /** An entry added in this adventure joins the card's world, for every adventure. */
  const promote = (list: WorldList, e: ShownEntry) => {
    const { origin: _origin, ...entry } = e;
    void _origin;
    setWorld({ ...world, [list]: [...world[list], entry] });
    update((a) => ({ ...a, overrides: withOverride(a.overrides, list, e.id, undefined) }));
  };
  const revert = (list: WorldList, e: ShownEntry) => update((a) => ({ ...a, overrides: withOverride(a.overrides, list, e.id, undefined) }));

  const rules = here ? (over?.rules ?? world.rules) : world.rules;
  const setRules = (text: string) => {
    if (here) update((a) => ({ ...a, overrides: { ...a.overrides, rules: text } }));
    else setWorld({ ...world, rules: text });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 px-3 py-2">
        <span className="flex-1 text-sm font-medium text-slate-200">🌍 World</span>
        <Button
          size="sm"
          disabled={scanning}
          title="The Scout reads the card's definitions and lorebook and lists its settings, characters and any rules (one call)"
          onClick={async () => {
            setScanning(true);
            await scanCard();
            setScanning(false);
          }}
        >
          {scanning ? 'Scanning…' : '🔍 Scan the card'}
        </Button>
        <IconButton title="Close" onClick={onClose}>
          ✕
        </IconButton>
      </div>
      {adventure && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 px-3 py-1.5 text-xs text-slate-400">
          <span>Changes go to</span>
          <div className="flex overflow-hidden rounded-md border border-slate-700" role="tablist">
            {(['card', 'adventure'] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => setScope(s)} className={cx('px-2 py-0.5', scope === s ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-slate-800')}>
                {s === 'card' ? 'The card' : 'This adventure'}
              </button>
            ))}
          </div>
          <span className="min-w-0 flex-1 truncate" title={here ? 'Only this adventure sees these changes; the card and its other adventures keep theirs.' : 'Every adventure with this card plays in this world, unless it changed an entry for itself.'}>
            {here ? 'only this one' : 'every adventure'}
          </span>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        className="flex-shrink-0 px-2"
        tabs={[
          { value: 'personae', label: 'Cast', badge: listFor('personae').filter((e) => e.origin !== 'removed').length },
          { value: 'settings', label: 'Settings', badge: listFor('settings').filter((e) => e.origin !== 'removed').length },
          { value: 'rules', label: 'Rules' },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tab === 'rules' ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-400">Rules the Director keeps in mind and applies, like a game&apos;s: catching creatures, hit points, an inventory. Leave empty for none. {'{{user}}'} and {'{{char}}'} work here.</p>
            <AutoTextarea value={rules} onChange={(e) => setRules(e.target.value)} minRows={8} placeholder="- Wild creatures can be caught once weakened; a roll decides it." className={cx(inputClass, 'text-sm')} />
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              Start from:
              {RULE_EXAMPLES.map((r) => (
                <Button key={r.label} size="sm" variant="ghost" onClick={() => setRules(rules.trim() ? `${rules.trim()}\n\n${r.text}` : r.text)}>
                  + {r.label}
                </Button>
              ))}
            </div>
            {here && over?.rules !== undefined && (
              <Button size="sm" variant="ghost" className="self-start" onClick={() => update((a) => ({ ...a, overrides: { ...a.overrides, rules: undefined } }))}>
                ↺ Use the card&apos;s rules
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-400">
              {tab === 'personae'
                ? `Everyone who can appear (the dramatis personae). Each is played from their entry, the card's own character also from its description.${here ? ' Newcomers the Director brings in during play are added here, marked "added here".' : ''}`
                : 'Places, factions, items and facts the Director and Narrator keep to.'}
            </p>
            {listFor(tab).map((e) => (
              <EntryEditor key={e.id} entry={e} here={here} onChange={(x) => save(tab, x)} onRemove={() => remove(tab, e)} onRevert={() => revert(tab, e)} onPromote={() => promote(tab, e)} />
            ))}
            {!listFor(tab).length && <p className="text-xs text-slate-500">None yet. 🔍 Scan the card to have them listed, or add them yourself.</p>}
            <Button size="sm" className="self-start" onClick={() => add(tab)}>
              + Add {tab === 'personae' ? 'a character' : 'a setting'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function EntryEditor({ entry, here, onChange, onRemove, onRevert, onPromote }: { entry: ShownEntry; here: boolean; onChange: (e: WorldEntry) => void; onRemove: () => void; onRevert: () => void; onPromote: () => void }) {
  const { origin, ...e } = entry;
  const removed = origin === 'removed';
  return (
    <div className={cx('flex flex-col gap-1.5 rounded-md border border-slate-800 p-2', removed && 'opacity-50')}>
      <div className="flex items-center gap-1.5">
        <input value={e.name} disabled={removed} onChange={(ev) => onChange({ ...e, name: ev.target.value })} placeholder="Name" className={cx(inputClass, 'min-w-0 flex-1 py-1 text-sm font-medium')} />
        {here && origin !== 'card' && <span className="text-[10px] text-amber-300">{{ changed: 'changed here', added: 'added here', removed: 'left out here' }[origin]}</span>}
        {here && origin === 'added' && (
          <IconButton title="Add to the card's world, for every adventure" onClick={onPromote}>
            ⇪
          </IconButton>
        )}
        {here && (origin === 'changed' || origin === 'removed') && (
          <IconButton title="Back to the card's" onClick={onRevert}>
            ↺
          </IconButton>
        )}
        {!removed && (
          <IconButton title={here && origin !== 'added' ? 'Leave out of this adventure' : 'Remove'} tone="danger" onClick={onRemove}>
            🗑
          </IconButton>
        )}
      </div>
      {!removed && <AutoTextarea value={e.text} onChange={(ev) => onChange({ ...e, text: ev.target.value })} minRows={2} maxRows={12} placeholder="Who or what it is" className={cx(inputClass, 'text-sm')} />}
    </div>
  );
}
