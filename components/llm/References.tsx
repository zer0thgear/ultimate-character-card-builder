'use client';
/* eslint-disable @next/next/no-img-element -- thumbnails are data: and blob: URLs, which next/image can't optimise */

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { useProjectStore } from '@/store/projectStore';
import { useSessionStore, imageBlob } from '@/store/sessionStore';
import { useLlmStore } from '@/store/llmStore';
import { toast } from '@/store/uiStore';
import { api } from '@/lib/api';
import { uuid } from '@/lib/uuid';
import { isPng, readTextChunks } from '@/lib/png';
import { importCardFile } from '@/lib/cardFile';
import { imageDataUrl, imageForVision } from '@/lib/visionImage';
import { hasPictures, type Reference } from '@/lib/references';
import type { ProjectSummary } from '@/types/project';
import { openLightbox } from '@/components/Lightbox';
import { Button, IconButton, Modal, cx, fileBytes, inputClass, pickFiles } from '@/components/ui';

// 📎 References for the writing assistant: other cards (yours in UCCB, or
// a card file) and pictures (gens, kept images, or any image file). Cards
// go in as text; pictures go to the vision model (Settings → LLM).

/** A request's references, with pasting pictures into its text box. */
export function useReferences() {
  const [refs, setRefs] = useState<Reference[]>([]);
  const add = (next: Reference[]) => setRefs((cur) => [...cur, ...next.filter((n) => !cur.some((c) => c.id === n.id))]);
  const remove = (id: string) => setRefs((cur) => cur.filter((r) => r.id !== id));
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void referencesFromFiles(files).then(add);
  };
  return { refs, add, remove, clear: () => setRefs([]), onPaste };
}

/** Which connection a request goes to: the vision model when pictures are
 *  attached (if one's set), otherwise the assistant's own. */
export function referenceConnectionId(refs: Reference[] | undefined): string | undefined {
  if (!hasPictures(refs)) return undefined;
  const { visionConnectionId, assistConnectionId } = useLlmStore.getState();
  return visionConnectionId ?? assistConnectionId ?? undefined;
}

const hasCardChunk = (bytes: Uint8Array) => readTextChunks(bytes).some((c) => /^(ccv3|chara)$/i.test(c.keyword));

/** Card files become card references; everything else that's a picture,
 *  picture references. A PNG is a card when it carries one. */
export async function referencesFromFiles(files: File[]): Promise<Reference[]> {
  const out: Reference[] = [];
  for (const file of files) {
    try {
      const bytes = await fileBytes(file);
      const isCard = /\.(json|charx)$/i.test(file.name) || (isPng(bytes) && hasCardChunk(bytes));
      if (isCard) {
        const { card, avatar } = await importCardFile(file.name, bytes);
        const thumb = avatar ? URL.createObjectURL(new Blob([avatar.bytes as BlobPart], { type: avatar.type })) : undefined;
        out.push({ id: uuid(), kind: 'card', name: card.data.name || file.name, card: card.data, thumb });
      } else if (file.type.startsWith('image/') || isPng(bytes)) {
        out.push(await pictureReference(file, file.name));
      } else {
        toast(`${file.name} isn't a card or a picture.`, 'error');
      }
    } catch (e) {
      toast(`Couldn't read ${file.name}: ${e instanceof Error ? e.message : e}`, 'error');
    }
  }
  return out;
}

/** A card's picture as a picture to attach. */
const avatarPicture = (id: string, name: string, url: string) => ({
  id: `avatar:${id}`,
  name: `${name.trim() || 'Unnamed'}'s picture`,
  thumb: url,
  blob: () => fetch(url).then((r) => r.blob()),
});

async function pictureReference(blob: Blob, name: string, id = uuid()): Promise<Reference> {
  const image = await imageForVision(blob);
  return { id, kind: 'image', name, image, thumb: imageDataUrl(image) };
}

/**
 * The attached references as chips, and the 📎 button that adds more.
 * Pictures dropped on it are attached too.
 */
