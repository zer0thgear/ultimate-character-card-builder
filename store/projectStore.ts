'use client';

import { create } from 'zustand';
import type { CardData, CharacterCard } from '@/types/card';
import type { CardProject, KeptImage, ProjectSummary } from '@/types/project';
import { api } from '@/lib/api';
import { useSessionStore } from '@/store/sessionStore';
import { PROJECT_GEN_KEYS, useSettingsStore, DEFAULT_NEGATIVE } from '@/store/settingsStore';
import { useUiStore, type AppMode } from '@/store/uiStore';
import { notesSnippet } from '@/lib/cardSummary';

// The open card project: loading, editing with undo/redo, and saving it
// back to disk a moment after each change. Only one project is open at a
// time; switching saves the old one first.

const SAVE_DELAY_MS = 800;
/** Edits to the same field closer together than this are one undo step. */
const COALESCE_MS = 1500;
const MAX_UNDO = 200;

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

interface ProjectState {
  summaries: ProjectSummary[];
  project: CardProject | null;
  loading: boolean;
  status: SaveStatus;
  error: string | null;
  past: CharacterCard[];
  future: CharacterCard[];

  refreshList: () => Promise<void>;
  open: (id: string) => Promise<void>;
  create: (init?: Partial<CardProject>) => Promise<CardProject>;
  remove: (id: string) => Promise<void>;
  close: () => Promise<void>;
  /** A Chat-mode card joins Builder (it then shows in both modes). */
  addToBuilder: (id: string) => Promise<void>;
  /** Changes the card. `key` groups quick edits of one field into one undo
   *  step; leave it out for one-off actions (each is its own step). */
  updateCard: (change: (data: CardData) => CardData, key?: string) => void;
  /** Replaces the whole card (an overwrite from a file), as one undo step. */
  replaceCard: (card: CharacterCard) => void;
  setNotes: (notes: string) => void;
  undo: () => void;
  redo: () => void;
  setAvatar: (image: Blob) => Promise<void>;
  clearAvatar: () => Promise<void>;
  keep: (image: Blob, meta: Omit<KeptImage, 'file'>) => Promise<KeptImage>;
  unkeep: (file: string) => Promise<void>;
  updateKept: (file: string, patch: Partial<KeptImage>) => void;
  /** Saves now, if anything is waiting. */
  flush: () => Promise<void>;
  /** A card's chat counts in the lists, as its chats change. */
  setChatStats: (id: string, stats: Pick<ProjectSummary, 'chats' | 'messages' | 'lastChat'>) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let lastEdit = { key: '', at: 0 };
/** Set while a project's prompt fields are being loaded into the image
 *  generator, so that isn't mistaken for an edit. */
let applyingGen = false;

function summaryOf(p: CardProject): ProjectSummary {
  const notes = notesSnippet(p.card.data.creator_notes);
  return {
    id: p.id,
    name: p.card.data.name,
    tags: p.card.data.tags,
    avatar: p.avatar,
    ...(p.chatOnly ? { chatOnly: true } : {}),
    ...(p.card.data.creator.trim() ? { creator: p.card.data.creator.trim() } : {}),
    ...(notes ? { notes } : {}),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Where each mode remembers the card it had open, to reopen next time. */
export const lastCardKey = (mode: AppMode = useUiStore.getState().appMode) => (mode === 'chat' ? 'uccb-last-chat-card' : 'uccb-last-project');

export const useProjectStore = create<ProjectState>((set, get) => {
  const schedule = () => {
    set({ status: 'dirty' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
  };

  // (The card's chat counts are kept: they aren't in the project.)
  const upsertSummary = (p: CardProject) =>
    set((s) => {
      const old = s.summaries.find((x) => x.id === p.id);
      const stats = old ? { chats: old.chats, messages: old.messages, lastChat: old.lastChat } : {};
      return { summaries: [{ ...stats, ...summaryOf(p) }, ...s.summaries.filter((x) => x.id !== p.id)] };
    });

  const loadGen = (p: CardProject) => {
    applyingGen = true;
    useSettingsStore.getState().patch({
      stylePrompt: p.gen.stylePrompt ?? '',
      nsfwMode: p.gen.nsfwMode ?? false,
      furMode: p.gen.furMode ?? false,
      basePrompts: p.gen.basePrompts.length ? p.gen.basePrompts : [{ id: 'p-default', label: 'Prompt 1', text: '', selected: true }],
      characters: p.gen.characters,
      // The negative is shared by every card now; the first card opened
      // since hands over the one it had.
      ...(useSettingsStore.getState().negativeShared
        ? {}
        : { negativePrompt: p.gen.negativePrompt || DEFAULT_NEGATIVE, negativeTidbits: p.gen.negativeTidbits ?? [], negativeShared: true }),
    });
    applyingGen = false;
  };

  return {
    summaries: [],
    project: null,
    loading: false,
    status: 'saved',
    error: null,
    past: [],
    future: [],

    refreshList: async () => {
      set({ summaries: await api.listProjects() });
    },

    open: async (id) => {
      await get().flush();
      set({ loading: true, error: null });
      try {
        const p = await api.getProject(id);
        loadGen(p);
        set({ project: p, past: [], future: [], status: 'saved', loading: false });
        try {
          localStorage.setItem(lastCardKey(), id);
        } catch {
          /* private mode */
        }
      } catch (err) {
        set({ loading: false, error: (err as Error).message });
      }
    },

    create: async (init) => {
      // A new card starts in the style that's showing, so a look carries on
      // from card to card until it's changed.
      const style = useSettingsStore.getState().stylePrompt;
      await get().flush();
      const p = await api.createProject(init);
      upsertSummary(p);
      await get().open(p.id);
      if (style.trim() && !p.gen.stylePrompt?.trim() && get().project?.id === p.id) useSettingsStore.getState().set('stylePrompt', style);
      return p;
    },

    remove: async (id) => {
      if (get().project?.id === id) {
        if (saveTimer) clearTimeout(saveTimer);
        set({ project: null, past: [], future: [], status: 'saved' });
      }
      await api.deleteProject(id);
      set((s) => ({ summaries: s.summaries.filter((x) => x.id !== id) }));
    },

    close: async () => {
      await get().flush();
      set({ project: null, past: [], future: [] });
      // Back home stays home on the next visit, too.
      try {
        localStorage.removeItem(lastCardKey());
      } catch {
        /* private mode */
      }
    },

    addToBuilder: async (id) => {
      const open = get().project;
      if (open?.id === id) {
        // In Builder at once (a switch to Builder straight after keeps it
        // open), then saved as it is now.
        set({ project: { ...open, chatOnly: false } });
        upsertSummary({ ...open, chatOnly: false });
        await get().flush();
        const current = get().project;
        if (current?.id !== id) return;
        const saved = await api.saveProject(current);
        set((s) => (s.project?.id === id ? { project: { ...s.project, updatedAt: saved.updatedAt } } : {}));
        upsertSummary(saved);
      } else {
        const saved = await api.saveProject({ ...(await api.getProject(id)), chatOnly: false });
        upsertSummary(saved);
      }
    },

    updateCard: (change, key) => {
      const p = get().project;
      if (!p) return;
      const now = Date.now();
      const coalesce = !!key && key === lastEdit.key && now - lastEdit.at < COALESCE_MS;
      lastEdit = { key: key ?? '', at: now };
      const data = change(p.card.data);
      if (data === p.card.data) return;
      set((s) => ({
        project: { ...p, card: { ...p.card, data } },
        past: coalesce ? s.past : [...s.past, p.card].slice(-MAX_UNDO),
        future: [],
      }));
      schedule();
    },

    replaceCard: (card) => {
      const p = get().project;
      if (!p) return;
      lastEdit = { key: '', at: 0 };
      set((s) => ({ project: { ...p, card }, past: [...s.past, p.card].slice(-MAX_UNDO), future: [] }));
      schedule();
    },

    setNotes: (notes) => {
      const p = get().project;
      if (!p) return;
      set({ project: { ...p, notes } });
      schedule();
    },

    undo: () => {
      const { project: p, past, future } = get();
      if (!p || past.length === 0) return;
      lastEdit = { key: '', at: 0 };
      set({ project: { ...p, card: past[past.length - 1] }, past: past.slice(0, -1), future: [p.card, ...future] });
      schedule();
    },

    redo: () => {
      const { project: p, past, future } = get();
      if (!p || future.length === 0) return;
      lastEdit = { key: '', at: 0 };
      set({ project: { ...p, card: future[0] }, past: [...past, p.card], future: future.slice(1) });
      schedule();
    },

    setAvatar: async (image) => {
      const p = get().project;
      if (!p) return;
      const avatar = await api.setAvatar(p.id, image);
      const cur = get().project;
      if (cur?.id === p.id) {
        set({ project: { ...cur, avatar } });
        upsertSummary({ ...cur, avatar });
      }
    },

    clearAvatar: async () => {
      const p = get().project;
      if (!p) return;
      await api.clearAvatar(p.id);
      const cur = get().project;
      if (cur?.id === p.id) set({ project: { ...cur, avatar: undefined } });
      upsertSummary({ ...p, avatar: undefined });
    },

    keep: async (image, meta) => {
      const p = get().project;
      if (!p) throw new Error('No card open.');
      const kept = await api.keep(p.id, image, meta);
      const cur = get().project;
      if (cur?.id === p.id) set({ project: { ...cur, kept: [...cur.kept.filter((k) => k.file !== kept.file), kept] } });
      return kept;
    },

    unkeep: async (file) => {
      const p = get().project;
      if (!p) return;
      await api.unkeep(p.id, file);
      const cur = get().project;
      if (cur?.id === p.id) set({ project: { ...cur, kept: cur.kept.filter((k) => k.file !== file) } });
      // This session's copy (if it's still here) can be kept again.
      const session = useSessionStore.getState();
      const ids = session.images.filter((i) => i.projectId === p.id && i.keptFile === file).map((i) => i.id);
      if (ids.length) session.updateImages(ids, { keptFile: undefined, pinned: false });
    },

    updateKept: (file, patch) => {
      const p = get().project;
      if (!p) return;
      set({ project: { ...p, kept: p.kept.map((x) => (x.file === file ? { ...x, ...patch } : x)) } });
      void api.patchKept(p.id, file, patch);
    },

    flush: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (saving) await saving;
      const { project: p, status } = get();
      if (!p || status !== 'dirty') return;
      set({ status: 'saving' });
      saving = api
        .saveProject(p)
        .then((saved) => {
          const cur = get().project;
          // Edits made while saving stay dirty and save next time.
          const unchanged = cur === p;
          set({ status: unchanged ? 'saved' : 'dirty', error: null });
          upsertSummary({ ...(cur ?? p), updatedAt: saved.updatedAt });
          if (!unchanged) schedule();
        })
        .catch((err) => set({ status: 'error', error: (err as Error).message }))
        .finally(() => {
          saving = null;
        });
      await saving;
    },

    setChatStats: (id, stats) => {
      const old = get().summaries.find((x) => x.id === id);
      // A reply streaming in changes its chat's time with every word: the
      // lists only need it to the minute.
      if (!old || (old.chats === stats.chats && old.messages === stats.messages && Math.abs((old.lastChat ?? 0) - (stats.lastChat ?? 0)) < 60_000)) return;
      set((s) => ({ summaries: s.summaries.map((x) => (x.id === id ? { ...x, chats: stats.chats, messages: stats.messages, lastChat: stats.lastChat } : x)) }));
    },
  };
});

// The image generator's prompt fields are the open card's: edits there are
// edits to the project (saved with it, though not part of card undo).
if (typeof window !== 'undefined') {
  useSettingsStore.subscribe((s, prev) => {
    if (applyingGen) return;
    if (!PROJECT_GEN_KEYS.some((k) => s[k] !== prev[k])) return;
    const { project } = useProjectStore.getState();
    if (!project) return;
    useProjectStore.setState({
      project: {
        ...project,
        // (Its negative, from before negatives were shared, is kept as it was.)
        gen: { ...project.gen, stylePrompt: s.stylePrompt, nsfwMode: s.nsfwMode, furMode: s.furMode, basePrompts: s.basePrompts, characters: s.characters },
      },
      status: 'dirty',
    });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void useProjectStore.getState().flush(), SAVE_DELAY_MS);
  });

  window.addEventListener('beforeunload', (e) => {
    const { status } = useProjectStore.getState();
    if (status === 'dirty' || status === 'saving') {
      void useProjectStore.getState().flush();
      e.preventDefault();
    }
  });
}
