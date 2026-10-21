'use client';

import { useEffect, useState } from 'react';
import type { CardData } from '@/types/card';
import { api } from '@/lib/api';
import { bankName } from '@/lib/lorebookBank';
import { bankCopyOf, chubLoreLinks, missingChubLore } from '@/lib/chubLore';
import { ensureLorebooks, useLorebookStore } from '@/store/lorebookStore';
import { useProjectStore } from '@/store/projectStore';
import { toast } from '@/store/uiStore';
import { openLorebooks, pickBankLorebook } from '@/components/LorebookBank';
import { Button, IconButton, choiceDialog } from '@/components/ui';

// A card's linked lorebooks (CardProject.lorebookIds): bank lorebooks that
// come along in its chats beside its own. Chub's (lib/chubLore.ts) are
// fetched into the bank once and linked; any other can be linked by hand.

/** Links bank lorebooks to a card: the open one through its store, any other on the server. */
async function linkToCard(projectId: string, ids: string[]) {
  const store = useProjectStore.getState();
  if (store.project?.id === projectId) store.setLorebookIds([...(store.project.lorebookIds ?? []), ...ids]);
  else await api.linkLorebooks(projectId, { add: ids });
}

/**
 * Fetches the lorebooks a card links on Chub into the bank (those it hasn't
 * got already) and links them all to the card. Returns their names, and the
 * ones that couldn't be fetched.
 */
export async function fetchChubLore(projectId: string, card: Pick<CardData, 'extensions'>): Promise<{ linked: string[]; failed: string[] }> {
  const store = useLorebookStore.getState();
  if (!store.loaded) await store.load();
  const ids: string[] = [];
  const linked: string[] = [];
  const failed: string[] = [];
  for (const link of chubLoreLinks(card)) {
    // Fetched before (for this card or another): the bank's copy.
    const copy = bankCopyOf(useLorebookStore.getState().books, link.path);
    if (copy) {
      ids.push(copy.id);
      linked.push(bankName(copy));
      continue;
    }
    try {
      const got = await api.chubLorebook(link.path);
      const saved = await useLorebookStore.getState().add(got.book, { chub: { path: link.path, ...(got.id ?? link.id ? { id: got.id ?? link.id } : {}) } });
      ids.push(saved.id);
      linked.push(bankName(saved));
    } catch (err) {
      failed.push(`${link.path.replace(/^lorebooks\//, '')}: ${(err as Error).message}`);
    }
  }
  if (ids.length) await linkToCard(projectId, ids);
  return { linked, failed };
}

const say = (r: { linked: string[]; failed: string[] }, cardName?: string) => {
  if (r.linked.length) toast(`Linked ${r.linked.length === 1 ? `"${r.linked[0]}"` : `${r.linked.length} lorebooks (${r.linked.join(', ')})`}${cardName ? ` to ${cardName}` : ''}.`, 'success');
  if (r.failed.length) toast(`Couldn't fetch ${r.failed.length === 1 ? 'a linked lorebook' : `${r.failed.length} linked lorebooks`}: ${r.failed.join('; ')}`, 'error');
};

/**
 * After cards are imported: fetches the lorebooks they link on Chub and
 * links them. From a link (`ask` false) that's done straight away; from a
 * file it asks first, since it reaches out to Chub.
 */