export function ReferenceTray({ refs, onAdd, onRemove, className, label = 'References', hint }: { refs: Reference[]; onAdd: (r: Reference[]) => void; onRemove: (id: string) => void; className?: string; label?: string; hint?: string }) {
  const [picking, setPicking] = useState(false);
  const [over, setOver] = useState(false);
  const { connections, visionConnectionId, assistConnectionId } = useLlmStore();
  const pictures = hasPictures(refs);
  const seer = connections.find((c) => c.id === (visionConnectionId ?? assistConnectionId));
  const images = refs.filter((r) => r.kind === 'image');

  return (
    <div
      className={cx('flex flex-col gap-1 rounded-md transition-colors', over && 'bg-violet-500/10 ring-1 ring-violet-500/40', className)}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        // Not the page's drop-a-card-to-import.
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        void referencesFromFiles([...e.dataTransfer.files]).then(onAdd);
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setPicking(true)} title={hint ?? 'Attach other cards or pictures for the assistant to work from (you can also paste or drop pictures)'}>
          📎 {refs.length ? 'Add' : label}
        </Button>
        {refs.map((r) => (
          <span key={r.id} className="flex max-w-48 items-center gap-1 rounded-md bg-slate-800 py-0.5 pr-0.5 pl-1 text-xs text-slate-300" title={r.kind === 'card' ? `Card: ${r.name}` : `Picture: ${r.name}`}>
            {r.thumb ? (
              <img
                src={r.thumb}
                alt=""
                className={cx('h-5 w-5 flex-shrink-0 rounded object-cover', r.kind === 'image' && 'cursor-zoom-in')}
                onClick={() => r.kind === 'image' && openLightbox(images.map((i) => i.thumb!), images.indexOf(r))}
              />
            ) : (
              <span>{r.kind === 'card' ? '🪪' : '🖼'}</span>
            )}
            <span className="truncate">{r.name}</span>
            <IconButton title="Remove" onClick={() => onRemove(r.id)} className="!h-5 !w-5 text-[10px]">
              ✕
            </IconButton>
          </span>
        ))}
      </div>
      {pictures && (
        <p className={cx('text-[11px]', seer?.kind === 'novelai' ? 'text-amber-300' : 'text-slate-500')}>
          {seer?.kind === 'novelai'
            ? "With pictures attached this goes to your vision model, but that's a NovelAI connection, which can't see. Pick another in Settings → LLM (Use for vision)."
            : `With pictures attached, this goes to ${visionConnectionId && seer ? `your vision model (${seer.name})` : 'the assistant model, which needs to see images'}.`}
        </p>
      )}
      {picking && <ReferencePicker refs={refs} onAdd={onAdd} onRemove={onRemove} onClose={() => setPicking(false)} />}
    </div>
  );
}

const usePickFor = create<{ ask: { title: string; refs: Reference[]; done: (refs: Reference[]) => void } | null; set: (ask: { title: string; refs: Reference[]; done: (refs: Reference[]) => void } | null) => void }>((set) => ({
  ask: null,
  set: (ask) => set({ ask }),
}));

/** Opens the picker on its own (for an extension's wizard, say), starting
 *  from `refs`; resolves with what's attached once it's closed. */
export function pickReferences(refs: Reference[], title = '📎 Add references'): Promise<Reference[]> {
  return new Promise((resolve) => {
    usePickFor.getState().ask?.done(usePickFor.getState().ask!.refs);
    usePickFor.getState().set({ title, refs, done: resolve });
  });
}

/** The picker pickReferences opens, mounted once (Shell). */
export function ReferencePickHost() {
  const ask = usePickFor((s) => s.ask);
  const set = usePickFor((s) => s.set);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [shown, setShown] = useState<typeof ask>(null);
  // A new request starts from what it was given.
  if (ask !== shown) {
    setShown(ask);
    setRefs(ask?.refs ?? []);
  }
  if (!ask) return null;
  return (
    <ReferencePicker
      title={ask.title}
      refs={refs}
      onAdd={(next) => setRefs((cur) => [...cur, ...next.filter((n) => !cur.some((c) => c.id === n.id))])}
      onRemove={(id) => setRefs((cur) => cur.filter((r) => r.id !== id))}
      onClose={() => {
        ask.done(refs);
        set(null);
      }}
    />
  );
}

/** Picking references: a click attaches one, a second click on it takes it
 *  off again. */
