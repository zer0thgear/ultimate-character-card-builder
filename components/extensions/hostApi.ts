'use client';

import type { CardData } from '@/types/card';
import type { LlmMessage } from '@/types/llm';
import { getPath, listTextFields, setPath } from '@/lib/cardPath';
import { normalizeLorebook } from '@/lib/cardSpec';
import { useProjectStore } from '@/store/projectStore';
import { useLorebookStore } from '@/store/lorebookStore';
import { useLlmStore } from '@/store/llmStore';
import { usePackStore } from '@/store/packStore';
import { toast } from '@/store/uiStore';
import { readPackData, updatePackData } from '@/store/packDataCache';
import { llmCall } from '@/components/llm/llmCall';

// The app's side of an extension's API (lib/extensionSandbox.ts): what each
// call does. SandboxFrame has already checked the call against the
// permissions you granted; this checks what's passed in, since the frame's
// code can send anything.

export interface CallHost {
  packId: string;
  packName: string;
  /** Opens one of the pack's dialogs. */
  openDialog: (uiId: string, data: unknown) => void;
  /** Closes this frame's dialog (when it is one). */
  close?: () => void;
}

export class CallError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The open card, as an extension sees it. */
export function cardView() {
  const p = useProjectStore.getState().project;
  return p ? { id: p.id, data: p.card.data } : null;
}

// Fields an extension may set: the card's text fields, a few short ones,
// and two lists.
const SHORT_FIELDS = ['name', 'nickname', 'creator', 'character_version'];
const LIST_FIELDS = ['tags', 'alternate_greetings'];

function applyFields(data: CardData, fields: Record<string, unknown>): CardData {
  const text = new Set([...listTextFields(data).map((f) => f.path), ...SHORT_FIELDS]);
  let next = data;
  for (const [path, value] of Object.entries(fields)) {
    if (LIST_FIELDS.includes(path)) {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new CallError(`${path} must be a list of text.`);
      next = { ...next, [path]: value.map((v: string) => v.slice(0, 100_000)) };
    } else if (text.has(path)) {
      if (typeof value !== 'string') throw new CallError(`${path} must be text.`);
      next = SHORT_FIELDS.includes(path) ? { ...next, [path]: value.slice(0, 500) } : setPath(next, path, value.slice(0, 200_000));
    } else throw new CallError(`"${path}" isn't a field an extension can set.`);
  }
  return next;
}

function checkMessages(v: unknown): LlmMessage[] {
  if (!Array.isArray(v) || !v.length) throw new CallError('llm.complete needs a list of messages.');
  return v.map((m) => {
    if (!isObj(m) || !['system', 'user', 'assistant'].includes(m.role as string) || typeof m.content !== 'string') throw new CallError('Each message needs a role (system, user or assistant) and text content.');
    return { role: m.role as LlmMessage['role'], content: m.content };
  });
}

export async function handleCall(host: CallHost, method: string, params: unknown): Promise<unknown> {
  const p = isObj(params) ? params : {};
  switch (method) {
    case 'card.get':
      return cardView();
    case 'card.setFields': {
      const project = useProjectStore.getState().project;
      if (!project) throw new CallError('No card is open.');
      if (!isObj(p.fields)) throw new CallError('card.setFields needs an object of fields.');
      const fields = p.fields;
      const next = applyFields(project.card.data, fields);
      useProjectStore.getState().updateCard(() => next);
      return { ok: true };
    }
    case 'lorebooks.list': {
      const store = useLorebookStore.getState();
      if (!store.loaded) await store.load();
      return useLorebookStore.getState().books.map((b) => ({ id: b.id, name: b.book.name ?? '', book: b.book }));
    }
    case 'lorebooks.add': {
      const book = normalizeLorebook(p.book);
      if (!book) throw new CallError('That isn\'t a lorebook.');
      const saved = await useLorebookStore.getState().add(book);
      return { id: saved.id };
    }
    case 'llm.complete': {
      const messages = checkMessages(p.messages);
      const { connections, assistConnectionId } = useLlmStore.getState();
      const connection = connections.find((c) => c.id === assistConnectionId) ?? connections[0] ?? null;
      const label = typeof p.label === 'string' && p.label.trim() ? `: ${p.label.trim().slice(0, 60)}` : '';
      const r = await llmCall(connection, `🧩 ${host.packName}${label}`, messages);
      if (r.error) throw new CallError(r.error);
      return { text: r.text };
    }
    case 'storage.get': {
      const data = await readPackData(host.packId);
      return typeof p.key === 'string' ? (data[p.key] ?? null) : data;
    }
    case 'storage.set': {
      if (typeof p.key !== 'string' || !p.key) throw new CallError('storage.set needs a key.');
      const key = p.key;
      await updatePackData(host.packId, (old) => {
        const data = { ...old };
        if (p.value === undefined || p.value === null) delete data[key];
        else data[key] = p.value;
        return data;
      });
      return { ok: true };
    }
    case 'ui.toast': {
      const tone = p.tone === 'error' || p.tone === 'success' ? p.tone : 'info';
      toast(`${host.packName}: ${String(p.text ?? '').slice(0, 300)}`, tone);
      return { ok: true };
    }
    case 'ui.openDialog': {
      const id = String(p.id ?? '');
      const pack = usePackStore.getState().packs.find((x) => x.pack.id === host.packId)?.pack;
      if (!pack?.ui?.some((u) => u.id === id && u.slot === 'dialog')) throw new CallError(`This extension has no dialog "${id}".`);
      host.openDialog(id, p.data ?? null);
      return { ok: true };
    }
    case 'ui.close':
      host.close?.();
      return { ok: true };
  }
  throw new CallError(`Unknown call ${method}.`);
}

/** For a field action: the field as it is now. */
export function fieldView(path: string, label: string) {
  const data = useProjectStore.getState().project?.card.data;
  return { path, label, value: data ? getPath(data, path) : '' };
}