export async function offerChubLore(imported: { projectId: string; card: CardData }[], ask: boolean) {
  const withLinks = imported.filter((i) => chubLoreLinks(i.card).length);
  if (!withLinks.length) return;
  if (ask) {
    const n = withLinks.reduce((sum, i) => sum + chubLoreLinks(i.card).length, 0);
    const one = withLinks.length === 1;
    const answer = await choiceDialog({
      title: one ? `${withLinks[0].card.name || 'This card'} links ${n === 1 ? 'a lorebook' : `${n} lorebooks`} on Chub. Fetch ${n === 1 ? 'it' : 'them'}?` : `${withLinks.length} of these cards link lorebooks on Chub. Fetch them?`,
      body: "They go into 📖 Lorebooks (once, however many cards link them) and come along in the card's chats. The card's Lorebook tab can fetch them later too.",
      choices: [
        { value: 'yes', label: 'Fetch them' },
        { value: 'no', label: 'Not now' },
      ],
    });
    if (answer !== 'yes') return;
  }
  toast(withLinks.length === 1 ? 'Fetching its linked lorebooks…' : 'Fetching their linked lorebooks…', 'info');
  for (const i of withLinks) say(await fetchChubLore(i.projectId, i.card), withLinks.length > 1 ? i.card.name || 'a card' : undefined);
}

/** The open card's linked lorebooks, on its Lorebook tab: what's linked, linking more, and fetching Chub's. */
export function LinkedLorebooks() {
  const project = useProjectStore((s) => s.project);
  const setLorebookIds = useProjectStore((s) => s.setLorebookIds);
  const books = useLorebookStore((s) => s.books);
  const [fetching, setFetching] = useState(false);
  useEffect(ensureLorebooks, []);
  if (!project) return null;
  const ids = project.lorebookIds ?? [];
  const linked = ids.map((id) => books.find((b) => b.id === id)).filter((b) => !!b);
  const missing = missingChubLore(project.card.data, ids, books);
  if (!linked.length && !missing.length && !ids.length) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>Linked lorebooks: none.</span>
        <button type="button" className="text-violet-300 hover:underline" onClick={() => void link()} title="Link a lorebook from 📖 Lorebooks: it comes along in this card's chats, beside its own">
          + Link one…
        </button>
      </div>
    );
  }

  async function link() {
    const picked = await pickBankLorebook('Link a lorebook to this card');
    if (picked) setLorebookIds([...(useProjectStore.getState().project?.lorebookIds ?? []), picked.id]);
  }
  const fetchMissing = async () => {
    if (!project) return;
    setFetching(true);
    try {
      say(await fetchChubLore(project.id, project.card.data));
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-slate-800 p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-slate-400" title="Lorebooks from 📖 Lorebooks that come along in this card's chats, after its own. They aren't written into the card, so its exports don't carry them.">
          Linked lorebooks:
        </span>
        {linked.map((b) => (
          <span key={b.id} className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 py-0.5 pr-0.5 pl-2 text-slate-200">
            <button type="button" className="hover:underline" onClick={() => openLorebooks(b.id)} title={`${b.book.entries.length} entries${b.chub ? `, from Chub (${b.chub.path.replace(/^lorebooks\//, '')})` : ''}. Open it in 📖 Lorebooks`}>
              {b.chub ? '🔗 ' : ''}
              {bankName(b)}
            </button>
            <IconButton title="Unlink it from this card (it stays in 📖 Lorebooks)" className="h-5 min-w-5 text-[10px]" onClick={() => setLorebookIds(ids.filter((x) => x !== b.id))}>
              ✕
            </IconButton>
          </span>
        ))}
        {ids.length > linked.length && <span className="text-slate-500">({ids.length - linked.length} deleted from Lorebooks)</span>}
        <button type="button" className="text-violet-300 hover:underline" onClick={() => void link()}>
          + Link one…
        </button>
      </div>
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-slate-400">
          <span>
            Chub links {missing.length === 1 ? 'a lorebook' : `${missing.length} lorebooks`} to this card that {missing.length === 1 ? "isn't" : "aren't"} linked here: {missing.map((m) => m.path.replace(/^lorebooks\/[^/]+\//, '')).join(', ')}.
          </span>
          <Button size="sm" disabled={fetching} onClick={() => void fetchMissing()}>
            {fetching ? 'Fetching…' : missing.length === 1 ? 'Fetch and link it' : 'Fetch and link them'}
          </Button>
        </div>
      )}
    </div>
  );
}
