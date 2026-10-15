'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GroupMember, GroupProject, GroupSettings, ProjectSummary } from '@/types/project';
import { openNewGroup, useGroupUi, type NewGroupRequest } from '@/components/chatmode/groupUi';
import { api } from '@/lib/api';
import { CAST_RECENT, CAST_STICKY, JOIN_PREFIX, JOIN_SUFFIX, MEMORY_EVERY, MEMORY_WORDS, memberName, memberSummary, sinceMemory } from '@/lib/groupChat';
import { useGroupStore } from '@/store/groupStore';
import { useProjectStore } from '@/store/projectStore';
import { useChatStore } from '@/store/chatStore';
import { toast } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { ChatPanel } from '@/components/dock/ChatPanel';
import { useGroupChatHost } from '@/components/dock/chatHost';
import { useGroupMemory, useMemoryStatus } from '@/components/dock/groupMemory';
import { useLlmStore } from '@/store/llmStore';
import { resolvePersona, usePersonaStore } from '@/store/personaStore';
import { LorebookSelect } from '@/components/LorebookBank';
import { AutoTextarea, Button, IconButton, Modal, NumberInput, Toggle, confirmDialog, cx, inputClass } from '@/components/ui';

// Group chats in Chat mode: the Groups list (on the home screen and in the
// sidebar), making a group (from scratch, or from a card's chat), and an
// open group's chat with its settings beside it. The chat itself is the
// card chat's (components/dock/ChatPanel.tsx), with the group as its host;
// how a group's replies are prompted is lib/groupChat.ts.