function ReferencePicker({ refs, onAdd, onRemove, onClose, title = '📎 Add references' }: { refs: Reference[]; onAdd: (r: Reference[]) => void; onRemove: (id: string) => void; onClose: () => void; title?: string }) {
  const project = useProjectStore((s) => s.project);
  const summaries = useProjectStore((s) => s.summaries);
  const gens = useSessionStore((s) => s.images);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const has = (id: string) => refs.some((r) => r.id === id);

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return summaries.filter((s) => s.id !== project?.id && (!q || s.name.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q))));
  }, [summaries, project?.id, query]);

  const pictures = useMemo(() => {
    const kept = (project?.kept ?? []).map((k) => ({ id: `kept:${project!.id}:${k.file}`, name: k.label || 'Kept image', thumb: api.keptUrl(project!.id, k.file), blob: () => fetch(api.keptUrl(project!.id, k.file)).then((r) => r.blob()) }));
    const recent = [...gens].sort((a, b) => b.timestamp - a.timestamp).slice(0, 40).map((g) => ({ id: `gen:${g.id}`, name: `Gen ${new Date(g.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, thumb: g.url, blob: () => imageBlob(g) }));
    // The open card's own picture, whether or not it's kept anywhere.
    const own = project?.avatar ? [avatarPicture(project.id, project.card.data.name, api.avatarUrl(project.id, project.avatar)!)] : [];
    return { own, kept, recent };
  }, [project, gens]);

  const addCard = async (id: string, name: string) => {
    if (has(`card:${id}`)) return onRemove(`card:${id}`);
    setBusy(id);
    try {
      const p = await api.getProject(id);
      onAdd([{ id: `card:${id}`, kind: 'card', name: p.card.data.name || name, card: p.card.data, thumb: api.avatarUrl(id, p.avatar) ?? undefined }]);
    } catch (e) {
      toast(`Couldn't open ${name}: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setBusy(null);
    }
  };
  const addPicture = async (p: { id: string; name: string; blob: () => Promise<Blob> }) => {
    if (has(p.id)) return onRemove(p.id);
    setBusy(p.id);
    try {
      onAdd([await pictureReference(await p.blob(), p.name, p.id)]);
    } catch (e) {
      toast(`Couldn't read that picture: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setBusy(null);
    }
  };
  const fromFiles = async () => {
    const files = await pickFiles('image/*,.png,.json,.charx', true);
    if (files.length) onAdd(await referencesFromFiles(files));
  };

  const tile = (id: string, thumb: string | undefined, name: string, onClick: () => void, fallback: string, corner?: React.ReactNode) => (
    <div key={id} className="relative">
      <button
        type="button"
        onClick={onClick}
        title={has(id) ? `${name} (attached: click again to take it off)` : name}
        aria-pressed={has(id)}
        className={cx('relative flex w-full flex-col items-center gap-1 rounded-md p-1 text-[11px] text-slate-300 hover:bg-slate-800', has(id) && 'bg-violet-500/15 ring-1 ring-violet-500/50')}
      >
        {thumb ? <img src={thumb} alt="" loading="lazy" className="aspect-square w-full rounded object-cover" /> : <span className="flex aspect-square w-full items-center justify-center rounded bg-slate-800 text-2xl">{fallback}</span>}
        <span className="w-full truncate text-center">{name}</span>
        {has(id) && <span className="absolute top-1.5 right-1.5 rounded-full bg-violet-600 px-1 text-[10px] text-white">✓</span>}
        {busy === id.replace(/^card:/, '') || busy === id ? <span className="absolute inset-0 flex items-center justify-center rounded-md bg-slate-950/60 text-xs">…</span> : null}
      </button>
      {corner}
    </div>
  );
  /** On a card with a picture: attach its picture rather than its text. */
  const pictureOf = (c: ProjectSummary) => {
    const url = api.avatarUrl(c.id, c.avatar);
    if (!url) return undefined;
    const p = avatarPicture(c.id, c.name, url);
    return (
      <button
        type="button"
        onClick={() => void addPicture(p)}
        title={has(p.id) ? `${p.name} (attached: click again to take it off)` : `Attach ${p.name} instead of the card`}
        aria-label={`${p.name}${has(p.id) ? ' (attached)' : ''}`}
        aria-pressed={has(p.id)}
        className={cx('absolute top-1.5 left-1.5 rounded bg-slate-950/80 px-1 text-[11px] leading-5 hover:bg-slate-800', has(p.id) && 'bg-violet-600 text-white hover:bg-violet-500')}
      >
        🖼
      </button>
    );
  };

  return (
    <Modal open onClose={onClose} title={title} size="lg" footer={<Button variant="primary" onClick={onClose}>Done{refs.length ? ` (${refs.length})` : ''}</Button>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void fromFiles()}>📁 Card or picture file…</Button>
          <span className="text-xs text-slate-500">PNG/JSON/CHARX cards, or any picture. You can also paste or drop pictures on 📎. 🖼 on a card attaches its picture instead of its text.</span>
        </div>

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium tracking-wide text-slate-400 uppercase">Your cards</h3>
            {summaries.length > 8 && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className={cx(inputClass, 'ml-auto h-7 max-w-48 py-0 text-xs')} />}
          </div>
          {cards.length ? (
            <div className="grid max-h-64 grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-6">
              {cards.map((c) => tile(`card:${c.id}`, api.avatarUrl(c.id, c.avatar) ?? undefined, c.name || 'Unnamed', () => void addCard(c.id, c.name), '🪪', pictureOf(c)))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">{query ? 'No cards match.' : 'No other cards yet.'}</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-slate-400 uppercase">Pictures</h3>
          {pictures.own.length + pictures.kept.length + pictures.recent.length ? (
            <div className="grid max-h-64 grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-6">
              {pictures.own.map((p) => tile(p.id, p.thumb, p.name, () => void addPicture(p), '🖼'))}
              {pictures.kept.map((p) => tile(p.id, p.thumb, p.name, () => void addPicture(p), '🖼'))}
              {pictures.recent.map((p) => tile(p.id, p.thumb, p.name, () => void addPicture(p), '🖼'))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No gens yet. Pick a file instead.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