/** Up to four members' pictures, as a group's own. */
function Collage({ ids, className }: { ids: string[]; className?: string }) {
  const summaries = useProjectStore((s) => s.summaries);
  const pics = ids
    .map((id) => summaries.find((s) => s.id === id))
    .filter((s): s is ProjectSummary => !!s)
    .slice(0, 4);
  return (
    <div className={cx('grid overflow-hidden bg-slate-800', pics.length > 1 ? 'grid-cols-2' : 'grid-cols-1', className)}>
      {pics.map((s) => {
        const url = api.avatarUrl(s.id, s.avatar);
        return (
          <div key={s.id} className={cx('min-h-0 overflow-hidden', pics.length === 3 && s === pics[0] && 'row-span-2')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {url ? <img src={url} alt="" className="h-full w-full object-cover object-top" loading="lazy" /> : <div className="flex h-full items-center justify-center text-[0.6em] text-slate-500">{(s.name[0] ?? '?').toUpperCase()}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Chat mode's home: the groups, before the cards. */
export function GroupsSection() {
  const { summaries, listed, refresh, open } = useGroupStore();
  useEffect(() => {
    if (!listed) void refresh().catch(() => {});
  }, [listed, refresh]);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Groups</h2>
        <span className="text-xs text-slate-500">Group chats with several characters</span>
        <Button size="sm" className="ml-auto" onClick={() => openNewGroup()}>
          + New group
        </Button>
      </div>
      {summaries.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 phone:grid-cols-[repeat(auto-fill,minmax(104px,1fr))] phone:gap-2">
          {summaries.map((g) => (
            <button key={g.id} type="button" onClick={() => void open(g.id)} className="flex flex-col overflow-hidden rounded-md border border-slate-800 bg-slate-900 text-left hover:border-violet-500">
              <Collage ids={g.members.map((m) => m.projectId)} className="aspect-square w-full" />
              <div className="px-2 py-1.5">
                <div className="truncate text-sm text-slate-200">{g.name}</div>
                <div className="truncate text-[10px] text-slate-500">
                  {g.members.length} characters · {g.chats ? `${g.chats} chat${g.chats === 1 ? '' : 's'}` : 'no chats yet'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** The groups, at the top of Chat mode's card list. */
export function GroupSidebarList({ onPicked }: { onPicked?: () => void }) {
  const { summaries, listed, refresh, open, group } = useGroupStore();
  useEffect(() => {
    if (!listed) void refresh().catch(() => {});
  }, [listed, refresh]);
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-800 px-1 pb-2">
      <div className="flex items-center px-1.5 pt-1 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
        Groups
        <button type="button" className="ml-auto rounded px-1 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200" title="New group" onClick={() => openNewGroup()}>
          +
        </button>
      </div>
      {summaries.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => void open(g.id).then(() => onPicked?.())}
          className={cx('flex items-center gap-2 rounded-md px-1.5 py-1 text-left', group?.id === g.id ? 'bg-violet-500/15' : 'hover:bg-slate-900')}
        >
          <Collage ids={g.members.map((m) => m.projectId)} className="h-8 w-8 flex-shrink-0 rounded" />
          <span className="min-w-0">
            <span className="block truncate text-sm text-slate-200">{g.name}</span>
            <span className="block truncate text-[10px] text-slate-500">{g.members.length} characters</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** The open group in the header: its pictures, name and settings. */
export function GroupHeader({ phone }: { phone: boolean }) {
  const group = useGroupStore((s) => s.group);
  const { drawer, setDrawer } = useGroupUi();
  if (!group) return null;
  return (
    <>
      <Collage ids={group.members.map((m) => m.projectId)} className="h-7 w-7 flex-shrink-0 rounded-full" />
      <span className={cx('min-w-0 truncate text-sm text-slate-200', phone ? 'max-w-[40vw]' : 'max-w-64')}>{group.name}</span>
      <Button size="sm" variant={drawer ? 'primary' : 'secondary'} className="ml-1" onClick={() => setDrawer(!drawer)} title="The group's characters and how it chats">
        👥{!phone && ' Group'}
      </Button>
    </>
  );
}

/** An open group: its chat, and its settings beside it. */
export function GroupScreen({ phone }: { phone: boolean }) {
  const host = useGroupChatHost();
  const { drawer, setDrawer } = useGroupUi();
  if (!host) return null;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1">
        <ChatPanel wide host={host} />
      </div>
      {drawer &&
        (phone ? (
          <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <GroupDrawer onClose={() => setDrawer(false)} />
          </div>
        ) : (
          <aside className="flex w-[440px] max-w-[45%] flex-shrink-0 flex-col border-l border-slate-800">
            <GroupDrawer onClose={() => setDrawer(false)} />
          </aside>
        ))}
    </div>
  );
}

const STRATEGIES: { value: GroupSettings['strategy']; label: string; hint: string }[] = [
  { value: 'cast', label: 'Cast', hint: "The speaker's whole card; those in the scene (who spoke or were named lately, or you marked present) in full but for their examples; everyone else as a line or two. Each in a block of their own." },
  { value: 'swap', label: 'Swap', hint: "Only the speaker's card (SillyTavern's default). Others can slip out of mind." },
  { value: 'join', label: 'Join', hint: "Every member's card in one, each part wrapped in the join prefix and suffix (SillyTavern's join). Details can run together." },
];
const ORDERS: { value: GroupSettings['order']; label: string; hint: string }[] = [
  { value: 'natural', label: 'Natural', hint: 'Whoever the last message names, else by talkativeness' },
  { value: 'list', label: 'List', hint: 'In the order below, in turn' },
  { value: 'pooled', label: 'Pooled', hint: "Someone who hasn't spoken since your last message" },
  { value: 'manual', label: 'Manual', hint: 'You pick who replies' },
  { value: 'model', label: 'Model', hint: "A quick request to the writing assistant's connection picks who speaks next from the recent messages (or says it's your turn, which pauses Auto)" },
];

function GroupDrawer({ onClose }: { onClose: () => void }) {
  const { group, members: projects, update, remove } = useGroupStore();
  const summaries = useProjectStore((s) => s.summaries);
  const chat = useChatStore((s) => s.chat);
  const [adding, setAdding] = useState(false);
  const { runAssist } = useLlmStream();
  const [writing, setWriting] = useState<string | null>(null);
  const host = useGroupChatHost();
  const memory = useGroupMemory();
  const { updating, stop: stopMemory } = useMemoryStatus();
  const userName = resolvePersona(usePersonaStore((st) => st.personas), useLlmStore((st) => st.chatSettings), chat).name;
  if (!group) return null;
  const s = group.settings;
  const set = (patch: Partial<GroupSettings>) => update((g) => ({ ...g, settings: { ...g.settings, ...patch } }));
  const setMember = (id: string, patch: Partial<GroupMember>) => update((g) => ({ ...g, members: g.members.map((m) => (m.projectId === id ? { ...m, ...patch } : m)) }));
  const move = (i: number, by: number) =>
    update((g) => {
      const members = [...g.members];
      const [m] = members.splice(i, 1);
      members.splice(Math.max(0, Math.min(members.length, i + by)), 0, m);
      return { ...g, members };
    });
  const writeSummary = async (id: string) => {
    const card = projects[id]?.card.data;
    if (!card) return;
    setWriting(id);
    const name = memberName(card);
    const r = await runAssist(
      [
        { role: 'system', content: "You write a cast list's entries: one or two plain sentences saying who a character is and what matters most about them in a story (role, look in a few words, manner, how they relate to others). No preamble." },
        { role: 'user', content: `Character: ${name}\n\n${card.description}\n\n${card.personality ? `Personality: ${card.personality}\n\n` : ''}${card.scenario ? `Scenario: ${card.scenario}` : ''}`.replace(/\{\{char\}\}/gi, name) },
      ],
      undefined,
      `👥 ${name}'s summary`,
    );
    setWriting(null);
    if (r.error) toast(r.error, 'error');
    else if (r.text.trim()) setMember(id, { summary: r.text.trim() });
  };
  const notIn = summaries.filter((p) => !group.members.some((m) => m.projectId === p.id));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <input value={group.name} onChange={(e) => update((g) => ({ ...g, name: e.target.value }))} className={cx(inputClass, 'min-w-0 flex-1 py-1 text-sm')} aria-label="Group name" />
        <IconButton title="Close" onClick={onClose}>
          ✕
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 text-sm">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-slate-400 uppercase">Characters</h3>
          {group.members.map((m, i) => {
            const p = projects[m.projectId];
            const card = p?.card.data;
            const url = p ? api.avatarUrl(p.id, p.avatar) : null;
            const marked = chat?.presence?.[m.projectId];
            return (
              <div key={m.projectId} className={cx('flex flex-col gap-1.5 rounded-md border border-slate-800 p-2', m.muted && 'opacity-60')}>
                <div className="flex items-center gap-2">
                  <span className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {url && <img src={url} alt="" className="h-full w-full object-cover object-top" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-200">{card ? memberName(card) : <em className="text-slate-500">A card that&apos;s gone</em>}</span>
                  <IconButton title="Earlier in the order" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </IconButton>
                  <IconButton title="Later in the order" disabled={i === group.members.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </IconButton>
                  <IconButton title={m.muted ? 'Unmute: they reply again' : "Mute: they don't reply (and stay out of Join unless it includes them)"} onClick={() => setMember(m.projectId, { muted: m.muted ? undefined : true })}>
                    {m.muted ? '🔇' : '🔊'}
                  </IconButton>
                  <IconButton
                    title="Remove from the group (the card stays)"
                    tone="danger"
                    onClick={() => update((g) => ({ ...g, members: g.members.filter((x) => x.projectId !== m.projectId) }))}
                  >
                    ✕
                  </IconButton>
                </div>
                {card && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-slate-400" title="How readily they speak up in the natural order">
                      Talkativeness
                      <input type="range" min={0} max={1} step={0.1} value={m.talkativeness ?? 0.5} onChange={(e) => setMember(m.projectId, { talkativeness: Number(e.target.value) })} className="flex-1" />
                      <span className="w-7 tabular-nums">{Math.round((m.talkativeness ?? 0.5) * 100)}%</span>
                    </label>
                    {s.strategy === 'cast' && (
                      <>
                        <label className="flex flex-col gap-0.5 text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            Summary <span className="text-slate-500">(when off-stage)</span>
                            <button type="button" disabled={writing === m.projectId} onClick={() => void writeSummary(m.projectId)} className="ml-auto text-violet-300 hover:text-violet-200 disabled:opacity-50" title="The writing assistant writes it from the card">
                              {writing === m.projectId ? '✨ Writing…' : '✨ Write'}
                            </button>
                          </span>
                          <AutoTextarea value={m.summary ?? ''} onChange={(e) => setMember(m.projectId, { summary: e.target.value || undefined })} minRows={1} maxRows={5} placeholder={memberSummary({ id: m.projectId, card })} className="text-xs" />
                        </label>
                        {chat && (
                          <label className="flex items-center gap-2 text-xs text-slate-400" title="For this chat: in the scene or out of it whatever they do, or by what they do (they spoke or were named lately)">
                            In this chat&apos;s scene
                            <select value={marked ?? ''} onChange={(e) => useChatStore.getState().setPresence(m.projectId, (e.target.value || undefined) as 'in' | 'out' | undefined)} className={cx(inputClass, 'py-0.5 text-xs')}>
                              <option value="">By what they do</option>
                              <option value="in">Present</option>
                              <option value="out">Away</option>
                            </select>
                          </label>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {adding ? (
            <div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto rounded-md border border-slate-800 p-1">
              {notIn.map((p) => (
                <button key={p.id} type="button" onClick={() => update((g) => ({ ...g, members: [...g.members, { projectId: p.id }] }))} className="flex items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-900">
                  <span className="h-7 w-7 flex-shrink-0 overflow-hidden rounded-full bg-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.avatar && <img src={api.avatarUrl(p.id, p.avatar)!} alt="" className="h-full w-full object-cover object-top" />}
                  </span>
                  <span className="truncate">{p.name || 'Unnamed'}</span>
                </button>
              ))}
              {!notIn.length && <p className="p-2 text-xs text-slate-500">Every card is in the group.</p>}
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Done
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setAdding(true)}>
              + Add a character
            </Button>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-slate-400 uppercase">How replies are written</h3>
          <div className="flex flex-col gap-1">
            {STRATEGIES.map((x) => (
              <label key={x.value} className="flex items-start gap-2 text-xs text-slate-300">
                <input type="radio" name="strategy" checked={s.strategy === x.value} onChange={() => set({ strategy: x.value })} className="mt-0.5" />
                <span>
                  <span className="font-medium">{x.label}</span> <span className="text-slate-500">{x.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {s.strategy === 'cast' && (
            <div className="flex flex-wrap gap-3 text-xs text-slate-400">
              <label className="flex flex-col gap-0.5" title="Someone who spoke or was named in this many recent messages is in the scene">
                In the scene after (messages)
                <NumberInput value={s.castRecent} onChange={(v) => set({ castRecent: v })} min={1} max={100} placeholder={String(CAST_RECENT)} className="w-24" allowEmpty />
              </label>
              <label className="flex flex-col gap-0.5" title="And stays this many messages more">
                Stays for
                <NumberInput value={s.castSticky} onChange={(v) => set({ castSticky: v })} min={0} max={100} placeholder={String(CAST_STICKY)} className="w-24" allowEmpty />
              </label>
              <label className="flex flex-col gap-0.5" title="Past this many tokens of characters in the scene, the least recently active drop to their summary (empty: no limit)">
                Scene budget (tokens)
                <NumberInput value={s.castBudget} onChange={(v) => set({ castBudget: v })} min={0} placeholder="No limit" className="w-28" allowEmpty />
              </label>
            </div>
          )}
          {s.strategy === 'join' && (
            <div className="flex flex-col gap-1.5 text-xs text-slate-400">
              <label className="flex flex-col gap-0.5">
                Join prefix <span className="text-slate-500">({'{{char}}'} is each character&apos;s name)</span>
                <input value={s.joinPrefix ?? JOIN_PREFIX} onChange={(e) => set({ joinPrefix: e.target.value })} className={cx(inputClass, 'text-xs')} />
              </label>
              <label className="flex flex-col gap-0.5">
                Join suffix
                <input value={s.joinSuffix ?? JOIN_SUFFIX} onChange={(e) => set({ joinSuffix: e.target.value })} className={cx(inputClass, 'text-xs')} />
              </label>
              <Toggle checked={!!s.joinMuted} onChange={(v) => set({ joinMuted: v || undefined })} label={<span className="text-xs">Include muted characters</span>} />
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-slate-400 uppercase">Who speaks next</h3>
          <div className="flex flex-wrap gap-1">
            {ORDERS.map((o) => (
              <button key={o.value} type="button" title={o.hint} onClick={() => set({ order: o.value })} className={cx('rounded border px-2 py-0.5 text-xs', s.order === o.value ? 'border-violet-500 bg-violet-600/30 text-violet-100' : 'border-slate-700 text-slate-300 hover:border-violet-500')}>
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">{ORDERS.find((o) => o.value === s.order)?.hint}</p>
          <Toggle checked={!!s.allowSelfResponses} onChange={(v) => set({ allowSelfResponses: v || undefined })} label={<span className="text-xs">A character may reply to themselves</span>} />
          <Toggle checked={!!s.autoMode} onChange={(v) => set({ autoMode: v || undefined })} label={<span className="text-xs">Start new chats with Auto on (characters carry on by themselves)</span>} />
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Auto waits
            <NumberInput value={s.autoDelay} onChange={(v) => set({ autoDelay: v })} min={1} max={600} placeholder="5" className="w-20" allowEmpty />
            seconds after each reply
          </label>
          <Toggle checked={s.greetings !== 'first'} onChange={(v) => set({ greetings: v ? undefined : 'first' })} label={<span className="text-xs">New chats open with every character&apos;s greeting (off: the first&apos;s)</span>} />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-slate-400 uppercase">Memories</h3>
          <Toggle checked={!!s.memory} onChange={(v) => set({ memory: v || undefined })} label={<span className="text-xs">Characters keep memories of each chat</span>} />
          <p className="text-xs text-slate-500">Each character&apos;s notes on the chat from their side (what they saw, did and feel), written by the writing assistant and sent in their part of the prompt, so what&apos;s slipped out of the history stays with them.</p>
          {s.memory && (
            <div className="flex flex-wrap gap-3 text-xs text-slate-400">
              <label className="flex flex-col gap-0.5" title="A character's memory is brought up to date once this many messages are new since">
                Update every (messages)
                <NumberInput value={s.memoryEvery} onChange={(v) => set({ memoryEvery: v })} min={1} max={200} placeholder={String(MEMORY_EVERY)} className="w-24" allowEmpty />
              </label>
              <label className="flex flex-col gap-0.5" title="How long each memory may grow">
                At most (words)
                <NumberInput value={s.memoryWords} onChange={(v) => set({ memoryWords: v })} min={20} max={2000} step={10} placeholder={String(MEMORY_WORDS)} className="w-24" allowEmpty />
              </label>
            </div>
          )}
          {chat && host?.group && (
            <>
              {host.group.members.map((m) => {
                const mem = chat.memories?.[m.id];
                const fresh = sinceMemory(chat.messages, mem).length;
                const through = mem?.through ? chat.messages.findIndex((x) => x.id === mem.through) : -1;
                return (
                  <label key={m.id} className="flex flex-col gap-0.5 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      {memberName(m.card)}
                      <span className="text-slate-500">
                        {mem ? (through >= 0 ? `· up to #${through + 1}` : '') : '· none yet'}
                        {fresh ? ` · ${fresh} new since` : ''}
                      </span>
                      <button type="button" disabled={!!updating || !chat.messages.length} onClick={() => void memory.update(host.group!, [m.id], userName)} className="ml-auto text-violet-300 hover:text-violet-200 disabled:opacity-50" title="The writing assistant brings it up to the last message">
                        {updating === m.id ? '🧠 Updating…' : '🧠 Update'}
                      </button>
                    </span>
                    <AutoTextarea
                      value={mem?.text ?? ''}
                      readOnly={updating === m.id}
                      onChange={(e) => useChatStore.getState().setMemory(m.id, e.target.value ? { text: e.target.value, through: mem?.through ?? null, updatedAt: Date.now() } : undefined)}
                      minRows={1}
                      maxRows={8}
                      placeholder={`What ${memberName(m.card)} remembers of this chat`}
                      className="text-xs"
                    />
                  </label>
                );
              })}
              <div className="flex gap-2">
                {updating ? (
                  <Button size="sm" variant="danger" onClick={() => stopMemory?.()}>
                    ■ Stop
                  </Button>
                ) : (
                  <Button size="sm" disabled={!chat.messages.length} onClick={() => void memory.update(host.group!, host.group!.members.filter((m) => !m.muted).map((m) => m.id), userName)} title="Bring every unmuted character's memory up to the last message">
                    🧠 Update all now
                  </Button>
                )}
              </div>
            </>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-slate-400 uppercase">The group&apos;s own</h3>
          <label className="flex flex-col gap-0.5 text-xs text-slate-400">
            Scenario <span className="text-slate-500">(over the characters&apos; own)</span>
            <AutoTextarea value={group.scenario ?? ''} onChange={(e) => update((g) => ({ ...g, scenario: e.target.value || undefined }))} minRows={2} maxRows={8} className="text-xs" />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-slate-400">
            Lorebook <span className="text-slate-500">(from 📖 Lorebooks, in every chat of the group, beside the characters&apos;)</span>
            <LorebookSelect value={group.lorebookId} onChange={(id) => update((g) => ({ ...g, lorebookId: id }))} />
          </label>
        </section>

        <Button
          variant="danger"
          size="sm"
          className="self-start"
          onClick={async () => {
            if (await confirmDialog({ title: `Delete the group "${group.name}"?`, body: 'The group and its chats are deleted for good. Its characters’ cards stay as they are.', confirmLabel: 'Delete', danger: true })) await remove(group.id);
          }}
        >
          Delete the group
        </Button>
      </div>
    </div>
  );
}

/** The New group dialog, mounted once (Shell). */
export function NewGroupHost() {
  const { making, setMaking } = useGroupUi();
  const summaries = useProjectStore((s) => s.summaries);
  const { create, createFromChat } = useGroupStore();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [openFor, setOpenFor] = useState<NewGroupRequest | null>(null);
  // Fresh each time it opens.
  if (making !== openFor) {
    setOpenFor(making);
    setName(making?.from ? `${making.from.name} and friends` : '');
    setPicked([]);
    setFilter('');
  }
  const fromId = making?.from?.projectId;
  const shown = useMemo(() => summaries.filter((s) => s.id !== fromId && (s.name || '').toLowerCase().includes(filter.trim().toLowerCase())), [summaries, fromId, filter]);
  if (!making) return null;
  const close = () => setMaking(null);
  const enough = (fromId ? 1 : 0) + picked.length >= 2;
  const go = async () => {
    setBusy(true);
    try {
      if (making.from) await createFromChat(making.from.projectId, making.from.chat, picked, name);
      else await create(name, picked);
      close();
    } catch (err) {
      toast(`Couldn't make the group: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title={making.from ? 'Make a group chat from this chat' : 'New group'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!enough || busy} onClick={() => void go()}>
            {busy ? 'Making it…' : making.from ? 'Make the group chat' : 'Make the group'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {making.from && (
          <p className="text-xs text-slate-400">
            A new group with {making.from.name} and the characters you pick, starting with a copy of this chat ({making.from.name}&apos;s messages stay theirs). The chat itself stays as it is.
          </p>
        )}
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Group" className={inputClass} />
        </label>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {making.from ? 'Who else is in it' : 'Characters'} <span className="text-slate-500">({picked.length + (fromId ? 1 : 0)} picked; at least two in all)</span>
            {summaries.length > 8 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search…" className={cx(inputClass, 'ml-auto w-40 py-0.5 text-xs')} />}
          </div>
          <div className="grid max-h-80 grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 overflow-y-auto">
            {shown.map((s) => {
              const on = picked.includes(s.id);
              const url = api.avatarUrl(s.id, s.avatar);
              return (
                <button key={s.id} type="button" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((p) => p !== s.id) : [...picked, s.id])} className={cx('flex flex-col overflow-hidden rounded-md border text-left', on ? 'border-violet-400 ring-2 ring-violet-400' : 'border-slate-800 hover:border-violet-500')}>
                  <div className="checker aspect-square w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {url ? <img src={url} alt="" className="h-full w-full object-cover object-top" loading="lazy" /> : <div className="flex h-full items-center justify-center text-2xl text-slate-600">{(s.name[0] ?? '?').toUpperCase()}</div>}
                  </div>
                  <span className="truncate px-1.5 py-1 text-xs text-slate-200">
                    {on ? '✓ ' : ''}
                    {s.name || 'Unnamed'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Whether a group is open (for the Shell). */
export const useOpenGroup = () => useGroupStore((s) => s.group) as GroupProject | null;
